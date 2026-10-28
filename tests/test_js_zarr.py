"""The browser's Zarr reader (web/js/zarr.js, live.js) must agree with numcodecs and the Python engine."""

import base64
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

from trend_detective.geo import load_focus_rings, points_in_rings
from trend_detective.payload import read_payload

numcodecs = pytest.importorskip("numcodecs")
from numcodecs import Blosc, FixedScaleOffset  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node is not installed")


def run_node(script: str, payload) -> list:
    out = subprocess.run([NODE, "-e", script], input=json.dumps(payload), capture_output=True, text=True,
                         check=True, cwd=ROOT)
    return json.loads(out.stdout)


def b64(x: bytes) -> str:
    return base64.b64encode(x).decode()


def blosc_cases():
    rng = np.random.default_rng(3)
    x = (rng.standard_normal(50_000) * 10).astype("<f4")
    plan = [
        ("byte shuffle", x, dict(shuffle=Blosc.SHUFFLE)),
        ("bit shuffle", x, dict(shuffle=Blosc.BITSHUFFLE)),
        ("bit shuffle, count not a multiple of 8", x[:50_003], dict(shuffle=Blosc.BITSHUFFLE)),
        ("no shuffle", x, dict(shuffle=Blosc.NOSHUFFLE)),
        ("many blocks + leftover, byte", x[:20_001], dict(shuffle=Blosc.SHUFFLE, blocksize=4096, clevel=5)),
        ("many blocks + leftover, bit", x[:20_001], dict(shuffle=Blosc.BITSHUFFLE, blocksize=4096, clevel=5)),
        ("stored uncompressed", x[:5000], dict(shuffle=Blosc.SHUFFLE, clevel=0)),
        ("float64 bit shuffle", rng.standard_normal(9_999).astype("<f8"), dict(shuffle=Blosc.BITSHUFFLE)),
        ("int16 byte shuffle", rng.integers(-999, 3000, 7_777).astype("<i2"), dict(shuffle=Blosc.SHUFFLE)),
        ("NaNs, bit shuffle", np.where(rng.random(40_000) < 0.3, np.nan, x[:40_000]).astype("<f4"),
         dict(shuffle=Blosc.BITSHUFFLE)),
    ]
    out = []
    for name, arr, kw in plan:
        kw.setdefault("clevel", 3)
        out.append({"name": name, "enc": b64(Blosc(cname="zstd", **kw).encode(arr)), "raw": b64(arr.tobytes())})
    return out


def test_blosc_decode_matches_numcodecs():
    cases = blosc_cases()
    # c-blosc splits blocks per byte only when asked to for zstd; force it in a fresh process
    forced = subprocess.run(
        [sys.executable, "-c",
         "import base64,json,numpy as np;from numcodecs import Blosc;"
         "x=np.random.default_rng(4).standard_normal(50000).astype('<f4');"
         "e=Blosc(cname='zstd',clevel=3,shuffle=Blosc.SHUFFLE).encode(x);"
         "print(json.dumps({'name':'split blocks','enc':base64.b64encode(e).decode(),"
         "'raw':base64.b64encode(x.tobytes()).decode(),'flags':e[2]}))"],
        capture_output=True, text=True, check=True, env=dict(os.environ, BLOSC_SPLITMODE="ALWAYS"))
    split = json.loads(forced.stdout)
    if not split.pop("flags") & 0x10:  # the split path is only exercised when the encoder honoured the request
        cases.append(split)
    script = (
        "const Z = require('./web/js/zarr.js'); const cases = JSON.parse(require('fs').readFileSync(0, 'utf8'));"
        "const b = (s) => new Uint8Array(Buffer.from(s, 'base64'));"
        "console.log(JSON.stringify(cases.map((c) => { const g = Z.bloscDecode(b(c.enc)), e = b(c.raw);"
        "return [c.name, g.length === e.length && g.every((v, k) => v === e[k])]; })));"
    )
    for name, same in run_node(script, cases):
        assert same, name


