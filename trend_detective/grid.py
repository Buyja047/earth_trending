"""Map-level helpers: area weights, region means and opposite-sign regions."""

from __future__ import annotations

import numpy as np
from scipy import ndimage

EARTH_RADIUS_KM = 6371.0


def cell_area_km2(lat: np.ndarray, dlat: float, dlon: float) -> np.ndarray:
    """Area of lat-lon cells centred on ``lat`` (1-D), in km^2."""
    lat = np.asarray(lat, dtype=float)
    lo = np.radians(np.clip(lat - dlat / 2, -90, 90))
    hi = np.radians(np.clip(lat + dlat / 2, -90, 90))
    return EARTH_RADIUS_KM**2 * np.radians(dlon) * (np.sin(hi) - np.sin(lo))


def weighted_mean_series(field: np.ndarray, lat: np.ndarray) -> np.ndarray:
    """cos(lat)-weighted mean over (lat, lon) of a (time, lat, lon) array.

    Only valid cells enter the weights, so masked cells do not bias the mean.
    """
    w = np.cos(np.radians(lat))[None, :, None] * np.isfinite(field)
    return np.nansum(field * w, axis=(1, 2)) / w.sum(axis=(1, 2))


def label_regions(mask: np.ndarray, wrap_lon: bool) -> tuple[np.ndarray, int]:
    """8-connected labels of a (lat, lon) boolean mask, joined across the dateline."""
    labels, n = ndimage.label(mask, structure=np.ones((3, 3), dtype=int))
    if wrap_lon and n:
        left, right = labels[:, 0], labels[:, -1]
        parent = np.arange(n + 1)

        def find(a):
            while parent[a] != a:
                parent[a] = parent[parent[a]]
                a = parent[a]
            return a

        for r in range(mask.shape[0]):
            for rr in (r - 1, r, r + 1):
                if 0 <= rr < mask.shape[0] and left[r] and right[rr]:
                    a, b = find(left[r]), find(right[rr])
                    if a != b:
                        parent[max(a, b)] = min(a, b)
        roots = np.array([find(i) for i in range(n + 1)])
        uniq = np.unique(roots[roots > 0])
        remap = np.zeros(n + 1, dtype=int)
        remap[uniq] = np.arange(1, uniq.size + 1)
        labels = remap[roots[labels]]
        n = uniq.size
    return labels, n


def signed_regions(slope: np.ndarray, sig: np.ndarray, lat: np.ndarray, lon: np.ndarray,
                   dlat: float, dlon: float, wrap_lon: bool, min_cells: int = 3,
                   top: int = 4) -> list[dict]:
    """Largest connected areas of significant increase and of decrease.

    Returns up to ``top`` regions per sign, largest first, with area,
    area-weighted mean slope and centroid. Regions of opposite sign in the
    same variable are what the viewer lists as candidate "same process,
    opposite trend" pairs; the physical pairing is left to case files.
    """
    area = np.broadcast_to(cell_area_km2(lat, dlat, dlon)[:, None], slope.shape)
    lon2d, lat2d = np.meshgrid(lon, lat)
    out = []
    for sign, name in ((1, "increase"), (-1, "decrease")):
        mask = sig & (np.sign(slope) == sign)
        labels, n = label_regions(mask, wrap_lon)
        regs = []
        for k in range(1, n + 1):
            cells = labels == k
            if cells.sum() < min_cells:
                continue
            a = area[cells]
            # circular mean of longitude so dateline-crossing regions centre correctly
            ang = np.radians(lon2d[cells])
            clon = np.degrees(np.arctan2(np.sum(a * np.sin(ang)), np.sum(a * np.cos(ang))))
            regs.append({
                "sign": name,
                "cells": int(cells.sum()),
                "area_km2": float(a.sum()),
                "mean_slope": float(np.sum(a * slope[cells]) / a.sum()),
                "lat": float(np.sum(a * lat2d[cells]) / a.sum()),
                "lon": float(clon),
                "lat_range": [float(lat2d[cells].min()), float(lat2d[cells].max())],
                "label_cells": np.flatnonzero(cells.ravel()).tolist(),
            })
        regs.sort(key=lambda r: -r["area_km2"])
        out.extend(regs[:top])
    return out
