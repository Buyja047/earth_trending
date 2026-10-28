"""Checks of the daily hazard indices against independent and related records.

1. Threshold sensitivity: country-mean trend and per-cell agreement of dust-prone
   days at 6, 8 and 10 m/s.
2. Does the index track dust? Monthly anomalies of dust-prone days against MERRA-2
   surface dust (DUSMASS, same model, so a consistency check) and CERES aerosol
   optical depth (satellite, 2001-2025), as country means and over the South Gobi.

Usage: python scripts/check_hazard.py OUT.json
"""

import base64
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from trend_detective.payload import read_payload  # noqa: E402

DATA = ROOT / "web" / "data"
GOBI = (100.0, 41.0, 112.0, 45.5)   # lon0, lat0, lon1, lat1


def scene(key):
    sc = read_payload(DATA / f"{key}.js")
    n, nc = sc["series"]["n"], sc["grid"]["nx"] * sc["grid"]["ny"]
    raw = np.frombuffer(base64.b64decode(sc["series"]["b64"]), dtype="<i2").reshape(nc, n)
    sc["_x"] = np.where(raw == -32768, np.nan, raw * sc["series"]["scale"])
    sc["_t"] = sc["series"]["start"] + np.arange(n) / 12
    return sc


def box_mean(sc, box):
    lat = np.repeat(np.asarray(sc["grid"]["lat"]), sc["grid"]["nx"])
    lon = np.tile(np.asarray(sc["grid"]["lon"]), sc["grid"]["ny"])
    w = np.cos(np.radians(lat))
    m = (lon >= box[0]) & (lon <= box[2]) & (lat >= box[1]) & (lat <= box[3]) & np.isfinite(sc["_x"]).all(axis=1)
    return (sc["_x"][m] * w[m, None]).sum(0) / w[m].sum(), sc["_t"]


def country(sc):
    rm = sc["region_means"][0]
    return np.array([np.nan if v is None else v for v in rm["monthly"]]), rm["monthly_start"] + np.arange(len(rm["monthly"])) / 12


def corr(a, ta, b, tb, months):
    """Pearson r of two monthly anomaly series on their common months in the given calendar months."""
    ka = {int(np.floor(t * 12 + 1e-6)): v for t, v in zip(ta, a)}   # mid-month times: floor gives the month
    kb = {int(np.floor(t * 12 + 1e-6)): v for t, v in zip(tb, b)}
    common = sorted(k for k in ka if k in kb and (k % 12) + 1 in months and np.isfinite(ka[k]) and np.isfinite(kb[k]))
    x, y = np.array([ka[k] for k in common]), np.array([kb[k] for k in common])
    return {"r": round(float(np.corrcoef(x, y)[0, 1]), 3), "n": len(common)}


def _trend(x, t):
    """Sen slope per decade, 95 % CI and corrected p after removing each calendar month's mean."""
    from trend_detective import stats as S

    x = np.asarray(x, float).copy()
    m = np.floor((t - np.floor(t)) * 12 + 1e-6).astype(int)
    for k in range(12):
        x[m == k] -= np.nanmean(x[m == k])
    r = S.analyze_series(x, t)
    return {"per_decade": round(r["sen"] * 10, 4), "ci": [round(r["sen_lo"] * 10, 4), round(r["sen_hi"] * 10, 4)],
            "p_corrected": float(f"{r['p_mk']:.3g}")}


def start_year_sensitivity():
    """Country-mean trends from 1981, 1992 (a MERRA-2 production-stream boundary) and 2001."""
    out = {}
    for key in ("mn-dustdays", "mn-dustdays6", "mn-dustdays10", "mn-windydays", "mn-wetdays", "mn-rx1day"):
        x, t = country(read_payload(DATA / f"{key}.js"))
        out[key] = {f"{y0}-2025": _trend(x[t >= y0], t[t >= y0]) for y0 in (1981, 1992, 2001)}
    return out


