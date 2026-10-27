"""Trend statistics for Earth-science time series.

Every ``*_rows`` function works on a 2-D array of shape (n_series, n_time)
with no missing values, so a whole map can be tested in one call. The
single-series helper :func:`analyze_series` drops NaNs and calls them with one
row.

Methods and their sources
-------------------------
* Mann-Kendall S and Var(S) with tie correction (Kendall 1975).
* Hamed & Rao (1998, J. Hydrol. 204:182-196) variance correction for
  autocorrelation. The primary local test models the rank ACF of the
  Sen-detrended series as AR(1); the published form (empirical ACF, lags
  screened at ``alpha``) is also returned, because our Monte Carlo runs show
  it rejects 11-27 % of trend-free AR(1) series at the 5 % level.
* Theil-Sen slope with the Sen (1968) / Gilbert (1987) rank confidence
  interval, built from the *corrected* Var(S).
* OLS slope with the AR(1) effective sample size of Santer et al. (2000,
  JGR 105:7337) as an independent, parametric cross-check.
* A trend + step regression at each *documented* data-source transition
  (instrument switch, reanalysis stream), tested with the same AR(1)
  effective sample size. We tried the Pettitt test for undated breaks and
  dropped it: on AR(1) noise with phi = 0.9 it flags 98 % of trend-free
  series, and after prewhitening it no longer finds real steps.
* Benjamini-Hochberg false discovery rate across a map, with
  alpha_FDR = 2 * alpha_global for spatially correlated fields (Wilks 2016,
  BAMS 97:2263).
* Weatherhead et al. (1998, JGR 103:17149) years-to-detect n* and the
  minimum detectable trend for the record length (90 % power, 5 % level).
"""

from __future__ import annotations

import warnings

import numpy as np
from scipy import stats as sps

WEATHERHEAD_K = 3.3  # 90 % detection probability at the 5 % level


def decimal_year(times) -> np.ndarray:
    """Mid-month decimal years for an array of numpy datetimes."""
    t = np.asarray(times, dtype="datetime64[M]")
    years = t.astype("datetime64[Y]").astype(int) + 1970
    months = t.astype(int) % 12  # 0..11
    return years + (months + 0.5) / 12.0


def record_years(t: np.ndarray) -> float:
    """Length of record in years, counting the last sample's own interval."""
    t = np.asarray(t, dtype=float)
    step = float(np.median(np.diff(t))) if t.size > 1 else 1.0
    return float(t[-1] - t[0]) + step


def monthly_anomalies(values: np.ndarray, months: np.ndarray, base_mask=None):
    """Subtract the calendar-month climatology along the last axis.

    ``months`` holds 1..12 for each time step. ``base_mask`` restricts the
    climatology to a base period. Returns (anomalies, climatology[..., 12]).
    """
    values = np.asarray(values, dtype=float)
    clim = np.full(values.shape[:-1] + (12,), np.nan)
    anom = np.empty_like(values)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # all-NaN cells (e.g. ocean in a land field)
        for m in range(1, 13):
            sel = months == m
            ref = sel if base_mask is None else (sel & base_mask)
            clim[..., m - 1] = np.nanmean(values[..., ref], axis=-1)
            anom[..., sel] = values[..., sel] - clim[..., m - 1 : m]
    return anom, clim


# ----------------------------------------------------------------------------
# Mann-Kendall family
# ----------------------------------------------------------------------------

def mk_score_rows(x: np.ndarray) -> np.ndarray:
    """Mann-Kendall S = sum_{k<j} sign(x_j - x_k) for each row."""
    n = x.shape[1]
    s = np.zeros(x.shape[0])
    for k in range(n - 1):
        s += np.sign(x[:, k + 1 :] - x[:, k : k + 1]).sum(axis=1)
    return s


def mk_variance_rows(x: np.ndarray) -> np.ndarray:
    """Var(S) under H0 with the tie correction, for each row."""
    n = x.shape[1]
    base = n * (n - 1) * (2 * n + 5)
    xs = np.sort(x, axis=1)
    tie_term = np.zeros(x.shape[0])
    has_ties = (xs[:, 1:] == xs[:, :-1]).any(axis=1)
    for i in np.flatnonzero(has_ties):
        _, counts = np.unique(xs[i], return_counts=True)
        t = counts[counts > 1].astype(float)
        tie_term[i] = np.sum(t * (t - 1) * (2 * t + 5))
    return (base - tie_term) / 18.0


def mk_z(s: np.ndarray, var_s: np.ndarray) -> np.ndarray:
    """Continuity-corrected standard normal score of S."""
    with np.errstate(invalid="ignore", divide="ignore"):
        sd = np.sqrt(var_s)
        z = np.where(s > 0, (s - 1) / sd, np.where(s < 0, (s + 1) / sd, 0.0))
    return z


