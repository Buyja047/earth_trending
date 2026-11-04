"""The Earthdata source of the MODIS scenes: grids, the sinusoidal tiles, the quality rules, the snow rule, the
archive clients (offline, with canned responses) and the pipeline run with a stand-in source."""
import json
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pytest

from trend_detective import modis, modis_cloud as mc
from trend_detective.payload import read_payload

ROOT = Path(__file__).resolve().parent.parent
UB = modis.bbox_of(modis.REGIONS["ub"])


def test_cmg_grid_is_the_product_grid_of_mongolia():
    g = mc.cmg_grid(modis.bbox_of(modis.REGIONS["country"]), 0.05)
    assert (g["ny"], g["nx"]) == (220, 650) and g["rows"] == (750, 970) and g["cols"] == (5350, 6000) and g["block"] == 1
    assert g["lat"][0] == pytest.approx(41.525) and g["lat"][-1] == pytest.approx(52.475)   # south to north
    assert g["lon"][0] == pytest.approx(87.525) and g["lon"][-1] == pytest.approx(119.975)
    assert g["north"] == pytest.approx(52.5) and g["west"] == pytest.approx(87.5)
    assert mc.region_grid(modis.REGIONS["ub"])["dlat"] == pytest.approx(1 / modis.KM_PER_DEG)
    g2 = mc.region_grid(modis.REGIONS["country"])                       # the published 0.1° grid: 2 x 2 CMG cells
    assert (g2["ny"], g2["nx"], g2["block"]) == (110, 325, 2) and g2["rows"] == (750, 970) and g2["cols"] == (5350, 6000)
    assert g2["lat"][0] == pytest.approx(41.55) and g2["lat"][-1] == pytest.approx(52.45) and g2["lon"][0] == pytest.approx(87.55)
    a = np.array([[1.0, np.nan, 5.0, 7.0], [3.0, np.nan, np.nan, np.nan], [np.nan] * 4, [np.nan] * 4])
    b = mc.block_mean(a, 2)
    assert b.shape == (2, 2) and b[0, 0] == 2.0 and b[0, 1] == 6.0 and np.isnan(b[1, 0]) and np.isnan(b[1, 1])
    assert mc.block_mean(a[None], 2).shape == (1, 2, 2)


def test_sinusoidal_tiles_match_the_hdf_eos_metadata():
    # the upper-left corner of tile h25v04 as MOD13A3's StructMetadata writes it
    assert mc.TILE_X0 + 25 * mc.TILE_M == pytest.approx(7783653.637667, abs=0.01)
    assert mc.TILE_Y0 - 4 * mc.TILE_M == pytest.approx(5559752.598333, abs=0.01)
    x, y = mc.sinu_xy(np.array([0.0, 106.883]), np.array([0.0, 47.908]))
    assert x[0] == 0 and y[0] == 0
    lon, lat = mc.sinu_lonlat(x, y)
    assert lon[1] == pytest.approx(106.883) and lat[1] == pytest.approx(47.908)
    assert mc.tiles_for(UB) == [(24, 4), (25, 4)]
    assert mc.tiles_for(modis.bbox_of(modis.REGIONS["khovsgol"])) == [(24, 3), (24, 4)]
    assert mc.tiles_for(modis.bbox_of(modis.REGIONS["gobi"])) == [(25, 4)]
    r0, r1, c0, c1 = mc.tile_window(UB, 25, 4, 1200)
    assert 0 <= r0 < r1 <= 1200 and 0 <= c0 < c1 <= 1200 and (r1 - r0) * (c1 - c0) > 160 * 160
    assert mc.tile_window(UB, 26, 4, 1200) is None


