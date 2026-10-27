"""Monte Carlo check of the local tests, written to web/data/validation.js.

For AR(1) noise of several strengths (45 years of monthly data) we count how
often each test calls a trend significant at 5 % when there is no trend
(size; should be ~0.05) and when the trend equals Weatherhead's minimum
detectable trend (power; Weatherhead's formula targets 0.90).
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from . import stats
from .payload import write_payload

TESTS = {
    "p_naive": "Mann-Kendall, no correction",
    "p_hr_empirical": "Hamed-Rao as published (screened lags)",
    "p_mk": "Mann-Kendall, AR(1)-modelled Hamed-Rao (used here)",
    "p_ols_ar1": "OLS + AR(1) effective n (Santer 2000)",
}


def ar1(rng, n, phi, reps):
    e = rng.standard_normal((reps, n))
    x = np.empty_like(e)
    x[:, 0] = e[:, 0] / np.sqrt(1 - phi**2)
    for k in range(1, n):
        x[:, k] = phi * x[:, k - 1] + e[:, k]
    return x * np.sqrt(1 - phi**2)


def run(reps=400, years=45, phis=(0.0, 0.3, 0.6, 0.9), seed=2026) -> dict:
    rng = np.random.default_rng(seed)
    n = years * 12
    t = 1981 + (np.arange(n) + 0.5) / 12
    rows = []
    for phi in phis:
        x = ar1(rng, n, phi, reps)
        mdt = float(stats.min_detectable_trend(1.0, phi, years))
        r0 = stats.analyze_rows(x, t)
        r1 = stats.analyze_rows(x + mdt * (t - t[0]), t)
        rows.append({
            "phi": phi,
            "mdt_per_decade": round(mdt * 10, 4),
            "size": {k: round(float(np.mean(r0[k] < 0.05)), 3) for k in TESTS},
            "power_at_mdt": {k: round(float(np.mean(r1[k] < 0.05)), 3) for k in TESTS},
            "sen_ci_coverage": round(float(np.mean((r1["sen_lo"] <= mdt) & (r1["sen_hi"] >= mdt))), 3),
        })
    mc_se = round(float(np.sqrt(0.05 * 0.95 / reps)), 4)
    return {"reps": reps, "years": years, "seed": seed, "mc_standard_error_at_5pct": mc_se,
            "tests": TESTS, "rows": rows}


if __name__ == "__main__":
    out = Path(__file__).resolve().parent.parent / "web" / "data" / "validation.js"
    res = run()
    write_payload(out, "validation", res)
    for r in res["rows"]:
        print(r)