def test_zarr_pipeline_is_bit_exact():
    """fixedscaleoffset + Blosc as in the NASA POWER stores; float32 rounding must match numcodecs."""
    rng = np.random.default_rng(5)
    for scale in (10, 100, 10000):
        f = FixedScaleOffset(scale=scale, offset=1000, dtype="<f4", astype="<f4")
        y = np.where(rng.random(30_000) < 0.05, np.nan, rng.normal(5, 12, 30_000)).astype("<f4")
        enc = Blosc(cname="zstd", clevel=3, shuffle=Blosc.SHUFFLE).encode(f.encode(y))
        expect = np.asarray(f.decode(Blosc().decode(enc)), "<f4")
        script = (
            "const Z = require('./web/js/zarr.js'); const c = JSON.parse(require('fs').readFileSync(0, 'utf8'));"
            "const g = Z.decodeChunk(new Uint8Array(Buffer.from(c.enc, 'base64')), c.scale, 1000, c.n);"
            "console.log(JSON.stringify(Buffer.from(g.buffer).toString('base64')));"
        )
        got = np.frombuffer(base64.b64decode(run_node(script, {"enc": b64(enc), "scale": scale, "n": y.size})),
                            "<f4")
        assert np.array_equal(got.view("<u4"), expect.view("<u4")), scale


def test_point_in_rings_matches_python():
    rings = load_focus_rings(ROOT / "web" / "data" / "geo.js")
    rng = np.random.default_rng(6)
    lon, lat = rng.uniform(86, 121, 3000), rng.uniform(40, 53, 3000)
    expect = points_in_rings(lon, lat, rings)
    script = (
        "const L = require('./web/js/live.js'); const c = JSON.parse(require('fs').readFileSync(0, 'utf8'));"
        "console.log(JSON.stringify(c.lon.map((x, k) => L.inRings(x, c.lat[k], c.rings))));"
    )
    got = run_node(script, {"lon": lon.tolist(), "lat": lat.tolist(), "rings": [r.tolist() for r in rings]})
    assert np.array_equal(np.array(got), expect)


def test_live_plan_selects_the_precomputed_grid():
    """The Mongolia box picks the same MERRA-2 cells as the Python scene (inclusive cell centres)."""
    cat_path = ROOT / "web" / "data" / "power-catalog.js"
    cat, ref = read_payload(cat_path), read_payload(ROOT / "web" / "data" / "mn-t2m.js")
    script = (
        "const L = require('./web/js/live.js'); const c = JSON.parse(require('fs').readFileSync(0, 'utf8'));"
        "const p = L.plan(c.cat, 'merra2', 't2m', [87.5, 41, 120.5, 52.5], 1981, 2025);"
        "const q = L.plan(c.cat, 'merra2', 'T2M', [0, 0, 179, 60], 1981, 2025);"
        "const r = L.plan(c.cat, 'merra2', 'NOPE', [87.5, 41, 120.5, 52.5], 1981, 2025);"
        "console.log(JSON.stringify([p, q.error, r.error]));"
    )
    p, too_big, unknown = run_node(script, {"cat": cat})
    m = cat["products"]["merra2"]
    lat = [m["lat0"] + (p["iy0"] + j) * m["dlat"] for j in range(p["ny"])]
    lon = [m["lon0"] + (p["ix0"] + i) * m["dlon"] for i in range(p["nx"])]
    assert np.allclose(lat, ref["grid"]["lat"]) and np.allclose(lon, ref["grid"]["lon"])
    assert "error" not in p and len(p["chunks"]) == 6 and p["nm"] == 540
    assert too_big == "cells" and unknown == "var"


def test_catalog_is_consistent():
    cat = read_payload(ROOT / "web" / "data" / "power-catalog.js")
    for name, p in cat["products"].items():
        assert p["compressor"]["cname"] == "zstd" and p["chunks"][0] == p["nt"]
        names = [r[0] for r in p["vars"]]
        assert len(names) == len(set(names)) and all(len(r) == len(p["var_columns"]) for r in p["vars"])
        assert all(r[4] in (10, 100, 1000, 10000) for r in p["vars"]), name
