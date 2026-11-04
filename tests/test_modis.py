"""MODIS 1 km / 5 km scenes: grids, seasons, the Earth Engine graph (offline) and the payload the viewer reads."""
import functools
import json
import re
import shutil
import subprocess
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pytest

from trend_detective import modis
from trend_detective.payload import read_payload

ROOT = Path(__file__).resolve().parent.parent


def test_grid_cells_are_the_requested_size_and_south_to_north():
    g = modis.grid_for((106.0, 47.0, 108.0, 48.0), 1)
    assert abs(g["dlat"] * modis.KM_PER_DEG - 1) < 1e-9
    assert abs(g["dlon"] * modis.KM_PER_DEG * np.cos(np.radians(47.5)) - 1) < 1e-9
    assert g["ny"] == 111 and g["nx"] == 150 and g["lat"][0] < g["lat"][-1] and g["lon"][0] < g["lon"][-1]   # 2 deg / 0.0133 deg
    assert abs(g["north"] - (47.0 + g["ny"] * g["dlat"])) < 1e-12
    for key, spec in modis.REGIONS.items():
        gg = modis.grid_for(modis.bbox_of(spec), spec["km"])
        assert modis.request_bytes(gg, 12) < modis.MAX_REQUEST_BYTES, key
        if "size_km" in spec:
            assert abs(gg["nx"] - spec["size_km"]) <= 1 and abs(gg["ny"] - spec["size_km"]) <= 1, key
    with pytest.raises(ValueError):
        modis.grid_for((106.0, 47.0, 106.01, 47.01), 5)


def test_seasons_years_and_times():
    assert modis.season_months((5, 9), 2003) == [(2003, 5), (2003, 6), (2003, 7), (2003, 8), (2003, 9)]
    assert modis.season_months((11, 3), 2001) == [(2000, 11), (2000, 12), (2001, 1), (2001, 2), (2001, 3)]
    assert modis.years_for(modis.VARS["snowdays"])[0] == 2001 and modis.years_for(modis.VARS["ndvi"])[0] == 2000
    t = modis.times_for(modis.VARS["lstd"], [2000, 2001])
    assert str(t[0]) == "2000-03" and len(t) == 22
    assert [str(x) for x in modis.times_for(modis.VARS["snowdays"], [2001, 2002])] == ["2001-02", "2002-02"]
    assert modis.scene_id("country", "lstd") == "mn-modis-lst-day" and modis.scene_id("ub", "snowdays") == "ub-modis-snowdays"


def test_trailing_empty_months_are_dropped_by_whole_years():
    v = np.ones((34, 2, 2))
    v[30:] = np.nan                        # the last four months have nothing yet
    t = modis.times_for(modis.VARS["lstd"], [2000, 2001, 2002])[:34]
    out, tt = modis.trim_trailing_empty(v, t, True)
    assert out.shape[0] == 22 and str(tt[-1]) == "2001-12"
    s = np.ones((5, 2, 2)); s[4] = np.nan
    out, tt = modis.trim_trailing_empty(s, modis.times_for(modis.VARS["ndvi"], list(range(2000, 2005))), False)
    assert out.shape[0] == 4 and str(tt[-1]) == "2003-07"


def _fake_pixels(grid, names, year, trend=0.03, seed=0):
    """Synthetic north-first arrays as computePixels returns them: a trend, noise, and a missing corner."""
    rng = np.random.default_rng(seed + year)
    out = {}
    for b, name in enumerate(names):
        base = trend * (year - 2000) + rng.standard_normal((grid["ny"], grid["nx"]))
        base[:2, :2] = modis.MISSING          # never observed
        if year == 2004 and b == 3:
            base[3, 3] = modis.MISSING       # one missing month: that cell is excluded, not gap-filled
        out[name] = base.astype(np.float32)
    return out


