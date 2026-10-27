import numpy as np
import pytest

from trend_detective import grid, stats as S
from trend_detective.synthetic import ar1_noise, dipole_field


def ar1(rng, n, phi, size):
    e = rng.standard_normal((size, n))
    x = np.empty_like(e)
    x[:, 0] = e[:, 0] / np.sqrt(1 - phi**2)
    for k in range(1, n):
        x[:, k] = phi * x[:, k - 1] + e[:, k]
    return x * np.sqrt(1 - phi**2)  # unit marginal variance


def months(n, start=1981):
    return start + (np.arange(n) + 0.5) / 12


def test_matches_pymannkendall():
    mk = pytest.importorskip("pymannkendall")
    rng = np.random.default_rng(1)
    n = 150
    t = months(n)
    x = np.round(ar1(rng, n, 0.5, 4) + 0.003 * np.arange(n), 2)
    res = S.analyze_rows(x, t)
    for r in range(4):
        o = mk.original_test(x[r])
        h = mk.hamed_rao_modification_test(x[r])
        assert res["S"][r] == o.s
        assert res["var_s"][r] == pytest.approx(o.var_s)
        # The Sen slope equals one pairwise slope, so that pair ties after
        # detrending only up to float rounding; allow the resulting rank jitter.
        assert res["p_hr_empirical"][r] == pytest.approx(h.p, rel=1e-3, abs=1e-12)
        assert res["sen"][r] == pytest.approx(mk.sens_slope(x[r]).slope * 12)


def test_decimal_year_mid_month():
    t = S.decimal_year(np.array(["1981-01-31", "2025-12-31"], dtype="datetime64[D]"))
    assert t[0] == pytest.approx(1981 + 0.5 / 12)
    assert t[1] == pytest.approx(2025 + 11.5 / 12)


@pytest.mark.parametrize("phi", [0.3, 0.6])
def test_size_under_autocorrelation(phi):
    """Trend-free AR(1): naive MK over-rejects, the corrected tests do not."""
    rng = np.random.default_rng(int(phi * 100))
    n, reps = 240, 300
    res = S.analyze_rows(ar1(rng, n, phi, reps), months(n))
    assert np.mean(res["p_mk"] < 0.05) < 0.10
    assert np.mean(res["p_ols_ar1"] < 0.05) < 0.10
    assert np.mean(res["p_naive"] < 0.05) > 0.10


def test_weatherhead_power_and_sen_coverage():
    """A trend equal to the minimum detectable trend is found ~90 % of the time."""
    rng = np.random.default_rng(5)
    n, reps, phi = 360, 300, 0.5
    t = months(n)
    mdt = S.min_detectable_trend(1.0, phi, n / 12)
    res = S.analyze_rows(ar1(rng, n, phi, reps) + mdt * (t - t[0]), t)
    power = np.mean(res["p_mk"] < 0.05)
    assert 0.80 < power < 0.98
    cover = np.mean((res["sen_lo"] <= mdt) & (res["sen_hi"] >= mdt))
    assert cover > 0.88
    assert np.median(res["mdt"]) == pytest.approx(mdt, rel=0.1)


def test_step_test_size_and_estimate():
    rng = np.random.default_rng(9)
    n, reps = 360, 300
    t = months(n)
    x = ar1(rng, n, 0.3, reps)
    _, p0, _ = S.step_test_rows(x, t, 2004.75)
    assert np.mean(p0 < 0.05) < 0.10
    c, p1, _ = S.step_test_rows(x + 0.6 * (t >= 2004.75), t, 2004.75)
    assert np.median(c) == pytest.approx(0.6, abs=0.05)
    assert np.mean(p1 < 0.05) > 0.5


def test_fdr_threshold_hand_example():
    p = np.array([0.001, 0.01, 0.03, 0.04, 0.2, np.nan])
    assert S.fdr_threshold(p, 0.10) == pytest.approx(0.04)
    mask, pstar = S.fdr_mask(p, alpha_global=0.05)
    assert pstar == pytest.approx(0.04)
    assert mask.tolist() == [True, True, True, True, False, False]
    assert S.fdr_threshold(np.array([0.5, 0.9]), 0.10) == 0.0


def test_fdr_controls_false_discoveries_on_known_truth():
    values, lat, lon, t, truth = dipole_field(seed=3, ny=18, nx=36, years=30, phi=0.5)
    anom, _ = S.monthly_anomalies(values.reshape(len(t), -1).T, ((np.arange(len(t)) % 12) + 1))
    res = S.analyze_rows(anom, t)
    true = truth.ravel() != 0
    naive = res["p_naive"] < 0.05
    fdr, _ = S.fdr_mask(res["p_mk"])
    fdp_naive = np.sum(naive & ~true) / max(naive.sum(), 1)
    fdp_fdr = np.sum(fdr & ~true) / max(fdr.sum(), 1)
    assert fdp_fdr < fdp_naive
    assert fdp_fdr < 0.25
    assert np.sum(fdr & true) > 0


def test_regions_join_across_dateline():
    lat = np.array([-10.0, 0.0, 10.0])
    lon = np.array([-170.0, -90.0, 0.0, 90.0, 170.0])
    slope = np.zeros((3, 5))
    sig = np.zeros((3, 5), dtype=bool)
    slope[:, [0, 4]] = 1.0
    sig[:, [0, 4]] = True
    regs = grid.signed_regions(slope, sig, lat, lon, 10, 80, wrap_lon=True, min_cells=1)
    assert len(regs) == 1 and regs[0]["cells"] == 6
    assert abs(abs(regs[0]["lon"]) - 180) < 1e-6


def test_weighted_mean_ignores_missing_cells():
    lat = np.array([0.0, 60.0])
    f = np.array([[[1.0, np.nan], [3.0, 3.0]]])
    # weights cos(0)=1 for one valid cell, cos(60)=0.5 for two cells
    assert grid.weighted_mean_series(f, lat)[0] == pytest.approx((1 + 0.5 * 6) / 2.0)


def test_ar1_noise_has_requested_memory():
    x = ar1_noise(np.random.default_rng(0), (2000, 4, 4), 0.6)
    r1 = np.mean([np.corrcoef(x[1:, i, j], x[:-1, i, j])[0, 1] for i in range(4) for j in range(4)])
    assert r1 == pytest.approx(0.6, abs=0.05)
