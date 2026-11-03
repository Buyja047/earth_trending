"""MODIS dust detection adapted from G. Tumenjargal's supplied thesis.

Inputs are co-registered, calibrated daytime reflectances (unitless) and
brightness temperatures (kelvin), not MOD09 digital numbers or land temperature.
See docs/DUST_MODIS.md for the thesis's inconsistent/incomplete water branch.
"""
from dataclasses import dataclass

import numpy as np

METHOD = "modis-idi-otsu-v1"
BANDS = ("b1", "b2", "b3", "b4", "b5", "b7", "b8", "bt20", "bt31", "bt32")


@dataclass(frozen=True)
class Settings:
    # The decision diagram specifies NDVI < .07 and green/NIR NDWI > 0.
    water_ndvi_max: float = .07
    cloud_red_min: float = .49
    cloud_blue_max: float = 1.15
    # The thesis does not supply numerical water-screen/NDAI thresholds.
    # All three must be explicitly calibrated before reporting dust over water.
    water_btd_min: float | None = None
    water_r47_min: float | None = None
    water_ndai_min: float | None = None


def ratio(a, b):
    out = np.full(np.broadcast_shapes(np.shape(a), np.shape(b)), np.nan)
    np.divide(a, b, out=out, where=np.abs(b) > 1e-12)
    return out


def otsu(values):
    """Histogram between-class variance; no split for absent/constant inputs.

    A one-class scene cannot establish dust absence or presence. Its land pixels
    remain unclassified rather than manufacturing a split or a dust-free map.
    """
    x = np.asarray(values, float)
    x = x[np.isfinite(x)]
    if x.size < 2 or np.ptp(x) <= 1e-12:
        return None
    count, edges = np.histogram(x, bins=256)
    center = (edges[:-1] + edges[1:]) / 2
    weight = np.cumsum(count)
    total = weight[-1]
    moment = np.cumsum(count * center)
    valid = (weight > 0) & (weight < total)
    variance = np.full(count.size, -np.inf)
    variance[valid] = (moment[-1] * weight[valid] - moment[valid] * total) ** 2 / (
        weight[valid] * (total - weight[valid]))
    return float(edges[int(np.argmax(variance)) + 1])


def classify(bands, cloud_mask, snow_mask, settings=None):
    """Classes: -1 missing/cloud/snow, 0 clear land, 1 land dust,
    2 unclassified water, 3 water dust, 4 unclassified land (no Otsu split).
    """
    settings = settings or Settings()
    b = {k: np.asarray(bands[k], float) for k in BANDS}
    shape = b["b1"].shape
    if any(x.shape != shape for x in b.values()):
        raise ValueError("MODIS bands must share a grid and acquisition")
    cloud, snow = np.asarray(cloud_mask), np.asarray(snow_mask)
    if cloud.shape != shape or snow.shape != shape:
        raise ValueError("Cloud/snow masks must share the band grid")
    valid = np.isin(cloud, [0, 1]) & np.isin(snow, [0, 1]) & (cloud == 0) & (snow == 0)
    for key, x in b.items():
        valid &= np.isfinite(x)
        valid &= ((x >= 150) & (x <= 400)) if key.startswith("bt") else ((x >= 0) & (x <= 1.6))
    # Thresholds in the diagram are scaled by 10,000; QA masking is additional.
    valid &= ~((b["b1"] > settings.cloud_red_min) & (b["b3"] < settings.cloud_blue_max))
    ndvi = ratio(b["b2"] - b["b1"], b["b2"] + b["b1"])
    ndwi = ratio(b["b4"] - b["b2"], b["b4"] + b["b2"])
    ndwi_nir_swir = ratio(b["b2"] - b["b5"], b["b2"] + b["b5"])
    r47 = ratio(b["b4"] - b["b7"], b["b4"] + b["b7"])
    btd = b["bt20"] - b["bt31"]
    with np.errstate(invalid="ignore", divide="ignore", over="ignore"):
        idi = ratio(b["bt20"], b["bt31"]) ** (b["bt32"] - b["bt31"])
        ndai = -10 * np.log10(ratio(b["b8"], b["b7"]))
    valid &= np.isfinite(ndvi) & np.isfinite(ndwi) & np.isfinite(idi)
    water = valid & (ndwi > 0) & (ndvi < settings.water_ndvi_max)
    land = valid & ~water
    threshold = otsu(idi[land])
    classes = np.full(shape, -1, dtype=np.int8)
    classes[water] = 2
    classes[land] = 4 if threshold is None else 0
    if threshold is not None:
        classes[land & (idi > threshold)] = 1
    gates = [settings.water_btd_min, settings.water_r47_min, settings.water_ndai_min]
    if any(v is not None for v in gates):
        if not all(v is not None and np.isfinite(v) for v in gates):
            raise ValueError("Water detection requires finite BTD, R47 and NDAI thresholds together")
        dust = water & (btd > gates[0]) & (r47 > gates[1]) & (ndai > gates[2])
        classes[dust] = 3
    factors = dict(idi=idi, ndai=ndai, ndvi=ndvi, ndwi=ndwi,
                   ndwi_nir_swir=ndwi_nir_swir, btd_20_31=btd, r47=r47)
    factors = {k: np.where(valid & np.isfinite(x), x, np.nan) for k, x in factors.items()}
    return classes, factors, threshold
