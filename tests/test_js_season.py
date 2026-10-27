"""Season means in the browser (web/js/season.js) against the Python reference (analysis.season_means)."""

import base64
import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest

from trend_detective import stats as S
from trend_detective.analysis import annual_means, season_means
from trend_detective.payload import read_payload

ROOT = Path(__file__).resolve().parent.parent
NODE = shutil.which("node")
SEASONS = [(12, 2), (3, 5), (6, 8), (9, 11), (11, 3), (5, 9), (1, 1), (12, 12), (7, 7), (1, 12)]


def _js(script: str, payload) -> list:
    return json.loads(subprocess.run([NODE, "-e", script], input=json.dumps(payload), capture_output=True,
                                     text=True, check=True).stdout)


def test_season_labels_and_completeness():
    t = 1981 + (np.arange(36) + 0.5) / 12                     # Jan 1981 .. Dec 1983
    x = np.arange(36, dtype=float)
    years, djf = season_means(x[None, :], t, 12, 2)
    assert years.tolist() == [1982, 1983]                     # DJF 1981 lacks Dec 1980
    assert djf[0].tolist() == [(11 + 12 + 13) / 3, (23 + 24 + 25) / 3]
    years, nd = season_means(x[None, :], t, 11, 12)
    assert years.tolist() == [1981, 1982, 1983]               # no wrap: labelled by its own year
    years, full = season_means(x[None, :], t, 1, 12)
    ya, ann = annual_means(x[None, :], t)
    assert years.tolist() == ya.tolist() and np.allclose(full, ann)


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_js_season_matches_python():
    rng = np.random.default_rng(7)
    cases = []
    for start_month, n in ((0, 540), (6, 301), (11, 97)):    # records starting in Jan, Jul, Dec
        t = 1990 + (start_month + np.arange(n) + 0.5) / 12
        x = np.round(rng.standard_normal(n), 4)
        x[rng.choice(n, 9, replace=False)] = np.nan
        cases.append((t, x))
    script = (
        "const T = require(%s); const c = JSON.parse(require('fs').readFileSync(0, 'utf8'));"
        "console.log(JSON.stringify(c.map(q => { const s = T.series(q.x, q.start, q.m0, q.m1);"
        " return { years: s.years, vals: s.vals.map(v => Number.isFinite(v) ? v : null), off: s.off }; })));"
    ) % json.dumps(str(ROOT / "web" / "js" / "season.js"))
    payload, ref = [], []
    for t, x in cases:
        for m0, m1 in SEASONS:
            payload.append({"x": [None if np.isnan(v) else v for v in x], "start": t[0], "m0": m0, "m1": m1})
            ref.append(season_means(x[None, :], t, m0, m1))
    out = _js(script, payload)
    for (years, vals), js, p in zip(ref, out, payload):
        assert js["years"] == years.tolist(), (p["m0"], p["m1"])
        jv = np.array([np.nan if v is None else v for v in js["vals"]])
        assert np.array_equal(np.isnan(jv), np.isnan(vals[0]))
        assert np.allclose(jv[~np.isnan(jv)], vals[0][~np.isnan(vals[0])], rtol=0, atol=1e-12)
    # mid-point of the season: Dec-Feb sits just after New Year, Mar-May near 1 April
    assert out[0]["off"] == pytest.approx(0.5 / 12)
    assert out[1]["off"] == pytest.approx(3.5 / 12)


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_js_season_trend_on_real_cell():
    """One Mongolian cell as the page stores it: season series and test results agree end to end."""
    sc = read_payload(ROOT / "web" / "data" / "mn-t2m.js")
    n, ncell = sc["series"]["n"], sc["grid"]["nx"] * sc["grid"]["ny"]
    raw = np.frombuffer(base64.b64decode(sc["series"]["b64"]), dtype="<i2").reshape(ncell, n)
    c = int(np.argmax(np.array(sc["cells"]["status"]) == 1))
    x = np.where(raw[c] == -32768, np.nan, raw[c] * sc["series"]["scale"])
    start = sc["series"]["start"]
    t = start + np.arange(n) / 12
    script = (
        "const T = require(%s), S = require(%s); const q = JSON.parse(require('fs').readFileSync(0, 'utf8'));"
        "console.log(JSON.stringify(q.seasons.map(([m0, m1]) => { const s = T.series(q.x, q.start, m0, m1);"
        " const r = S.analyze(s.vals, s.years.map(y => y + s.off)); return [s.years[0], s.vals.length, r.sen, r.pMk, r.nstar]; })));"
    ) % (json.dumps(str(ROOT / "web" / "js" / "season.js")), json.dumps(str(ROOT / "web" / "js" / "stats.js")))
    out = _js(script, {"x": [None if np.isnan(v) else float(v) for v in x], "start": start, "seasons": SEASONS[:6]})
    for (m0, m1), (y_first, count, sen, p_mk, nstar) in zip(SEASONS[:6], out):
        years, vals = season_means(x[None, :], t, m0, m1)
        py = S.analyze_series(vals[0], years + (np.mean([((m - 1) % 12 + 0.5) / 12 - (1 if m0 > m1 and (m - 1) % 12 + 1 >= m0 else 0)
                                                         for m in range(m0, m0 + ((m1 - m0) % 12) + 1)])))
        assert (y_first, count) == (int(years[0]), len(years))
        assert sen == pytest.approx(py["sen"], rel=1e-9)
        assert p_mk == pytest.approx(py["p_mk"], rel=1e-5, abs=1e-12)
        assert nstar == pytest.approx(py["nstar"], rel=1e-6)
    assert out[0][:2] == [1982, 44]                          # Dec-Feb: the record starts in January 1981


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_js_season_from_stored_integers_is_bit_exact():
    """The page averages the stored 16-bit integers and scales after, so equal sums give equal means."""
    sc = read_payload(ROOT / "web" / "data" / "mn-t2m.js")
    n, scale = sc["series"]["n"], sc["series"]["scale"]
    raw = np.frombuffer(base64.b64decode(sc["series"]["b64"]), dtype="<i2").reshape(-1, n)[:40]
    t = sc["series"]["start"] + np.arange(n) / 12
    script = (
        "const T = require(%s); const q = JSON.parse(require('fs').readFileSync(0, 'utf8'));"
        "const pl = T.plan(q.n, q.start, q.m0, q.m1), raw = Int16Array.from(q.raw.flat());"
        "console.log(JSON.stringify(q.raw.map((_, c) => T.apply(raw, pl, c * q.n, q.scale))));"
    ) % json.dumps(str(ROOT / "web" / "js" / "season.js"))
    for m0, m1 in ((3, 5), (12, 2), (11, 3)):
        out = np.array(_js(script, {"raw": raw.tolist(), "n": n, "start": sc["series"]["start"], "m0": m0, "m1": m1, "scale": scale}))
        _, ref = season_means(np.where(raw == -32768, np.nan, raw.astype(float)), t, m0, m1)
        assert np.array_equal(out, ref * scale)


def test_one_per_year_size_check_runs():
    from trend_detective.validation import run_one_per_year
    r = run_one_per_year(reps=60, lengths=(25,), phis=(0.0, 0.6), seed=1)
    assert [row["phi"] for row in r["rows"]] == [0.0, 0.6]
    assert all(0 <= row["agree"] <= row["size"]["p_mk"] for row in r["rows"])
