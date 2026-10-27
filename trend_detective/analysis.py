"""Turn a (time, lat, lon) field into per-cell trend verdicts and region summaries."""

from __future__ import annotations

import numpy as np

from . import grid, stats

ALPHA_GLOBAL = 0.05
WILKS_FACTOR = 2.0

# Per-cell verdicts, strongest first
STATUS = {
    0: "no data / no variability",
    1: "trend detected (FDR) and parametric test agrees",
    2: "trend detected (FDR), parametric test disagrees",
    3: "naive p<0.05 only - would be a false alarm candidate",
    4: "not yet detectable - record too short for a trend this size",
    5: "inconclusive - trend this size should be detectable but is not significant",
    6: "excluded - some months missing (gaps or values masked by the provider)",
}


def months_of(times) -> np.ndarray:
    return (np.asarray(times, dtype="datetime64[M]").astype(int) % 12) + 1


def analyze_field(values: np.ndarray, times, lat, lon, breaks=(), dlat=None, dlon=None,
                  wrap_lon=False) -> dict:
    """Run the trend battery on every valid cell of ``values[time, lat, lon]``.

    A cell is valid when every month is present and its anomalies vary.
    ``breaks`` holds (decimal-year, label) pairs for documented transitions.
    """
    nt, ny, nx = values.shape
    t = stats.decimal_year(times)
    mon = months_of(times)
    flat = values.reshape(nt, -1).T.astype(float)
    anom, clim = stats.monthly_anomalies(flat, mon)
    finite = np.isfinite(anom)
    spread = np.zeros(anom.shape[0])
    rows_ok = finite.all(axis=1)
    spread[rows_ok] = anom[rows_ok].std(axis=1)
    valid = rows_ok & (spread > 1e-6)

    res = stats.analyze_rows(anom[valid], t, breaks=[b for b, _ in breaks])
    ncell = ny * nx

    def full(v, fill=np.nan):
        out = np.full(ncell, fill, dtype=float)
        out[valid] = v
        return out

    cells = {k: full(res[k]) for k in ("sen", "sen_lo", "sen_hi", "p_naive", "p_mk",
                                        "p_hr_empirical", "ols", "p_ols_ar1", "phi",
                                        "sigma", "mdt", "nstar", "var_factor")}
    cells["clim_mean"] = np.full(ncell, np.nan)
    cells["clim_mean"][valid] = flat[valid].mean(axis=1)

    fdr, pstar = stats.fdr_mask(cells["p_mk"], ALPHA_GLOBAL, WILKS_FACTOR)
    agree = (cells["p_ols_ar1"] < ALPHA_GLOBAL) & (np.sign(cells["ols"]) == np.sign(cells["sen"]))
    naive = cells["p_naive"] < ALPHA_GLOBAL
    years = stats.record_years(t)
    not_yet = cells["nstar"] > years

    present = np.isfinite(flat)
    gappy = present.any(axis=1) & ~present.all(axis=1)
    status = np.zeros(ncell, dtype=int)
    status[gappy] = 6
    status[valid] = 5
    status[valid & not_yet] = 4
    status[valid & naive & ~fdr] = 3
    status[fdr & ~agree] = 2
    status[fdr & agree] = 1

    steps = []
    for (tb, label), s in zip(breaks, res["steps"]):
        p_step = full(s["p_step"])
        smask, sp = stats.fdr_mask(p_step, ALPHA_GLOBAL, WILKS_FACTOR)
        steps.append({
            "t_break": tb, "label": label, "p_star": sp,
            "step": full(s["step"]), "p_step": p_step, "flag": smask,
            "trend_with_step": full(s["trend_with_step"]),
        })

    sen2d = cells["sen"].reshape(ny, nx)
    regions = []
    if dlat is not None:
        regions = grid.signed_regions(np.nan_to_num(sen2d), fdr.reshape(ny, nx), np.asarray(lat),
                                      np.asarray(lon), dlat, dlon, wrap_lon)
    return {
        "t": t, "anom": anom, "valid": valid, "cells": cells, "status": status,
        "fdr": fdr, "p_star": pstar, "agree": agree, "steps": steps, "regions": regions,
        "years": years, "n_tests": int(valid.sum()),
        "counts": {
            "valid": int(valid.sum()),
            "naive": int((naive & valid).sum()),
            "fdr": int(fdr.sum()),
            "robust": int((fdr & agree).sum()),
            "fdr_up": int((fdr & (cells["sen"] > 0)).sum()),
            "fdr_down": int((fdr & (cells["sen"] < 0)).sum()),
            "not_yet": int((status == 4).sum()),
            "gappy": int(gappy.sum()),
            "step_flagged": int(sum(s["flag"].sum() for s in steps)),
        },
    }


def region_series(values: np.ndarray, times, lat, mask2d=None, how="mean", cell_area=None):
    """Monthly aggregate of a field: cos-lat weighted mean, or area sum."""
    v = np.array(values, dtype=float)
    if mask2d is not None:
        v[:, ~mask2d] = np.nan
    if how == "area_sum":
        return np.nansum(v * cell_area[None, :, None], axis=(1, 2))
    return grid.weighted_mean_series(v, np.asarray(lat))


def analyze_region(series: np.ndarray, times, breaks=()) -> dict:
    """Anomalies + full test battery for one aggregated monthly series."""
    t = stats.decimal_year(times)
    anom, clim = stats.monthly_anomalies(series[None, :], months_of(times))
    res = stats.analyze_series(anom[0], t, breaks=[b for b, _ in breaks])
    for s, (_, label) in zip(res["steps"], breaks):
        s["label"] = label
    years = stats.record_years(t)
    return {"t": t, "anom": anom[0], "clim": clim[0], "raw_mean": float(np.nanmean(series)),
            "years": years, "stats": res}


def annual_means(anom: np.ndarray, t: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Calendar-year means of monthly anomalies along the last axis (full years only)."""
    yr = np.floor(t).astype(int)
    years = np.unique(yr)
    full_years = [y for y in years if np.sum(yr == y) == 12]
    out = np.stack([anom[..., yr == y].mean(axis=-1) for y in full_years], axis=-1)
    return np.array(full_years), out