def build_offline(tmp_path, var_key, region_key="ub", years=(2000, 2012), spec=None, out=None):
    """Run the real Earth Engine client offline: graphs are built, computePixels is answered locally.

    `spec` replaces the region (default: a 12 km box over Ulaanbaatar, or 1° over 106–107°E at 10 km for the country);
    `out` reuses a data folder so that several scenes share one index.js."""
    ee = pytest.importorskip("ee")
    from ee.apitestcase import GetAlgorithms
    ee.Reset()
    small = spec or dict(modis.REGIONS[region_key], centre=(106.9, 47.9), size_km=12, km=1)
    if region_key == "country" and spec is None:
        small = dict(modis.REGIONS["country"], bbox=(106.0, 47.0, 107.0, 48.0), km=10)
    grid = modis.grid_for(modis.bbox_of(small), small["km"])
    var = modis.VARS[var_key]
    yrs = modis.years_for(var, *years)
    requests, seen = [], {"n": 0}

    def band_names(*a, **k):                      # img.bandNames().getInfo(): the first MODIS year starts in March
        if var["sampling"] != "monthly":
            return ["s"]
        return ["m%02d" % m for m in range(3 if yrs[min(seen["n"], len(yrs) - 1)] == 2000 else 1, 13)]

    def pixels(params):                            # ee.data.computePixels, answered locally
        params = dict(params, graph=json.loads(params["expression"].serialize()))
        requests.append(params)
        year = yrs[min(seen["n"], len(yrs) - 1)]
        seen["n"] += 1
        return _fake_pixels(grid, params["bandIds"], year, seed={"lstd": 1, "lstn": 2, "ndvi": 3, "snowdays": 4}[var_key])

    out = out or tmp_path / "data"
    out.mkdir(exist_ok=True)
    if not (out / "index.js").exists():
        shutil.copy(ROOT / "web/data/index.js", out / "index.js")
    initialize = ee.Initialize
    with patch.object(ee, "Initialize", side_effect=lambda **kw: initialize(None, "", project=kw["project"])), \
         patch.object(ee.data, "_install_cloud_api_resource"), patch.object(ee.data, "getAlgorithms", GetAlgorithms), \
         patch.object(ee.data, "computeValue", side_effect=band_names), \
         patch.object(ee.data, "computePixels", side_effect=pixels), \
         patch.dict(modis.REGIONS, {region_key: small}):
        ee.Initialize(project="offline-test")
        built = modis.run("offline-test", [region_key], [var_key], out, ROOT / "web/data/geo.js", None, years[0], years[1], log=lambda *a: None, ee_module=ee)
    ee.Reset()
    return built, requests, grid, out


def test_offline_graph_and_payload_for_a_monthly_variable(tmp_path):
    built, requests, grid, out = build_offline(tmp_path, "lstd")
    sc = built[0]
    assert sc["id"] == "ub-modis-lst-day" and sc["series"]["kind"] == "annual" and sc["focus"] is True
    assert sc["grid"]["nx"] == grid["nx"] and sc["grid"]["ny"] == grid["ny"] and sc["period"]["start"] == "2000-03"
    # the Earth Engine graph carries the QA rule, the collection and the explicit grid
    g = json.dumps(requests[0]["graph"])
    assert "MODIS/061/MOD11A2" in g and "bitwiseAnd" in g and "rightShift" in g and "LST_Day_1km" in g
    assert "reduceResolution" not in g                      # 1 km cells from 1 km pixels: no aggregation
    req = requests[0]
    assert req["grid"]["dimensions"] == {"width": grid["nx"], "height": grid["ny"]}
    assert abs(req["grid"]["affineTransform"]["translateY"] - grid["north"]) < 1e-12 and req["grid"]["affineTransform"]["scaleY"] < 0
    # the never-observed corner is excluded and the cell with one missing month is excluded, not filled
    status = np.array(sc["cells"]["status"]).reshape(grid["ny"], grid["nx"])
    assert (status[-2:, :2] == 0).all()                      # north-first corner lands at the top rows after the flip
    assert status[grid["ny"] - 4, 3] == 6
    assert sc["counts"]["valid"] == grid["nx"] * grid["ny"] - 5 and sc["counts"]["gappy"] == 1
    # the planted trend is found: +0.03 per year -> +0.3 per decade in the box mean
    rm = sc["region_means"][0]
    assert rm["key"] == "box" and abs(rm["stats"]["sen"] - 0.3) < 0.1 and rm["stats"]["p_mk"] < 0.05
    assert any(t["date"] == "2020-03" for t in sc["transitions"]) and sc["steps"] == []   # the drift lies outside 2000-2012
    # the index now lists the scene next to the existing ones
    idx = read_payload(out / "index.js")
    ids = [s["id"] for s in idx["scenes"]]
    assert "mn-t2m" in ids and "ub-modis-lst-day" in ids and idx["products"]["modis"]["kind"] == "mission"
    assert (out / "ub-modis-lst-day.js").stat().st_size < 400_000


