"""MERRA-2 dust from GES DISC (trend_detective/gesdisc.py), tested without the network."""

import numpy as np
import pytest

from trend_detective import gesdisc as G

netCDF4 = pytest.importorskip("netCDF4")


def granule(ym, stream="400"):
    y, m = ym.split("-")
    name = f"MERRA2_{stream}.tavgM_2d_aer_Nx.{y}{m}.nc4"
    return {"umm": {
        "GranuleUR": f"M2TMNXAER.5.12.4:{name}",
        "TemporalExtent": {"RangeDateTime": {"BeginningDateTime": f"{ym}-01T00:00:00.000Z"}},
        "RelatedUrls": [
            {"Type": "GET DATA", "URL": f"https://data.gesdisc.earthdata.nasa.gov/data/x/{y}/{name}"},
            {"Type": "USE SERVICE API", "URL": f"https://opendap.earthdata.nasa.gov/collections/{G.COLLECTION}/granules/M2TMNXAER.5.12.4%3A{name}"},
        ]}}


def nc_bytes(tmp_path, lat, lon, fields: dict) -> bytes:
    path = tmp_path / "x.nc4"
    with netCDF4.Dataset(path, "w") as nc:
        nc.createDimension("time", 1); nc.createDimension("lat", len(lat)); nc.createDimension("lon", len(lon))
        nc.createVariable("lat", "f8", ("lat",))[:] = lat
        nc.createVariable("lon", "f8", ("lon",))[:] = lon
        for k, v in fields.items():
            nc.createVariable(k, "f4", ("time", "lat", "lon"), fill_value=1e15)[:] = v[None]
    return path.read_bytes()


def test_box_matches_the_power_grid():
    # the Mongolia box selects the same MERRA-2 rows and columns as the POWER scenes
    assert G.box_index((87.5, 41.0, 120.5, 52.5)) == (262, 285, 428, 480)


def test_granule_listing_keeps_reprocessed_months():
    gs = G.latest_per_month(G.parse_granules([granule("2020-08"), granule("2020-09"), granule("2020-09", "401")]))
    assert [g["ym"] for g in gs] == ["2020-08", "2020-09"]
    assert "MERRA2_401" in gs[1]["ur"] and gs[1]["opendap"].startswith("https://opendap.earthdata.nasa.gov/")


def test_dap4_request():
    url = G.dap4_url("https://opendap.earthdata.nasa.gov/collections/C/granules/G", ["DUSMASS"], (262, 285, 428, 480))
    assert url.startswith("https://opendap.earthdata.nasa.gov/collections/C/granules/G.dap.nc4?dap4.ce=")
    assert "/DUSMASS%5B0:1:0%5D%5B262:1:285%5D%5B428:1:480%5D%3B/lat%5B262:1:285%5D%3B/lon%5B428:1:480%5D" in url


def test_read_subset_and_whole_file_agree(tmp_path):
    lat = G.LAT0 + G.DLAT * np.arange(G.NLAT)
    lon = G.LON0 + G.DLON * np.arange(G.NLON)
    field = np.random.default_rng(1).random((G.NLAT, G.NLON)).astype("f4") * 1e-7
    idx = (262, 285, 428, 480)
    whole = G.read_box(nc_bytes(tmp_path, lat, lon, {"DUSMASS": field}), ["DUSMASS"], idx)
    sub = G.read_box(nc_bytes(tmp_path, lat[262:286], lon[428:481], {"DUSMASS": field[262:286, 428:481]}), ["DUSMASS"])
    assert whole["DUSMASS"].shape == sub["DUSMASS"].shape == (24, 53)
    assert np.array_equal(whole["DUSMASS"], sub["DUSMASS"]) and np.allclose(whole["lat"], sub["lat"])


def test_missing_token_is_explained(monkeypatch):
    monkeypatch.delenv("EARTHDATA_TOKEN", raising=False)
    with pytest.raises(G.LoginRequired, match="urs.earthdata.nasa.gov"):
        G.token()


def test_load_builds_a_monthly_field_in_display_units(tmp_path, monkeypatch):
    months = ["2001-01", "2001-02", "2001-03"]
    lat, lon = 41.0 + 0.5 * np.arange(24), 87.5 + 0.625 * np.arange(53)
    monkeypatch.setattr(G, "granules", lambda s, e: G.parse_granules([granule(m) for m in months]))
    monkeypatch.setattr(G, "month_box", lambda g, v, idx, s: {"DUSMASS": np.full((24, 53), 2e-8), "lat": lat, "lon": lon})
    da = G.load("merra2aer", "DUSMASS", (87.5, 41.0, 120.5, 52.5), "2001-01", "2001-03", cache_dir=None)
    assert da.dims == ("time", "lat", "lon") and da.shape == (3, 24, 53)
    assert da.attrs["units"] == "ug m-3" and float(da[0, 0, 0]) == pytest.approx(20.0)  # 2e-8 kg m-3 = 20 ug m-3
    with pytest.raises(RuntimeError, match="no granule"):
        G.load("merra2aer", "DUSMASS", (87.5, 41.0, 120.5, 52.5), "2001-01", "2001-04", cache_dir=None)