def ulaanbaatar_heavy_rain():
    """Rx1day and R10mm in the MERRA-2 cell over Ulaanbaatar against GPM IMERG daily, 2001-2025."""
    import xarray as xr

    from trend_detective import hazard, power

    im = hazard._retry(lambda: xr.open_zarr(f"{power.BUCKET_URL}/imerg/temporal/power_imerg_daily_temporal_utc.zarr",
                                            consolidated=True, storage_options=power.STORAGE_OPTIONS))
    p = hazard._retry(im["IMERG_PRECTOT"].sel(time=slice("2001-01-01", "2025-12-31"), lat=slice(47.75, 48.25),
                                              lon=slice(106.5625, 107.1875)).load)
    m2 = hazard._retry(hazard._open_daily()["PRECTOTCORR"].sel(time=slice("2001-01-01", "2025-12-31"), lat=48.0,
                                                               lon=106.875).load)
    flat = p.values.reshape(p.shape[0], -1)
    out = {}
    for name, x, days in (("MERRA-2 cell", m2.values, m2["time"].values),
                          ("IMERG mean over the cell", flat.mean(1), p["time"].values),
                          ("IMERG wettest 0.1 deg pixel", flat.max(1), p["time"].values)):
        months, pos = hazard.month_index(days)
        rx = hazard.monthly_max(x, pos, months.size)
        r10 = hazard.monthly_counts(x >= hazard.HEAVY_MM, pos, months.size)
        t = 2001 + (np.arange(months.size) + 0.5) / 12
        jja = np.isin(np.arange(months.size) % 12, (5, 6, 7))
        out[name] = {"rx1day_mean_mm": round(float(np.nanmean(rx)), 2), "rx1day_jja_mean_mm": round(float(np.nanmean(rx[jja])), 1),
                     "r10mm_days_per_year": round(12 * float(np.nanmean(r10)), 2),
                     "rx1day_trend_mm": _trend(rx, t), "r10mm_trend_days_per_month": _trend(r10, t)}
    return out


def main(out):
    res = {"thresholds": {}, "dust": {}}
    dd = {u: scene(f"mn-dustdays{'' if u == 8 else u}") for u in (6, 8, 10)}
    for u, sc in dd.items():
        s = sc["region_means"][0]["stats"]
        res["thresholds"][f"{u} m/s"] = {"country_trend_days_per_month_per_decade": s["sen"], "ci": [s["sen_lo"], s["sen_hi"]],
                                       "p_corrected": s["p_mk"], "cells_fdr_up": sc["counts"]["fdr_up"],
                                       "cells_fdr_down": sc["counts"]["fdr_down"], "cells_tested": sc["counts"]["valid"],
                                       "climatology_days_per_year": round(12 * float(np.nanmean(sc["region_means"][0]["raw_mean"])), 1)}
    # per-cell: sign of the FDR-significant trends at 8 m/s, and whether 6 and 10 m/s agree
    st8 = np.array(dd[8]["cells"]["status"])
    sig8 = (st8 == 1) | (st8 == 2)
    sen = {u: np.array([np.nan if v is None else v for v in dd[u]["cells"]["sen"]]) for u in dd}
    res["thresholds"]["cells_significant_at_8_with_same_sign_at_6_and_10"] = round(float(np.mean(
        (np.sign(sen[6][sig8]) == np.sign(sen[8][sig8])) & (np.sign(sen[10][sig8]) == np.sign(sen[8][sig8])))), 3)
    for key, label in (("mn-dust", "MERRA-2 surface dust (DUSMASS)"), ("mn-aod", "CERES aerosol optical depth")):
        try:
            other = scene(key)
        except FileNotFoundError:
            continue
        a, ta = country(dd[8])
        b, tb = country(other)
        ga, gta = box_mean(dd[8], GOBI)
        gb, gtb = box_mean(other, GOBI)
        res["dust"][label] = {"country_all_months": corr(a, ta, b, tb, range(1, 13)),
                              "country_mar_may": corr(a, ta, b, tb, (3, 4, 5)),
                              "south_gobi_all_months": corr(ga, gta, gb, gtb, range(1, 13)),
                              "south_gobi_mar_may": corr(ga, gta, gb, gtb, (3, 4, 5))}
    res["start_year"] = start_year_sensitivity()
    res["ulaanbaatar_heavy_rain"] = ulaanbaatar_heavy_rain()
    Path(out).write_text(json.dumps(res, indent=1))
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    main(sys.argv[1])
