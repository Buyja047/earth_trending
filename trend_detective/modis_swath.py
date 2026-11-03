"""Read matched MOD021KM/MOD03/MOD35_L2 C6.1 HDF4 at native 1 km.

Radiance scaling follows the MODIS L1B user guide. Brightness temperature uses
the MODIS_BRIGHT effective wavenumbers and correction coefficients (also used
by NASA SatVision/Satpy); see docs/DUST_MODIS.md for source links.
"""
from contextlib import contextmanager
from dataclasses import dataclass

import numpy as np

from .dust import classify, Settings
from .modis_source import Granule, FILENAME

# band: effective central wavenumber cm^-1, correction slope, intercept K
THERMAL = {20: (2641.775, .9993411, .4770532),
           31: (908.0884, .9995608, .1302699),
           32: (831.5399, .9997256, .07181833)}


def brightness_temperature(radiance, band):
    """W m^-2 sr^-1 µm^-1 -> corrected brightness temperature in kelvin."""
    wn, slope, intercept = THERMAL[band]
    wavelength = 1 / (wn * 100)
    h, c, k = 6.6260755e-34, 2.9979246e8, 1.380658e-23
    rad = np.asarray(radiance, float)
    with np.errstate(divide="ignore", invalid="ignore"):
        planck = h*c/k / (wavelength*np.log1p(2*h*c*c / (1e6*rad*wavelength**5)))
    return np.where(rad > 0, (planck-intercept)/slope, np.nan)


def scale_counts(raw, attrs, index, quantity):
    raw = np.asarray(raw)
    lo, hi = attrs.get("valid_range", (0, 32767))
    valid = (raw >= lo) & (raw <= hi) & (raw != attrs.get("_FillValue", 65535))
    scales, offsets = np.atleast_1d(attrs[quantity+"_scales"]), np.atleast_1d(attrs[quantity+"_offsets"])
    return np.where(valid, (raw.astype(float)-offsets[index])*scales[index], np.nan)


def decode_cloud_mask(byte0):
    """MOD35 byte 0: bit0 determined, bits1:2 confidence, bit3 day,
    bit5 no snow/ice. Strict confident-clear QA; uncertainty remains missing.
    Signed int8 bytes are interpreted as bit patterns, never as signed flags.
    """
    b = np.asarray(byte0).astype(np.uint8)
    determined, day = (b & 1) != 0, (b & 8) != 0
    confidence = (b >> 1) & 3
    known = determined & day
    cloud = np.where(known, (confidence != 3).astype(float), np.nan)
    snow = np.where(known, ((b & 32) == 0).astype(float), np.nan)
    return cloud, snow


@contextmanager
def hdf(path):
    try:
        from pyhdf.SD import SD, SDC
    except ImportError:
        raise RuntimeError("Install MODIS dependencies: python -m pip install -r requirements-modis.txt") from None
    handle = SD(str(path), SDC.READ)
    try:
        yield handle
    finally:
        handle.end()


def _read(handle, name, selection=None):
    field = handle.select(name)
    try:
        return np.asarray(field[selection] if selection is not None else field[:]), field.attributes()
    finally:
        field.endaccess()


@dataclass
class Swath:
    lon: np.ndarray
    lat: np.ndarray
    classes: np.ndarray
    factors: dict
    threshold: float | None
    acquired_utc: str
    names: list


def read_swath(l1b, geo, mask, bbox, settings=None):
    paths = (l1b, geo, mask)
    names = [p.name for p in paths]
    if any(not FILENAME.fullmatch(n) for n in names):
        raise ValueError("MODIS C6.1 filenames are required")
    granules = [Granule(n) for n in names]
    if len({g.key for g in granules}) != 1 or not granules[0].product.endswith("021KM") or not granules[1].product.endswith("03") or not granules[2].product.endswith("35_L2"):
        raise ValueError("L1B, geolocation and cloud mask must have identical satellite/acquisition time")
    settings = settings or Settings()
    w, s, e, n = bbox
    with hdf(geo) as geofile:
        lat, _ = _read(geofile, "Latitude")
        lon, _ = _read(geofile, "Longitude")
        inside = np.isfinite(lat) & np.isfinite(lon) & (lat >= s) & (lat <= n) & (lon >= w) & (lon <= e)
        rows, cols = np.where(inside)
        if not len(rows):
            return None
        region = (slice(int(rows.min()), int(rows.max())+1), slice(int(cols.min()), int(cols.max())+1))
        shape = lat.shape
        lon, lat, inside = lon[region], lat[region], inside[region]
        solar, attrs = _read(geofile, "SolarZenith", region)
        # MOD03 scale_factor multiplies packed angles (not the L1B offset convention).
        solar = solar.astype(float)*float(attrs.get("scale_factor", .01))
        sun = np.cos(np.radians(solar))
        inside &= (solar >= 0) & (solar < 85)
    bands = {}
    with hdf(l1b) as image:
        for name, wanted in [("EV_250_Aggr1km_RefSB", [1, 2]),
                             ("EV_500_Aggr1km_RefSB", [3, 4, 5, 7]),
                             ("EV_1KM_RefSB", [8]), ("EV_1KM_Emissive", [20, 31, 32])]:
            field = image.select(name)
            try:
                attrs = field.attributes()
                band_names = str(attrs["band_names"]).split(",")
                if tuple(field.info()[2][-2:]) != shape:
                    raise ValueError("MODIS L1B/geolocation dimensions do not match")
                for band in wanted:
                    index = [v.strip() for v in band_names].index(str(band))
                    raw = np.asarray(field[(index, *region)])
                    if band >= 20:
                        value = brightness_temperature(scale_counts(raw, attrs, index, "radiance"), band)
                    else:
                        # L1B scaled reflectance is rho*cos(solar zenith). Ratios
                        # cancel the geometry; absolute cloud thresholds do not.
                        value = scale_counts(raw, attrs, index, "reflectance") / np.where(sun > 0, sun, np.nan)
                    bands[("bt" if band >= 20 else "b")+str(band)] = np.where(inside, value, np.nan)
            finally:
                field.endaccess()
    with hdf(mask) as clouds:
        field = clouds.select("Cloud_Mask")
        try:
            if tuple(field.info()[2][1:]) != shape:
                raise ValueError("MODIS cloud mask/geolocation dimensions do not match")
            byte0 = np.asarray(field[(0, *region)])
        finally:
            field.endaccess()
    cloud, snow = decode_cloud_mask(byte0)
    classes, factors, threshold = classify(bands, cloud, snow, settings)
    return Swath(lon, lat, classes, factors, threshold, granules[0].acquired.isoformat(), names)
