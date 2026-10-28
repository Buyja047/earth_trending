"""The browser statistics (web/js/stats.js) must agree with the Python engine."""

import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest

from trend_detective import stats as S

ROOT = Path(__file__).resolve().parent.parent
NODE = shutil.which("node")


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_js_matches_python():
    rng = np.random.default_rng(4)
    cases = []
    for n, phi, slope in ((45, 0.2, 0.02), (120, 0.6, 0.0), (240, 0.4, 0.01)):
        e = rng.standard_normal(n)
        x = np.empty(n)
        x[0] = e[0]
        for k in range(1, n):
            x[k] = phi * x[k - 1] + e[k]
        t = 1981 + np.arange(n) / 12.0 if n > 45 else 1981.5 + np.arange(n, dtype=float)
        x = np.round(x + slope * np.arange(n), 3)
        cases.append((x, t))
    script = (
        "const S = require(%s); const cases = JSON.parse(process.argv[1]);"
        "console.log(JSON.stringify(cases.map(c => S.analyze(c.x, c.t))));"
    ) % json.dumps(str(ROOT / "web" / "js" / "stats.js"))
    payload = json.dumps([{"x": x.tolist(), "t": t.tolist()} for x, t in cases])
    out = json.loads(subprocess.run([NODE, "-e", script, payload], capture_output=True,
                                    text=True, check=True).stdout)
    for (x, t), js in zip(cases, out):
        py = S.analyze_series(x, t)
        assert js["S"] == py["S"]
        assert js["varS"] == pytest.approx(py["var_s"])
        assert js["pNaive"] == pytest.approx(py["p_naive"], rel=1e-5, abs=1e-9)
        assert js["pMk"] == pytest.approx(py["p_mk"], rel=1e-5, abs=1e-9)
        assert js["sen"] == pytest.approx(py["sen"], rel=1e-9)
        assert js["senLo"] == pytest.approx(py["sen_lo"], rel=1e-9)
        assert js["senHi"] == pytest.approx(py["sen_hi"], rel=1e-9)
        assert js["pOls"] == pytest.approx(py["p_ols_ar1"], rel=1e-5)
        assert js["mdt"] == pytest.approx(py["mdt"], rel=1e-6)


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_js_detection_range_matches_python():
    cases = [(40.0, 0.02, 0.01, 0.04, 0.3, 540), (12.5, -0.3, -0.5, -0.1, 0.8, 45), (60.0, 0.01, -0.002, 0.02, 0.0, 300)]
    script = (
        "const S = require(%s); const cases = JSON.parse(process.argv[1]);"
        "console.log(JSON.stringify(cases.map(c => { const r = S.detectionRange(...c); return [r.lo, r.hi === Infinity ? null : r.hi]; })));"
    ) % json.dumps(str(ROOT / "web" / "js" / "stats.js"))
    out = json.loads(subprocess.run([NODE, "-e", script, json.dumps(cases)], capture_output=True,
                                    text=True, check=True).stdout)
    for c, (jlo, jhi) in zip(cases, out):
        lo, hi = S.detection_range(*([v] for v in c[:4]), c[4], c[5])
        assert jlo == pytest.approx(lo[0], rel=1e-12)
        assert (jhi is None and np.isinf(hi[0])) or jhi == pytest.approx(hi[0], rel=1e-12)
