"""Known-truth test fields for validating the map statistics.

Synthetic data here are a test instrument, never a stand-in for observations:
every field records which cells carry a planted trend so the viewer can score
naive and FDR maps against the truth.
"""

from __future__ import annotations

import numpy as np
from scipy import ndimage


def ar1_noise(rng, shape, phi, smooth_cells=0.0):
    """AR(1)-in-time noise (unit variance), optionally smoothed in space."""
    n_time = shape[0]
    e = rng.standard_normal(shape)
    if smooth_cells > 0:
        for k in range(n_time):
            e[k] = ndimage.gaussian_filter(e[k], smooth_cells, mode="wrap")
        e /= e.std()
    x = np.empty_like(e)
    x[0] = e[0]
    scale = np.sqrt(1 - phi**2)
    for k in range(1, n_time):
        x[k] = phi * x[k - 1] + scale * e[k]
    return x


def dipole_field(seed=42, ny=36, nx=72, years=45, phi=0.5, smooth_cells=1.5,
                 trend_sd_per_decade=0.35):
    """A monthly field with one warming blob, one cooling blob, and no trend elsewhere.

    The blobs are Gaussian bumps in trend amplitude; ``truth`` marks cells
    whose planted trend exceeds 10 % of the peak. Returns (values[time, y, x],
    lat, lon, decimal_years, truth_slope_per_year).
    """
    rng = np.random.default_rng(seed)
    n = years * 12
    t = 1981 + (np.arange(n) + 0.5) / 12
    lat = np.linspace(-87.5, 87.5, ny)
    lon = np.linspace(-177.5, 177.5, nx)
    lon2d, lat2d = np.meshgrid(lon, lat)

    def bump(clat, clon, r):
        d2 = (lat2d - clat) ** 2 + ((lon2d - clon) * np.cos(np.radians(clat))) ** 2
        return np.exp(-d2 / (2 * r**2))

    slope = (trend_sd_per_decade / 10) * (bump(65, 40, 12) - bump(-65, -100, 12))
    slope[np.abs(slope) < 0.1 * np.abs(slope).max()] = 0.0
    noise = ar1_noise(rng, (n, ny, nx), phi, smooth_cells)
    values = noise + slope[None] * (t - t.mean())[:, None, None]
    return values, lat, lon, t, slope
