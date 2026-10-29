"""Tile math for the NASA GIBS background (web/js/basemap.js).

Expected values come from GIBS's WMTSCapabilities for the EPSG:4326 "best" endpoint
(read 2026-10-27): top-left (-180, 90), 512-pixel tiles, matrix sizes below.
"""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node is not installed")

# (MatrixWidth, MatrixHeight) per TileMatrix of the 15.625m set, which includes all coarser levels
CAPABILITIES_MATRIX = [(2, 1), (3, 2), (5, 3), (10, 5), (20, 10), (40, 20), (80, 40), (160, 80),
                       (320, 160), (640, 320), (1280, 640), (2560, 1280), (5120, 2560)]


def js(expr: str):
    script = f"const B = require('./web/js/basemap.js'); console.log(JSON.stringify({expr}));"
    return json.loads(subprocess.run([NODE, "-e", script], capture_output=True, text=True, check=True,
                                     cwd=ROOT).stdout)


def test_matrix_sizes_match_capabilities():
    got = js("Array.from({length: 13}, (_, z) => [B.matrix(z).cols, B.matrix(z).rows])")
    assert [tuple(x) for x in got] == CAPABILITIES_MATRIX


def test_level_choice_and_tiles():
    # whole globe on an 830-pixel canvas: 2.3 px per degree -> level 1 (0.28 deg per tile pixel)
    assert js("B.level(B.LAYERS.relief, 830 / 360)") == 1
    # never beyond the layer's deepest level (500m sets stop at 7, 31.25m at 11)
    assert js("[B.level(B.LAYERS.relief, 1e4), B.level(B.LAYERS.terrain, 1e4)]") == [7, 11]
    assert js("B.tiles(0, -180, 180, -90, 90).length") == 2
    assert js("B.tiles(1, -180, 180, -90, 90).length") == 6
    # Mongolia at level 5 (9-degree tiles): columns 29-33, rows 4-5
    t = js("B.tiles(5, 87.5, 120.5, 41, 52.5).map((t) => [t.r, t.c])")
    assert sorted({c for _, c in t}) == [29, 30, 31, 32, 33] and sorted({r for r, _ in t}) == [4, 5]
    edge = js("B.tiles(0, 170, 180, -90, -80)")
    assert edge == [{"z": 0, "r": 0, "c": 1, "lon0": 108, "lon1": 396, "lat1": 90, "lat0": -198}]


def test_urls_follow_capabilities_templates():
    t = {"z": 3, "r": 1, "c": 7}
    urls = js(f"['relief', 'night', 'day'].map((k) => B.url(B.LAYERS[k], {json.dumps(t)}, '2024-05-01'))")
    base = "https://gibs.earthdata.nasa.gov/wmts/epsg4326/best"
    assert urls == [f"{base}/BlueMarble_ShadedRelief_Bathymetry/default/500m/3/1/7.jpeg",
                    f"{base}/VIIRS_Black_Marble/default/2016-01-01/500m/3/1/7.png",
                    f"{base}/MODIS_Terra_CorrectedReflectance_TrueColor/default/2024-05-01/250m/3/1/7.jpeg"]


def test_sentinel_wms_uses_lon_lat_and_clips_world_padding():
    from urllib.parse import parse_qs, urlsplit

    urls = js("B.tiles(0, -180, 180, -90, 90).map(t => B.url(B.LAYERS.sentinel, t))")
    boxes = []
    for url in urls:
        parts = urlsplit(url)
        assert parts.scheme == 'https' and parts.netloc == 'tiles.maps.eox.at'
        q = parse_qs(parts.query, keep_blank_values=True)
        assert q['VERSION'] == ['1.1.1']
        assert q['SRS'] == ['EPSG:4326']
        assert q['LAYERS'] == ['s2cloudless-2020']
        assert q['WIDTH'] == ['512'] and q['HEIGHT'] == ['512']
        boxes.append([float(v) for v in q['BBOX'][0].split(',')])
    assert boxes == [[-180, -90, 108, 90], [108, -90, 180, 90]]


def test_sentinel_supports_detail_beyond_terrain():
    assert js('B.level(B.LAYERS.sentinel, 20000)') == 13
    assert js('B.level(B.LAYERS.terrain, 20000)') == 11
