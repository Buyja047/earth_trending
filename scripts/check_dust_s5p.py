"""Check the dust-prone-day index against Sentinel-5P TROPOMI's UV aerosol index (2018-2025).

UVAI is observed by a satellite; MERRA-2's wind, snow and rain are modelled, so
UVAI is an independent test of whether dust-prone days are dusty. Two properties
of the product decide what can be tested:

* Over snow TropOMAER switches to its older Lambertian-surface (LER) retrieval
  (TropOMAER README, NASA GES DISC), and here calm, dry, snow-covered days read
  about 0.6 lower than calm, dry, snow-free ones in January. UVAI therefore cannot
  test the snow gate, and every dust contrast is made among snow-free days only.
* Bare ground reads high in winter even on calm days (about 0.8 in January, -0.2 in
  July), so absolute thresholds mean different things in different months. Every
  contrast is a difference within the same cell and calendar month.

Tests, for the whole country, the South Gobi and the eastern steppe:

1. Dust-prone days (snow-free, dry, max wind >= 8 m/s) against snow-free dry days
   with less wind: mean UVAI and the share of days with UVAI >= 0.5 / 0.8 / 1.0
   (0.8 is TropOMAER's land threshold for absorbing aerosol), by season.
2. Dose-response: UVAI on snow-free dry days by daily maximum wind, as a departure
   from the same cell and month's days below 4 m/s.
3. Rain gate: windy snow-free days that are wet against those that are dry (clouds
   on wet days pull UVAI toward zero too, so this one is weak).
4. The snow-surface diagnostic above, by month.
5. Monthly anomalies of dust-prone days against mean UVAI, by season.

Contrasts pool within-(cell, calendar month) differences, weighted by the smaller
group's day count; 95 % intervals come from resampling whole years, because days of
one year share weather and are not independent.

Usage: python scripts/check_dust_s5p.py OUT.json
"""

import json
import sys
import warnings
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from trend_detective import hazard, sentinel  # noqa: E402

BOX = (87.5, 41.0, 120.5, 52.5)
START, END = "2018-05-01", "2025-12-31"
REGIONS = {"Mongolia": BOX, "South Gobi": (100.0, 41.0, 112.0, 45.5), "Eastern steppe": (110.0, 45.5, 120.5, 50.0)}
SEASONS = {"all": tuple(range(1, 13)), "mar_may": (3, 4, 5), "jun_oct": (6, 7, 8, 9, 10), "nov_feb": (11, 12, 1, 2)}
THRESHOLDS = (0.5, 0.8, 1.0)
WIND = 8.0
WIND_BINS = (0, 4, 6, 8, 10, 12, 99)
RNG = np.random.default_rng(20261028)


def box_mask(lat, lon, box):
    la, lo = np.meshgrid(lat, lon, indexing="ij")
    return (lo >= box[0]) & (lo <= box[2]) & (la >= box[1]) & (la <= box[3])


def pooled(y, a, b, month):
    """Within-(cell, calendar month) differences of the group means, pooled; None if no stratum has both."""
    num = den = sa = sb = 0.0
    na = nb = 0
    diffs = []
    for m in range(1, 13):
        dm = month == m
        if not dm.any():
            continue
        ya, yb = np.where(a[dm], y[dm], 0).sum(0), np.where(b[dm], y[dm], 0).sum(0)
        ca, cb = a[dm].sum(0), b[dm].sum(0)
        s = (ca >= 3) & (cb >= 3)
        if not s.any():
            continue
        d = ya[s] / ca[s] - yb[s] / cb[s]
        w = np.minimum(ca[s], cb[s])
        num, den = num + (d * w).sum(), den + w.sum()
        sa, sb, na, nb = sa + ya[s].sum(), sb + yb[s].sum(), na + int(ca[s].sum()), nb + int(cb[s].sum())
        diffs.append(d)
    if den == 0:
        return None
    return {"difference": num / den, "diffs": np.concatenate(diffs), "mean_a": sa / na, "mean_b": sb / nb,
            "n_a": na, "n_b": nb}