def test_offline_graph_for_the_country_at_5_km_and_a_season_variable(tmp_path):
    built, requests, grid, out = build_offline(tmp_path, "snowdays", region_key="country", years=(2000, 2011))
    sc = built[0]
    assert sc["id"] == "mn-modis-snowdays" and sc["region"] == "mongolia" and sc["period"]["start"] == "2001-02"
    g = json.dumps(requests[0]["graph"])
    assert "MODIS/061/MOD10A1" in g and "reduceResolution" in g and "NDSI_Snow_Cover" in g
    assert len(requests) == 11 and all(r["bandIds"] == ["s"] for r in requests)
    # cells outside Mongolia carry nothing; the box 106-107E 47-48N lies inside, so most are valid
    assert sc["counts"]["valid"] > 0.9 * grid["nx"] * grid["ny"] - 10
    assert sc["region_means"][0]["key"] == "focus"


def test_viewer_opens_a_modis_scene(tmp_path):
    playwright = pytest.importorskip("playwright.sync_api")
    if not shutil.which("chromium"):
        pytest.skip("system Chromium unavailable")
    built, requests, grid, out = build_offline(tmp_path, "ndvi")
    sc = built[0]

    class Quiet(SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    srv = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(ROOT)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        with playwright.sync_playwright() as p:
            browser = p.chromium.launch(executable_path=shutil.which("chromium"), args=["--no-sandbox"])
            page = browser.new_page(viewport=dict(width=1400, height=950), service_workers="block")
            page.add_init_script("localStorage.setItem('td.seenGuide','1'); localStorage.setItem('td.lang','mn')")
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.route("**/data/index.js", lambda r: r.fulfill(content_type="application/javascript", body=(out / "index.js").read_text(encoding="utf-8")))
            page.route(f"**/data/{sc['id']}.js", lambda r: r.fulfill(content_type="application/javascript", body=(out / f"{sc['id']}.js").read_text(encoding="utf-8")))
            page.goto(f"http://127.0.0.1:{srv.server_port}/web/index.html#{sc['id']}")
            page.wait_for_function(f"() => window.TDApp && TDApp.state.res && TDApp.state.sc.id === '{sc['id']}'")
            summary = page.locator("#summary").inner_text()
            assert "Ногоон байдал" in summary and "Улаанбаатар, 160 км хайрцаг" in summary, summary
            assert page.locator('[data-go="ub-modis-ndvi"]').count() == 1 and "Улаанбаатар MODIS" in page.locator("#tree-scenes").inner_text()
            assert page.locator("#season").is_disabled()          # one value per year: no months filter
            page.wait_for_timeout(600)                             # the first paint is scheduled on an animation frame
            px = page.locator("#map").evaluate("c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - d[i+2]) > 20) n++; return n; }")
            assert px > 100                                        # faded (not significant) cells still carry a hue
            assert not errors, errors
            browser.close()
    finally:
        srv.shutdown(); srv.server_close()


def _settled(page):
    page.wait_for_function("() => { const b = document.querySelector('#casebar'); return b && !b.hidden && !b.querySelector('[data-case-nav=next][disabled], .casenav [data-case][disabled]') && document.querySelector('#busy').hidden; }", timeout=60000)
    page.wait_for_timeout(150)


def test_modis_case_files_walk_to_their_verdicts(tmp_path):
    """The four MODIS cases are hidden until their scenes exist; with synthetic scenes in the index they walk to a verdict."""
    playwright = pytest.importorskip("playwright.sync_api")
    if not shutil.which("chromium"):
        pytest.skip("system Chromium unavailable")
    # the real boxes at 4 km (1,600 cells) so that the city, the mine boxes and Mörön fall inside; a slice of the country at 10 km
    specs = {k: dict(modis.REGIONS[k], km=4) for k in ("ub", "gobi", "khovsgol")}
    specs["country"] = dict(modis.REGIONS["country"], bbox=(104.5, 46.5, 108.5, 49.0), km=10)
    out = tmp_path / "data"
    built = []
    for region, var in [("ub", "lstd"), ("ub", "lstn"), ("gobi", "ndvi"), ("gobi", "lstd"), ("khovsgol", "snowdays"), ("khovsgol", "lstn"), ("country", "lstd")]:
        built += build_offline(tmp_path, var, region, years=(2000, 2014), spec=specs[region], out=out)[0]
    ids = [s["id"] for s in built]
    assert ids == ["ub-modis-lst-day", "ub-modis-lst-night", "gobi-modis-ndvi", "gobi-modis-lst-day", "khovsgol-modis-snowdays", "khovsgol-modis-lst-night", "mn-modis-lst-day"]
    index_ids = [s["id"] for s in read_payload(out / "index.js")["scenes"]]
    real_ids = [s["id"] for s in read_payload(ROOT / "web/data/index.js")["scenes"]]
    node = shutil.which("node")
    js = f"require('./web/js/cases.js');const C=globalThis.TDCases;console.log(JSON.stringify({{later: C.list({json.dumps(index_ids)}), now: C.list({json.dumps(real_ids)})}}))"
    r = json.loads(subprocess.run([node, "-e", js], cwd=ROOT, capture_output=True, text=True, check=True).stdout)
    cases = [c for c in r["later"] if c["requires"]]
    assert {c["id"] for c in cases} == {"ub-surface", "gobi-mines-1km", "khovsgol-snow", "skin-vs-air"}
    assert not any(c["requires"] for c in r["now"]) and len(r["later"]) == len(r["now"]) + 4

    class Quiet(SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    srv = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(ROOT)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        with playwright.sync_playwright() as p:
            browser = p.chromium.launch(executable_path=shutil.which("chromium"), args=["--no-sandbox"])
            page = browser.new_page(viewport=dict(width=1440, height=950), service_workers="block")
            page.add_init_script("localStorage.setItem('td.lang','en')")
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.route("**/data/index.js", lambda r: r.fulfill(content_type="application/javascript", body=(out / "index.js").read_text(encoding="utf-8")))
            def serve(sid):                               # one handler per scene (the route handler receives route and request)
                return lambda r: r.fulfill(content_type="application/javascript", body=(out / f"{sid}.js").read_text(encoding="utf-8"))
            for sid in ids:
                page.route(f"**/data/{sid}.js", serve(sid))
            page.goto(f"http://127.0.0.1:{srv.server_port}/web/index.html")
            playwright.expect(page.locator("#modal .caseboard")).to_be_visible()
            assert page.locator("#modal .casecard").count() == len(r["later"]) + 1 and "more case files" not in page.locator("#modal").inner_text()
            page.locator("#modalclose").click()
            seen = {}
            for c in cases:
                page.locator("#casesbtn").click()
                page.locator(f'#modal [data-case="{c["id"]}"]').click()
                for k in range(c["steps"]):
                    _settled(page)
                    assert page.evaluate("location.hash") == f"#case/{c['id']}/{k + 1}"
                    body = page.locator("#casebar .casebody").inner_text()
                    assert "Resume the case" not in body and "NaN" not in body and "undefined" not in body, (c["id"], k, body)
                    if k < c["steps"] - 1:
                        ev = page.locator("#casebar .evidence").inner_text()
                        assert re.search(r"\d", ev), (c["id"], k, body)
                        seen[(c["id"], k)] = ev
                        page.locator('[data-case-nav="next"]').click()
                    else:
                        assert page.locator("#casebar .verdict").count() == 1 and "What is changing" in body, (c["id"], body)
                        seen[(c["id"], k)] = body
                page.locator('[data-case-nav="exit"]').click()
            # the selections and the cross-grid comparison really happened
            assert "City box (" in seen[("ub-surface", 1)] and "cells)" in seen[("ub-surface", 1)]
            assert "Tavan Tolgoi box (" in seen[("gobi-mines-1km", 1)] and "Oyu Tolgoi box (" in seen[("gobi-mines-1km", 2)]
            assert "Mörön cell:" in seen[("khovsgol-snow", 1)] and "night surface" in seen[("khovsgol-snow", 2)]
            assert "share the sign" in seen[("skin-vs-air", 2)] and "%" in seen[("skin-vs-air", 2)] and "surface" in seen[("skin-vs-air", 2)]
            assert "of 5 km cells" not in seen[("skin-vs-air", 3)] and "share the sign" in seen[("skin-vs-air", 3)]
            # the last verdict keeps the split view; the next case's first step (a scene without a compare action) closes it
            assert page.evaluate("TDApp.cmp.on") is True
            page.locator("#casesbtn").click()
            page.locator('#modal [data-case="planet-warming"]').click()
            _settled(page)
            assert page.evaluate("TDApp.cmp.on") is False and page.evaluate("TDApp.state.sc.id") == "global-t2m"
            page.locator('[data-case-nav="exit"]').click()
            assert not errors, errors
            browser.close()
    finally:
        srv.shutdown(); srv.server_close()
