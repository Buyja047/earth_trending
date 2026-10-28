"""Monte Carlo check of the local tests, written to web/data/validation.js.

For AR(1) noise of several strengths (45 years of monthly data) we count how
often each test calls a trend significant at 5 % when there is no trend
(size; should be ~0.05) and when the trend equals Weatherhead's minimum
detectable trend (power; Weatherhead's formula targets 0.90).

A second experiment checks the "year detectable" range: for trends that need
a known number of years n* to detect, how often the range built from the Sen
confidence interval and Weatherhead's uncertainty factor contains that n*.
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
            "tests": TESTS, "rows": rows, "detection": run_detection(reps, years, seed + 1),
            "one_per_year": run_one_per_year(seed=seed + 2)}


def run_one_per_year(reps=2000, lengths=(44, 25), phis=(0.0, 0.3, 0.6), seed=2028) -> dict:
    """False-positive rates when there is one value per year (annual means or one season).

    phi is now the memory from one year to the next. With 20-45 values the AR(1)
    correction is estimated from few points, so the test is checked separately
    from the monthly case. ``agree`` is the share flagged by the corrected
    Mann-Kendall and OLS + AR(1) tests together, with the same sign.
    """
    rng = np.random.default_rng(seed)
    rows = []
    for n in lengths:
        t = 1981 + np.arange(n) + 0.5
        for phi in phis:
            r = stats.analyze_rows(ar1(rng, n, phi, reps), t)
            both = (r["p_mk"] < 0.05) & (r["p_ols_ar1"] < 0.05) & (np.sign(r["sen"]) == np.sign(r["ols"]))
            rows.append({"n": n, "phi": phi, "size": {k: round(float(np.mean(r[k] < 0.05)), 3) for k in ("p_naive", "p_mk", "p_ols_ar1")},
                         "agree": round(float(np.mean(both)), 3)})
    return {"reps": reps, "seed": seed, "mc_standard_error_at_5pct": round(float(np.sqrt(0.05 * 0.95 / reps)), 4), "rows": rows}


def run_detection(reps=400, years=45, seed=2027) -> dict:
    """Coverage of the n* range for trends that need n_true years to detect.

    Noise has sigma_N = 1, so the planted trend is K sqrt((1+phi)/(1-phi)) / n_true^1.5.
    ``noise_part`` isolates the sigma_N/phi part: n* from the true trend but
    estimated noise, inside e^+-B with m = samples (used) or m = years.
    """
    rng = np.random.default_rng(seed)
    rows = []
    for sampling, phis, ntrues in (("monthly", (0.0, 0.3, 0.6, 0.9), (20.0, 45.0, 90.0)),
                                   ("annual", (0.0, 0.3, 0.6), (45.0,))):
        step = 1.0 / 12.0 if sampling == "monthly" else 1.0
        m = int(round(years / step))
        t = 1981 + (np.arange(m) + 0.5) * step
        for phi in phis:
            noise = ar1(rng, m, phi, reps)
            for n_true in ntrues:
                omega = stats._weatherhead_k(step) * np.sqrt((1 + phi) / (1 - phi)) / n_true**1.5
                r = stats.analyze_rows(noise + omega * (t - t[0]), t)
                lo, hi = stats.detection_range(r["nstar"], r["sen"], r["sen_lo"], r["sen_hi"], r["phi"], m)
                trend_lo, trend_hi = stats.detection_range(r["nstar"], r["sen"], r["sen_lo"], r["sen_hi"], r["phi"], np.inf)
                log_err = np.abs(np.log(stats.weatherhead_nstar(r["sigma"], r["phi"], omega, step) / n_true))
                rows.append({
                    "sampling": sampling, "phi": phi, "n_true": n_true,
                    "cover_range": round(float(np.mean((lo <= n_true) & (n_true <= hi))), 3),
                    "cover_trend_ci_only": round(float(np.mean((trend_lo <= n_true) & (n_true <= trend_hi))), 3),
                    "noise_part_b_samples": round(float(np.mean(log_err <= stats.weatherhead_b(r["phi"], m))), 3),
                    "noise_part_b_years": round(float(np.mean(log_err <= stats.weatherhead_b(r["phi"], years))), 3),
                    "median_ratio": round(float(np.median(r["nstar"] / n_true)), 3),
                })
    return {"reps": reps, "years": years, "seed": seed, "rows": rows}


if __name__ == "__main__":
    out = Path(__file__).resolve().parent.parent / "web" / "data" / "validation.js"
    res = run()
    write_payload(out, "validation", res)
    for r in res["rows"] + res["detection"]["rows"] + res["one_per_year"]["rows"]:
        print(r)