def two_sided_p(z: np.ndarray) -> np.ndarray:
    return 2.0 * sps.norm.sf(np.abs(z))


def _acf_rows(x: np.ndarray) -> np.ndarray:
    """Biased sample autocorrelation (denominator n) at lags 0..n-1, via FFT."""
    n = x.shape[1]
    xc = x - x.mean(axis=1, keepdims=True)
    nfft = 1 << int(np.ceil(np.log2(2 * n)))
    f = np.fft.rfft(xc, nfft, axis=1)
    acov = np.fft.irfft(f * np.conj(f), nfft, axis=1)[:, :n]
    with np.errstate(invalid="ignore", divide="ignore"):
        return acov / acov[:, :1]


def _hamed_rao_sum(rho: np.ndarray, n: int) -> np.ndarray:
    """1 + 2/(n(n-1)(n-2)) * sum_{k>=1} (n-k)(n-k-1)(n-k-2) rho(k)."""
    k = np.arange(n, dtype=float)
    w = (n - k) * (n - k - 1) * (n - k - 2)
    w[0] = 0.0
    return 1.0 + 2.0 * (rho * w).sum(axis=1) / (n * (n - 1) * (n - 2))


def _detrended_rank_acf(x: np.ndarray, t: np.ndarray, slope: np.ndarray) -> np.ndarray:
    detr = x - slope[:, None] * t[None, :]
    return _acf_rows(sps.rankdata(detr, axis=1))


def hamed_rao_factor_rows(x: np.ndarray, t: np.ndarray, slope: np.ndarray,
                          alpha: float = 0.05) -> np.ndarray:
    """Hamed & Rao (1998) variance inflation n/n*_s, as published.

    n/n*_s = 1 + 2/(n(n-1)(n-2)) * sum_{k=1}^{n-1} (n-k)(n-k-1)(n-k-2) rho_s(k),
    where rho_s is the autocorrelation of the ranks of the Sen-detrended series
    and only lags with |rho_s(k)| > z_{1-alpha/2}/sqrt(n) are kept.

    Kept for comparison only: with long monthly records the many lags that
    pass the screen by chance make it liberal (see tests/test_size.py).
    """
    acf = _detrended_rank_acf(x, t, slope)
    n = x.shape[1]
    keep = np.abs(acf) > sps.norm.ppf(1 - alpha / 2) / np.sqrt(n)
    return _hamed_rao_sum(np.where(keep, acf, 0.0), n)


def ar1_variance_factor_rows(x: np.ndarray, t: np.ndarray, slope: np.ndarray) -> np.ndarray:
    """Hamed-Rao inflation with the rank ACF modelled as AR(1): rho_s(k) = phi^k.

    phi is the lag-1 rank autocorrelation of the Sen-detrended series with the
    first-order bias correction phi = (n r1 + 1)/(n - 4) (Kendall 1954),
    clipped to [0, 0.98]. One estimated parameter instead of n-1 screened
    lags keeps the test close to its nominal size; this is the primary test.
    """
    n = x.shape[1]
    r1 = _detrended_rank_acf(x, t, slope)[:, 1]
    phi = np.clip((n * r1 + 1.0) / (n - 4.0), 0.0, 0.98)
    rho = phi[:, None] ** np.arange(n, dtype=float)[None, :]
    return _hamed_rao_sum(rho, n)


# ----------------------------------------------------------------------------
# Theil-Sen slope
# ----------------------------------------------------------------------------

def _order_stat(sorted_or_part: np.ndarray, pos: float) -> float:
    """Linear interpolation between neighbouring 0-based order statistics."""
    lo = int(np.floor(pos))
    frac = pos - lo
    if frac == 0:
        return float(sorted_or_part[lo])
    return float((1 - frac) * sorted_or_part[lo] + frac * sorted_or_part[lo + 1])