def contrast(y, a, b, month, year, cells, months=SEASONS["all"], n_boot=500):
    """Mean of y on days in group a minus group b within each (cell, calendar month), pooled, with a
    year-resampled 95 % interval, the two group means, their day counts and the share of strata where a > b."""
    keep = np.isin(month, months)
    y, a, b, month, year = y[keep][:, cells], a[keep][:, cells], b[keep][:, cells], month[keep], year[keep]
    ok = np.isfinite(y)
    a, b = a & ok, b & ok
    full = pooled(y, a, b, month)
    if full is None:
        return None
    years = np.unique(year)
    boot = []
    for _ in range(n_boot):
        idx = np.concatenate([np.flatnonzero(year == yy) for yy in RNG.choice(years, years.size)])
        r = pooled(y[idx], a[idx], b[idx], month[idx])
        if r is not None:
            boot.append(r["difference"])
    lo, hi = np.percentile(boot, [2.5, 97.5])
    return {"difference": round(float(full["difference"]), 3), "ci95": [round(float(lo), 3), round(float(hi), 3)],
            "mean_in_group": round(float(full["mean_a"]), 3), "mean_in_rest": round(float(full["mean_b"]), 3),
            "days_in_group": full["n_a"], "days_in_rest": full["n_b"],
            "share_of_strata_higher": round(float(np.mean(full["diffs"] > 0)), 3)}


def dose_response(y, wind, base, month, cells, months):
    """Mean UVAI by wind bin on ``base`` days, minus the same cell and month's mean on days below 4 m/s."""
    keep = np.isin(month, months)
    y, wind, base, month = y[keep][:, cells], wind[keep][:, cells], base[keep][:, cells], month[keep]
    ok = base & np.isfinite(y)
    ref = np.full(y.shape, np.nan)
    for m in np.unique(month):
        dm = month == m
        calm = ok[dm] & (wind[dm] < WIND_BINS[1])
        with np.errstate(invalid="ignore", divide="ignore"):
            ref[dm] = np.where(calm, y[dm], 0).sum(0) / calm.sum(0)
    out = []
    for lo, hi in zip(WIND_BINS[:-1], WIND_BINS[1:]):
        s = ok & (wind >= lo) & (wind < hi) & np.isfinite(ref)
        dep = (y - ref)[s]
        share = (y[s] >= 0.8).mean() if s.any() else np.nan
        out.append({"wind_m_s": f"{lo}-{hi}" if hi < 99 else f">={lo}", "days": int(s.sum()),
                    "uvai_above_calm": round(float(dep.mean()), 3) if s.any() else None,
                    "share_uvai_ge_0.8": round(float(share), 3) if s.any() else None})
    return out


def monthly_corr(x, y, mon, months_wanted):
    """Pearson r of monthly anomalies (each calendar month's mean removed) on the wanted months."""
    m = mon.astype(int) % 12 + 1
    xa, ya = x.astype(float).copy(), y.astype(float).copy()
    for k in range(1, 13):
        xa[m == k] -= np.nanmean(x[m == k])
        ya[m == k] -= np.nanmean(y[m == k])
    s = np.isin(m, months_wanted) & np.isfinite(xa) & np.isfinite(ya)
    return {"r": round(float(np.corrcoef(xa[s], ya[s])[0, 1]), 3), "n_months": int(s.sum())}


