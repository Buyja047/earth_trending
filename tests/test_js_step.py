"""The browser's step test and FDR threshold (web/js/stats.js) agree with the Python pipeline."""
import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest

from trend_detective import stats as S

ROOT = Path(__file__).resolve().parent.parent
NODE = shutil.which("node")


def series(seed, n=300, phi=0.4, trend=0.02, step=0.6, t_break=2010.0):
    rng = np.random.default_rng(seed)
    t = 2001 + (np.arange(n) + 0.5) / 12
    e = np.zeros(n)
    for k in range(1, n):
        e[k] = phi * e[k - 1] + rng.standard_normal()
    return t, trend * (t - t.mean()) + step * (t >= t_break) + e


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_step_regression_matches_python():
    cases = []
    for seed, (step, tb) in enumerate([(2.0, 2010.0), (0.0, 2015.25), (-2.5, 2005.0), (1.5, 2020.0)]):
        t, x = series(seed, step=step, t_break=tb)
        cases.append(dict(t=t.tolist(), x=x.tolist(), tb=tb))
    out = subprocess.run([NODE, "-e", """
      const S = require('./web/js/stats.js'), cases = JSON.parse(require('fs').readFileSync(0, 'utf8'));
      console.log(JSON.stringify(cases.map((c) => S.stepTest(c.x, c.t, c.tb))));"""],
                         input=json.dumps(cases), cwd=ROOT, capture_output=True, text=True, check=True).stdout
    js = json.loads(out)
    for c, r in zip(cases, js):
        step, p, trend = S.step_test_rows(np.array([c["x"]]), np.array(c["t"]), c["tb"])
        assert abs(r["step"] - step[0]) < 1e-8 and abs(r["trend"] - trend[0]) < 1e-8, (r, step, trend)
        assert abs(r["p"] - p[0]) < 2e-4, (r["p"], p[0])
    # a planted jump of 2 (noise σ ≈ 1.1 with memory 0.4) is found; no jump is not
    assert js[0]["p"] < 0.01 and js[1]["p"] > 0.05 and abs(js[0]["step"] - 2.0) < 0.5, js


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_step_outside_the_record_and_fdr_threshold():
    t, x = series(7)
    ps = np.random.default_rng(3).uniform(0, 1, 400).tolist()
    ps[:20] = (np.arange(20) * 1e-4).tolist()
    out = subprocess.run([NODE, "-e", """
      const S = require('./web/js/stats.js'), d = JSON.parse(require('fs').readFileSync(0, 'utf8'));
      console.log(JSON.stringify({before: S.stepTest(d.x, d.t, 1990), after: S.stepTest(d.x, d.t, 2100), star: S.fdrThreshold(d.ps, 0.1),
        none: S.fdrThreshold([0.5, 0.7, 0.9], 0.1)}));"""],
                         input=json.dumps(dict(t=t.tolist(), x=x.tolist(), ps=ps)), cwd=ROOT, capture_output=True, text=True, check=True).stdout
    r = json.loads(out)
    assert r["before"]["p"] is None and r["after"]["p"] is None      # NaN serialises as null
    assert abs(r["star"] - S.fdr_threshold(np.array(ps), 0.1)) < 1e-12 and r["none"] == 0