def sen_slope_rows(x: np.ndarray, t: np.ndarray, var_s: np.ndarray | None = None,
                   alpha: float = 0.05, block: int = 32):
    """Theil-Sen slope (units per unit of ``t``) and its rank-based CI.

    The CI follows Gilbert (1987): C = z_{1-alpha/2} sqrt(Var(S)),
    M1 = (N' - C)/2, M2 = (N' + C)/2; the limits are the M1-th and (M2+1)-th
    ordered pairwise slopes (1-based). Passing the autocorrelation-corrected
    Var(S) gives an honest, wider interval.
    """
    nrow, n = x.shape
    i, j = np.triu_indices(n, k=1)
    dt = (t[j] - t[i]).astype(float)
    npairs = i.size
    zc = sps.norm.ppf(1 - alpha / 2)
    med = np.empty(nrow)
    lo = np.full(nrow, np.nan)
    hi = np.full(nrow, np.nan)
    mid = [(npairs - 1) // 2, npairs // 2]
    for start in range(0, nrow, block):
        xb = x[start : start + block]
        slopes = (xb[:, j] - xb[:, i]) / dt
        for r in range(xb.shape[0]):
            row = slopes[r]
            kth = list(mid)
            lo_pos = hi_pos = None
            if var_s is not None and np.isfinite(var_s[start + r]) and var_s[start + r] > 0:
                c = zc * np.sqrt(var_s[start + r])
                lo_pos = min(max((npairs - c) / 2.0 - 1.0, 0.0), npairs - 1.0)
                hi_pos = min(max((npairs + c) / 2.0, 0.0), npairs - 1.0)
                for p in (lo_pos, hi_pos):
                    kth += [int(np.floor(p)), min(int(np.floor(p)) + 1, npairs - 1)]
            part = np.partition(row, sorted(set(kth)))
            med[start + r] = 0.5 * (part[mid[0]] + part[mid[1]])
            if lo_pos is not None:
                lo[start + r] = _order_stat(part, lo_pos)
                hi[start + r] = _order_stat(part, hi_pos)
    return med, lo, hi


# ----------------------------------------------------------------------------
# Parametric cross-check, change points, detectability
# ----------------------------------------------------------------------------

def ols_ar1_rows(x: np.ndarray, t: np.ndarray):
    """OLS trend with the Santer et al. (2000) AR(1) effective sample size.

    n_e = n (1 - r1)/(1 + r1), s_e^2 = sum(e^2)/(n_e - 2), s_b = s_e/sqrt(Sxx),
    and b/s_b is tested against Student t with n_e - 2 dof. Returns slope,
    its standard error, p-value, lag-1 autocorrelation of residuals, n_e and
    the residual (noise) standard deviation used by Weatherhead's formula.
    """
    n = x.shape[1]
    tc = t - t.mean()
    sxx = float(np.sum(tc**2))
    xm = x.mean(axis=1, keepdims=True)
    b = (x - xm) @ tc / sxx
    e = (x - xm) - b[:, None] * tc[None, :]
    sse = np.sum(e**2, axis=1)
    with np.errstate(invalid="ignore", divide="ignore"):
        r1 = np.sum(e[:, 1:] * e[:, :-1], axis=1) / sse
        r1c = np.clip(r1, 0.0, 0.99)  # negative r1 would inflate n_e above n
        ne = n * (1 - r1c) / (1 + r1c)
        se_b = np.sqrt(sse / (ne - 2) / sxx)
        tstat = b / se_b
        p = 2.0 * sps.t.sf(np.abs(tstat), ne - 2)
    p = np.where(ne > 3, p, np.nan)
    sigma = np.sqrt(sse / (n - 2))
    return b, se_b, p, r1, ne, sigma


def step_test_rows(x: np.ndarray, t: np.ndarray, t_break: float):
    """Trend + step regression at a documented transition date.

    Fits x = a + b t + c H(t >= t_break) by OLS and tests c with the same
    AR(1) effective sample size as :func:`ols_ar1_rows`. Returns the step c,
    its p-value and the trend b once the step is allowed for. A significant c
    at a known instrument or data-source change means the plain trend mixes
    a real change with an artificial one.
    """
    n = x.shape[1]
    design = np.column_stack([np.ones(n), t - t.mean(), (t >= t_break).astype(float)])
    if design[:, 2].min() == design[:, 2].max():
        nanv = np.full(x.shape[0], np.nan)
        return nanv, nanv, nanv
    xtx_inv = np.linalg.inv(design.T @ design)
    coef = x @ design @ xtx_inv  # (rows, 3)
    e = x - coef @ design.T
    sse = np.sum(e**2, axis=1)
    with np.errstate(invalid="ignore", divide="ignore"):
        r1 = np.clip(np.sum(e[:, 1:] * e[:, :-1], axis=1) / sse, 0.0, 0.99)
        ne = n * (1 - r1) / (1 + r1)
        se_c = np.sqrt(sse / (ne - 3) * xtx_inv[2, 2])
        p = 2.0 * sps.t.sf(np.abs(coef[:, 2] / se_c), ne - 3)
    p = np.where(ne > 4, p, np.nan)
    return coef[:, 2], p, coef[:, 1]


def weatherhead_nstar(sigma, phi, omega):
    """Years needed to detect trend ``omega`` (units/yr) from monthly noise.

    n* = [3.3 sigma_N / |omega| * sqrt((1+phi)/(1-phi))]^(2/3)
    """
    phi = np.clip(phi, -0.95, 0.95)
    with np.errstate(divide="ignore", invalid="ignore"):
        return (WEATHERHEAD_K * sigma / np.abs(omega)
                * np.sqrt((1 + phi) / (1 - phi))) ** (2.0 / 3.0)


def min_detectable_trend(sigma, phi, n_years):
    """Smallest |trend| (units/yr) detectable in ``n_years`` (inverse of n*)."""
    phi = np.clip(phi, -0.95, 0.95)
    return WEATHERHEAD_K * sigma * np.sqrt((1 + phi) / (1 - phi)) / n_years**1.5


# ----------------------------------------------------------------------------
# Field significance
# ----------------------------------------------------------------------------

def fdr_threshold(p: np.ndarray, alpha_fdr: float) -> float:
    """Benjamini-Hochberg p* over the finite p-values; 0.0 when none pass."""
    pv = np.sort(np.asarray(p, dtype=float)[np.isfinite(p)])
    m = pv.size
    if m == 0:
        return 0.0
    ok = pv <= alpha_fdr * np.arange(1, m + 1) / m
    return float(pv[ok].max()) if ok.any() else 0.0


def fdr_mask(p: np.ndarray, alpha_global: float = 0.05, wilks_factor: float = 2.0):
    """Cells significant under BH-FDR with alpha_FDR = wilks_factor * alpha_global."""
    p = np.asarray(p, dtype=float)
    pstar = fdr_threshold(p, wilks_factor * alpha_global)
    mask = np.isfinite(p) & (p <= pstar) & (pstar > 0)
    return mask, pstar


# ----------------------------------------------------------------------------
# One-call analysis
# ----------------------------------------------------------------------------

def analyze_rows(anom: np.ndarray, t: np.ndarray, alpha: float = 0.05,
                 breaks=()) -> dict:
    """Run the full local test battery on complete rows of anomalies.

    ``t`` is in decimal years, so slopes come out in units per year.
    ``breaks`` lists documented transition dates (decimal years) to test.
    """
    anom = np.asarray(anom, dtype=float)
    n = anom.shape[1]
    s = mk_score_rows(anom)
    var_s = mk_variance_rows(anom)
    p_naive = two_sided_p(mk_z(s, var_s))

    slope0, _, _ = sen_slope_rows(anom, t)  # point estimate for detrending
    factor = ar1_variance_factor_rows(anom, t, slope0)
    var_mk = var_s * factor
    p_mk = two_sided_p(mk_z(s, var_mk))
    hr_emp = hamed_rao_factor_rows(anom, t, slope0, alpha)
    p_hr_emp = two_sided_p(mk_z(s, np.where(hr_emp > 0, var_s * hr_emp, np.nan)))
    sen, sen_lo, sen_hi = sen_slope_rows(anom, t, var_mk, alpha)

    b_ols, se_ols, p_ols, r1, ne, sigma = ols_ar1_rows(anom, t)
    span_years = record_years(t)
    mdt = min_detectable_trend(sigma, r1, span_years)
    nstar = weatherhead_nstar(sigma, r1, sen)

    steps = []
    for tb in breaks:
        c, p_c, b_adj = step_test_rows(anom, t, tb)
        steps.append({"t_break": tb, "step": c, "p_step": p_c, "trend_with_step": b_adj})

    return {
        "n": n,
        "S": s,
        "var_s": var_s,
        "var_factor": factor,
        "p_naive": p_naive,
        "p_mk": p_mk,
        "p_hr_empirical": p_hr_emp,
        "sen": sen,
        "sen_lo": sen_lo,
        "sen_hi": sen_hi,
        "ols": b_ols,
        "ols_se": se_ols,
        "p_ols_ar1": p_ols,
        "phi": r1,
        "n_eff": ne,
        "sigma": sigma,
        "mdt": mdt,
        "nstar": nstar,
        "steps": steps,
    }


def analyze_series(y, t, alpha: float = 0.05, breaks=()) -> dict:
    """Scalar version of :func:`analyze_rows` that drops missing values."""
    y = np.asarray(y, dtype=float)
    t = np.asarray(t, dtype=float)
    ok = np.isfinite(y)
    res = analyze_rows(y[ok][None, :], t[ok], alpha, breaks)

    def first(v):
        return v[0] if isinstance(v, np.ndarray) else v

    out = {k: first(v) for k, v in res.items() if k != "steps"}
    out["steps"] = [{k: first(v) for k, v in s.items()} for s in res["steps"]]
    return out