def main(out):
    d = hazard.read_daily(("FRSNO", "PRECTOTCORR", "WS10M_MAX"), BOX, START[:7], END[:7])
    lat, lon = d["lat"].values, d["lon"].values
    ai = sentinel.daily_cells(lat, lon, START, END)
    days = d["time"].values.astype("datetime64[D]")
    assert np.array_equal(ai["time"].values.astype("datetime64[D]"), days), "day axes differ"
    nd = days.size
    frsno, prec, wsmax = (d[k].values.reshape(nd, -1) for k in ("FRSNO", "PRECTOTCORR", "WS10M_MAX"))
    uvai = ai.values.reshape(nd, -1).astype(float)
    dust = hazard.daily_flags(frsno, prec, wsmax)["DUSTDAYS8"]
    snowfree, wet = frsno < hazard.SNOW_FRAC, prec >= hazard.WET_MM
    windy, calm = wsmax >= WIND, wsmax < 6.0
    month = days.astype("datetime64[M]").astype(int) % 12 + 1
    year = days.astype("datetime64[Y]").astype(int) + 1970
    mon = days.astype("datetime64[M]")
    um = np.unique(mon)
    next_day = np.vstack([uvai[1:], np.full((1, uvai.shape[1]), np.nan)])

    res = {"period": [START, END], "days": int(nd), "days_with_s5p": int(np.isfinite(uvai).any(1).sum()),
           "cell_days_with_s5p": round(float(np.isfinite(uvai).mean()), 3),
           "source": {"s5p": f"{sentinel.STAC}/collections/{sentinel.COLLECTION}", "credit": sentinel.CREDIT,
                      "merra2": f"{hazard.DAILY_STORE} (NASA POWER)"},
           "snow_surface_diagnostic": {}, "regions": {}}
    for m in range(1, 13):
        s = month == m
        bare = uvai[s][calm[s] & ~wet[s] & (frsno[s] < 0.05)]
        snowy = uvai[s][calm[s] & ~wet[s] & (frsno[s] >= 0.5)]
        res["snow_surface_diagnostic"][str(m)] = {
            "calm_dry_snow_free_uvai": round(float(np.nanmean(bare)), 3),
            "calm_dry_snow_covered_uvai": round(float(np.nanmean(snowy)), 3) if snowy.size >= 1000 else None,
            "snow_covered_cell_days": int(snowy.size)}
    rest = snowfree & ~wet & ~windy          # snow-free dry days with less wind than the threshold
    for name, box in REGIONS.items():
        cells = box_mask(lat, lon, box).ravel()
        r = {"dust_prone_vs_calmer_snowfree_dry": {}, "share_uvai_ge": {}, "dose_response": {}}
        for sk, months in SEASONS.items():
            r["dust_prone_vs_calmer_snowfree_dry"][sk] = contrast(uvai, dust, rest, month, year, cells, months)
        r["dust_prone_vs_calmer_snowfree_dry"]["mar_may_next_day"] = contrast(next_day, dust, rest, month, year,
                                                                              cells, SEASONS["mar_may"])
        for th in THRESHOLDS:
            ev = np.where(np.isfinite(uvai), (uvai >= th).astype(float), np.nan)
            r["share_uvai_ge"][str(th)] = {sk: contrast(ev, dust, rest, month, year, cells, SEASONS[sk], n_boot=300)
                                           for sk in ("all", "mar_may")}
        for sk in ("mar_may", "jun_oct"):
            r["dose_response"][sk] = dose_response(uvai, wsmax, snowfree & ~wet, month, cells, SEASONS[sk])
        r["rain_gate_windy_snowfree_wet_vs_dry"] = {
            sk: contrast(uvai, windy & snowfree & wet, windy & snowfree & ~wet, month, year, cells, SEASONS[sk],
                         n_boot=300) for sk in ("all", "mar_may")}
        # monthly regional series: dust-prone days and mean UVAI over snow-free cell-days
        w = np.cos(np.radians(np.repeat(lat, lon.size)))[cells]
        dd = np.array([(dust[mon == m][:, cells].sum(0) * w).sum() / w.sum() for m in um])
        with np.errstate(invalid="ignore"), warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)   # cells with no snow-free day in a month
            ub = np.where(snowfree, uvai, np.nan)
            mai = np.array([np.nansum(np.nanmean(ub[mon == m][:, cells], 0) * w) /
                            w[np.isfinite(np.nanmean(ub[mon == m][:, cells], 0))].sum() for m in um])
        r["monthly_anomaly_correlation_dust_prone_days_vs_snowfree_uvai"] = {
            sk: monthly_corr(dd, mai, um, months) for sk, months in SEASONS.items()}
        res["regions"][name] = r
        print(name, json.dumps(r["dust_prone_vs_calmer_snowfree_dry"]["mar_may"]), flush=True)
    Path(out).write_text(json.dumps(res, indent=1))
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    main(sys.argv[1])