def test_cells_and_pixels_map_to_each_other():
    """The sinusoidal grid is sheared at 107°E (a pixel row north shifts x by about 1.4 km), so the test checks
    distances, not identity: the pixel chosen for a cell is the one holding its centre, and every pixel is assigned
    to the cell holding the pixel's centre."""
    grid = modis.grid_for(UB, 1)
    win = mc.tile_window(UB, 25, 4, 1200)
    row, col, ok = mc.cell_pixels(grid, 25, 4, 1200, win)
    assert ok.mean() > 0.95                                 # almost every cell of the box lies in h25v04
    px = mc.TILE_M / 1200
    r0, r1, c0, c1 = win
    # the cell centre lies inside the pixel chosen for it (checked in the projection's own metres)
    xc, yc = mc.sinu_xy(*np.meshgrid(grid["lon"], grid["lat"]))
    xp = mc.TILE_X0 + 25 * mc.TILE_M + (c0 + col[ok] + 0.5) * px
    yp = mc.TILE_Y0 - 4 * mc.TILE_M - (r0 + row[ok] + 0.5) * px
    assert np.abs(xc[ok] - xp).max() <= px / 2 + 1e-6 and np.abs(yc[ok] - yp).max() <= px / 2 + 1e-6
    # every pixel is assigned to the cell holding the pixel's centre (checked in degrees)
    idx = mc.pixel_cells(grid, 25, 4, 1200, win)
    rr, cc = np.nonzero(idx >= 0)
    k = idx[rr, cc]
    plon, plat = mc.sinu_lonlat(mc.TILE_X0 + 25 * mc.TILE_M + (c0 + cc + 0.5) * px, mc.TILE_Y0 - 4 * mc.TILE_M - (r0 + rr + 0.5) * px)
    assert np.abs(plat - grid["lat"][k // grid["nx"]]).max() <= grid["dlat"] / 2 + 1e-9
    assert np.abs(plon - grid["lon"][k % grid["nx"]]).max() <= grid["dlon"] / 2 + 1e-9
    assert 0.3 < (idx >= 0).mean() < 0.7 and len(set(k.tolist())) > 0.9 * grid["ny"] * grid["nx"]   # the window boxes a sheared parallelogram
    vals = np.zeros((r1 - r0, c1 - c0))
    vals[row[ok], col[ok]] = 7
    assert np.nanmean(mc._sample(vals, (row, col, ok), grid)[ok]) == 7


def test_quality_rules():
    raw = np.array([[15000, 15000, 15000, 15000, 0]], float)
    qc = np.array([[0b00000000, 0b01000000, 0b10000000, 0b00000010, 0]], np.uint8)
    out = mc.lst_celsius(raw, qc)[0]
    assert out[0] == pytest.approx(26.85) and out[1] == pytest.approx(26.85)   # good; LST error <= 2 K
    assert np.isnan(out[2]) and np.isnan(out[3]) and np.isnan(out[4])          # error 3 K; cloud; fill
    ndvi = mc.ndvi_value(np.array([5000, 5000, 5000, -3000]), np.array([0, 1, 2, 0]))
    assert ndvi[0] == 0.5 and ndvi[1] == 0.5 and np.isnan(ndvi[2]) and np.isnan(ndvi[3])


def test_snow_rule_and_season():
    days = mc.snow_days_month(np.array([10.0, 3.0, 0.0]), np.array([20, 2, 5]), 30, min_obs=3)
    assert days[0] == 15 and np.isnan(days[1]) and days[2] == 0
    grid = {"ny": 1, "nx": 2, "north": 48.0, "west": 106.0, "dlat": 0.5, "dlon": 0.5}
    months = mc.season_months((11, 3), 2021)
    raw = {}
    for y, m in months:
        raw[mc.month_key(y, m) + "-sum"] = np.array([[4.0, 4.0]], np.float32)
        raw[mc.month_key(y, m) + "-cnt"] = np.array([[8, 8]], np.uint8)
    raw[mc.month_key(2021, 1) + "-cnt"] = np.array([[8, 2]], np.uint8)          # January too cloudy in the second cell
    season = mc.season_from_raw(raw, months, grid, None, min_obs=3)
    assert season[0, 0] == pytest.approx(sum(__import__("calendar").monthrange(y, m)[1] for y, m in months) / 2)
    assert np.isnan(season[0, 1])
    # a box: two pixels per cell, the mean of the pixels that pass
    maps = {(24, 4): ((0, 1, 0, 4), np.array([[0, 0, 1, 1]]))}
    raw = {}
    for y, m in months:
        raw[mc.month_key(y, m, (24, 4)) + "-sum"] = np.array([[4, 2, 1, 1]], np.uint8)
        raw[mc.month_key(y, m, (24, 4)) + "-cnt"] = np.array([[8, 8, 8, 1]], np.uint8)
    season = mc.season_from_raw(raw, months, grid, maps, min_obs=3)
    total_days = sum(__import__("calendar").monthrange(y, m)[1] for y, m in months)
    assert season[0, 0] == pytest.approx(total_days * (0.5 + 0.25) / 2) and season[0, 1] == pytest.approx(total_days / 8)


def test_cmr_links_are_picked_from_the_feed():
    feed = {"feed": {"entry": [
        {"title": "MOD11A2.A2020001.h25v04.061.x", "time_start": "2020-01-01T00:00:00.000Z", "links": [
            {"rel": "http://esipfed.org/ns/fedsearch/1.1/data#", "href": "https://data.lpdaac.earthdatacloud.nasa.gov/lp-prod-public/x/BROWSE.jpg"},
            {"rel": "http://esipfed.org/ns/fedsearch/1.1/data#", "href": "https://data.lpdaac.earthdatacloud.nasa.gov/lp-prod-protected/x/a.hdf"},
            {"rel": "http://esipfed.org/ns/fedsearch/1.1/service#", "href": "https://opendap.earthdata.nasa.gov/collections/C1/granules/a"}]},
        {"title": "MOD11A2.A2020009.h25v04.061.x", "time_start": "2020-01-09T00:00:00.000Z", "links": [
            {"rel": "http://esipfed.org/ns/fedsearch/1.1/s3#", "href": "s3://lp-prod-protected/x/b.hdf"}]}]}}
    calls = []
    with patch.object(mc, "http_get", side_effect=lambda url, **k: calls.append(url) or json.dumps(feed).encode()):
        g = mc.cmr_granules("MOD11A2", "061", __import__("datetime").date(2020, 1, 1), __import__("datetime").date(2020, 1, 31), bbox=UB)
    assert [x["data"] for x in g] == ["https://data.lpdaac.earthdatacloud.nasa.gov/lp-prod-protected/x/a.hdf", None]
    assert g[0]["opendap"].endswith("/granules/a") and g[1]["opendap"] is None and g[1]["start"] == "2020-01-09"
    assert "short_name=MOD11A2" in calls[0] and "bounding_box=" in calls[0] and "temporal=2020-01-01T00" in calls[0]


def test_planetary_computer_items_page_and_keep_terra_only():
    pages = [{"features": [{"id": "MOD10A1.A2020001.h24v04", "properties": {"platform": "terra", "start_datetime": "2020-01-01T00:00:00Z"}},
                           {"id": "MYD10A1.A2020001.h24v04", "properties": {"platform": "aqua", "start_datetime": "2020-01-01T00:00:00Z"}}],
              "links": [{"rel": "next", "body": {"token": "next:1"}}]},
             {"features": [{"id": "MOD10A1.A2020002.h24v04", "properties": {"platform": "terra", "start_datetime": "2020-01-02T00:00:00Z"}}], "links": []}]
    bodies = []

    def fake(url, data=None, **k):
        bodies.append(json.loads(data))
        return json.dumps(pages[len(bodies) - 1]).encode()
    with patch.object(mc, "http_get", side_effect=fake):
        items = mc.PlanetaryComputer().items("modis-10A1-061", UB, __import__("datetime").date(2020, 1, 1), __import__("datetime").date(2020, 1, 2))
    assert [i["id"][:3] for i in items] == ["MOD", "MOD"] and bodies[0]["query"] == {"platform": {"eq": "terra"}} and bodies[1] == {"token": "next:1"}


def test_the_pipeline_runs_with_the_earthdata_source(tmp_path, monkeypatch):
    """A stand-in fetch_year gives every region and variable a planted trend; scenes carry the source's provenance."""
    monkeypatch.setenv("EARTHDATA_TOKEN", "x")
    small = dict(modis.REGIONS["country"], bbox=(106.0, 47.0, 107.0, 48.0))
    box = dict(modis.REGIONS["ub"], size_km=12)

    def fake_fetch_year(self, var, region, grid, year):
        rng = np.random.default_rng(year)
        nb = 1 if var["sampling"] == "season" else (10 if year == 2000 else 12)
        arr = 0.05 * (year - 2000) + rng.standard_normal((nb, grid["ny"], grid["nx"]))
        arr[:, 0, 0] = np.nan                                 # one never-observed cell
        return arr.astype(np.float32)
    out = tmp_path / "data"
    out.mkdir()
    (out / "index.js").write_text((ROOT / "web/data/index.js").read_text(encoding="utf-8"), encoding="utf-8")
    with patch.object(mc.Source, "fetch_year", fake_fetch_year), patch.dict(modis.REGIONS, {"country": small, "ub": box}):
        built = modis.run(None, ["country", "ub"], ["lstd", "snowdays"], out, ROOT / "web/data/geo.js", tmp_path / "cache", 2000, 2014,
                          log=lambda *a: None, source="earthdata")
    ids = [sc["id"] for sc in built]
    assert ids == ["mn-modis-lst-day", "mn-modis-snowdays", "ub-modis-lst-day", "ub-modis-snowdays"]
    country = built[0]
    assert country["grid"]["ny"] == 10 and country["grid"]["nx"] == 10 and country["grid"]["dlat"] == pytest.approx(0.1)
    assert "2 × 2" in country["grid_note"] and country["modis"]["collection"] == "MOD11C3.061" and "OPeNDAP" in country["modis"]["access"]
    assert built[3]["modis"]["collection"] == "MOD10A1.061" and "Planetary Computer" in built[3]["modis"]["access"]
    assert built[2]["grid_note"].startswith("1 km cells, one native pixel")
    assert country["counts"]["gappy"] == 0 and country["cells"]["status"][0] == 0      # the NaN cell is excluded, not filled
    assert country["region_means"][0]["stats"]["sen"] == pytest.approx(0.5, abs=0.2) and country["region_means"][0]["stats"]["p_mk"] < 0.05
    assert (tmp_path / "cache" / "mongolia-lst-day-2005.npy").exists()
    idx = read_payload(out / "index.js")
    assert {"mn-modis-snowdays", "ub-modis-lst-day"} <= {s["id"] for s in idx["scenes"]}
    with pytest.raises(ValueError):
        modis.run(None, ["ub"], ["lstd"], out, ROOT / "web/data/geo.js", None, 2000, 2014, log=lambda *a: None, source="elsewhere")


def test_the_token_is_required_for_nasa_downloads(monkeypatch):
    monkeypatch.delenv("EARTHDATA_TOKEN", raising=False)
    with pytest.raises(RuntimeError, match="EARTHDATA_TOKEN"):
        mc.http_get("https://data.lpdaac.earthdatacloud.nasa.gov/x.hdf", auth=True)


def test_archive_is_authoritative_and_the_mirror_serves_what_it_has():
    assert mc.acq_key("MOD11A2.A2020009.h25v04.061.2021005132618.hdf") == "A2020009.h25v04"
    assert mc.acq_key("MOD10A1.A2021001.h24v03.061.2021003131846") == "A2021001.h24v03"
    assert mc.tile_of_title("MOD10A1.A2021001.h24v03.061.2021003131846.hdf") == (24, 3)
    granules = [{"title": f"MOD11A2.A2024{d:03d}.h25v04.061.2024999.hdf", "data": "https://x/a.hdf", "start": "2024-01-01"} for d in (1, 9, 17)]
    granules.append({"title": "MOD11A2.A2024001.h26v04.061.2024999.hdf", "data": "https://x/b.hdf", "start": "2024-01-01"})   # another tile
    items = [{"id": "MOD11A2.A2024001.h25v04.061.2024001000000", "properties": {"modis:horizontal-tile": 25, "modis:vertical-tile": 4}},
             {"id": "MOD11A2.A2024009.h25v04.061.2024001000000", "properties": {"modis:horizontal-tile": 25, "modis:vertical-tile": 4}}]
    pc = mc.PlanetaryComputer()
    with patch.object(mc, "cmr_granules", return_value=granules), patch.object(pc, "items", return_value=items):
        mirror, rest = mc._split_sources(pc, "MOD11A2", "061", "modis-11A2-061", UB, __import__("datetime").date(2024, 1, 1),
                                         __import__("datetime").date(2024, 1, 31), {(25, 4): None})
    assert [i["id"][8:16] for i in mirror] == ["A2024001", "A2024009"]            # served by the mirror
    assert [g["title"][8:16] for g in rest] == ["A2024017"]                        # downloaded from the archive; h26v04 ignored
