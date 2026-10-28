"""Sentinel-5P TROPOMI ultraviolet aerosol index (UVAI) from DLR's daily L3 composites.

Source: DLR EOC Geoservice, STAC collection ``S5P_TROPOMI_L3_P1D_AI_v2``, daily
means on a 0.1 deg grid from 2018-04-30. The L2 behind it is NASA's TROPOMAER
(354/388 nm) run on Copernicus Sentinel-5P radiances; DLR grids it. The licence
written in every file is "CC-BY-4.0; contains modified Copernicus Sentinel data
(YEAR) processed by DLR" (the STAC collection's licence *link* points to
CC BY-NC 4.0 instead; see docs/DATA_LICENSES.md).

UVAI is positive when UV-absorbing aerosol (desert dust, smoke, volcanic ash)
lies above a few hundred metres; clouds and non-absorbing aerosol give values
near zero. It sees elevated dust better than dust hugging the ground, and smoke
from spring fires looks the same as dust, so it checks dust *events*, not mass.
Over Mongolia the background also moves with season and surface: calm, dry,
snow-free days read about 0.8 in January and -0.2 in July, and snow-covered days
read lower because TropOMAER switches to its Lambertian-surface retrieval over snow
(scripts/check_dust_s5p.py). Compare days within one cell and calendar month.

The files are cloud-optimised GeoTIFFs, so only the tiles over the box are read.
Daily fields are averaged onto the cells of another grid (here MERRA-2's).
"""

from __future__ import annotations

import hashlib
import json
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import requests
import xarray as xr

from . import power
from .hazard import _retry

STAC = "https://geoservice.dlr.de/eoc/ogc/stac/v1"
COLLECTION = "S5P_TROPOMI_L3_P1D_AI_v2"
FIRST_DAY = "2018-04-30"
CREDIT = "Contains modified Copernicus Sentinel data (2018-2025) processed by DLR; L2 NASA TROPOMAER; CC BY 4.0"
DEFAULT_CACHE = power.DEFAULT_CACHE
_PREFERENCE = {"RPRO": 0, "OFFL": 1, "NRTI": 2}   # reprocessed beats offline beats near-real-time


def list_days(start: str, end: str) -> dict:
    """{date: GeoTIFF URL} for each day from ``start`` to ``end`` (YYYY-MM-DD), best processing kept."""
    url = f"{STAC}/collections/{COLLECTION}/items"
    params = {"f": "json", "limit": 500, "datetime": f"{start}T00:00:00Z/{end}T23:59:59Z"}
    best = {}
    session = requests.Session()
    while url:
        page = _retry(lambda: session.get(url, params=params, timeout=120).json())
        for f in page["features"]:
            ymd = f["id"][-8:]   # ..._L3_AI_YYYYMMDD
            day = f"{ymd[:4]}-{ymd[4:6]}-{ymd[6:]}"
            rank = _PREFERENCE.get(f["properties"].get("product:type"), 9)
            if day not in best or rank < best[day][0]:
                best[day] = (rank, f["assets"]["ai"]["href"])
        url = next((ln["href"] for ln in page["links"] if ln["rel"] == "next"), None)
        params = None   # the next link carries the query
    return {d: best[d][1] for d in sorted(best)}


def cell_edges(cell_lat, cell_lon):
    dlat, dlon = np.diff(cell_lat).mean(), np.diff(cell_lon).mean()
    return (cell_lon[0] - dlon / 2, cell_lat[0] - dlat / 2, cell_lon[-1] + dlon / 2, cell_lat[-1] + dlat / 2)


def to_cells(field, lat, lon, cell_lat, cell_lon, min_valid: float = 0.5) -> np.ndarray:
    """Mean of the pixels whose centres fall in each cell; NaN when under ``min_valid`` of them have a value."""
    dlat, dlon = np.diff(cell_lat).mean(), np.diff(cell_lon).mean()
    # 0.1 deg pixel centres can sit exactly on a 0.5 deg cell edge; the small offset sends those ties north/east
    i = np.floor((lat - (cell_lat[0] - dlat / 2)) / dlat + 1e-6).astype(int)
    j = np.floor((lon - (cell_lon[0] - dlon / 2)) / dlon + 1e-6).astype(int)
    ii, jj = np.meshgrid(i, j, indexing="ij")
    inside = (ii >= 0) & (ii < cell_lat.size) & (jj >= 0) & (jj < cell_lon.size)
    idx = np.where(inside, ii * cell_lon.size + jj, -1).ravel()
    keep = idx >= 0
    idx, v = idx[keep], field.ravel()[keep]
    ok = np.isfinite(v)
    n = cell_lat.size * cell_lon.size
    tot = np.bincount(idx, minlength=n).astype(float)
    good = np.bincount(idx[ok], minlength=n).astype(float)
    s = np.bincount(idx[ok], weights=v[ok], minlength=n)
    with np.errstate(invalid="ignore", divide="ignore"):
        out = np.where((tot > 0) & (good >= min_valid * tot), s / good, np.nan)
    return out.reshape(cell_lat.size, cell_lon.size)


def read_box(href: str, bounds) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """The 0.1 deg UVAI field inside ``bounds`` (lon0, lat0, lon1, lat1) with pixel-centre lat and lon."""
    import rasterio
    from rasterio.windows import Window

    env = {"GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR", "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".tif",
           "GDAL_HTTP_MAX_RETRY": "3", "GDAL_HTTP_RETRY_DELAY": "2"}
    if os.path.exists("/root/.ccr/ca-bundle.crt") and "CURL_CA_BUNDLE" not in os.environ:
        env["CURL_CA_BUNDLE"] = "/root/.ccr/ca-bundle.crt"
    lon0, lat0, lon1, lat1 = bounds
    with rasterio.Env(**env), rasterio.open(f"/vsicurl/{href}") as r:
        t = r.transform
        c0, c1 = int(np.floor((lon0 - t.c) / t.a)), int(np.ceil((lon1 - t.c) / t.a))
        r0, r1 = int(np.floor((lat1 - t.f) / t.e)), int(np.ceil((lat0 - t.f) / t.e))
        a = r.read(1, window=Window(c0, r0, c1 - c0, r1 - r0)).astype("float64")
        a[(a == r.nodata) | (np.abs(a) > 1e30)] = np.nan
        lat = t.f + (np.arange(r0, r1) + 0.5) * t.e
        lon = t.c + (np.arange(c0, c1) + 0.5) * t.a
    return a, lat, lon


def daily_cells(cell_lat, cell_lon, start: str, end: str, cache_dir: Path | None = DEFAULT_CACHE,
                workers: int = 8) -> xr.DataArray:
    """Daily cell-mean UVAI (time, lat, lon) on the given cell centres, one cached file per year."""
    cell_lat, cell_lon = np.asarray(cell_lat, float), np.asarray(cell_lon, float)
    bounds = cell_edges(cell_lat, cell_lon)
    days = np.arange(np.datetime64(max(start, FIRST_DAY)), np.datetime64(end) + 1)
    parts = []
    for year in np.unique(days.astype("datetime64[Y]")):
        yd = days[days.astype("datetime64[Y]") == year]
        key = json.dumps(["s5p-ai-v1", COLLECTION, list(np.round(bounds, 4)), str(yd[0]), str(yd[-1])])
        path = None
        if cache_dir is not None:
            cache_dir.mkdir(parents=True, exist_ok=True)
            path = cache_dir / f"s5pai_{hashlib.sha1(key.encode()).hexdigest()[:10]}.nc"
            if path.exists():
                parts.append(xr.open_dataarray(path).load())
                continue
        urls = list_days(str(yd[0]), str(yd[-1]))
        arr = np.full((yd.size, cell_lat.size, cell_lon.size), np.nan, "float32")

        def one(k):
            href = urls.get(str(yd[k]))
            if href is None:
                return k, None
            try:
                a, la, lo = _retry(lambda: read_box(href, bounds))
            except Exception as e:  # noqa: BLE001 - a day that will not read stays missing
                print(f"  {yd[k]} unreadable, left out: {e}", flush=True)
                return k, None
            return k, to_cells(a, la, lo, cell_lat, cell_lon)

        with ThreadPoolExecutor(workers) as ex:
            for k, cells in ex.map(one, range(yd.size)):
                if cells is not None:
                    arr[k] = cells
        print(f"S5P UVAI {year}: {np.isfinite(arr).any(axis=(1, 2)).sum()} of {yd.size} days", flush=True)
        da = xr.DataArray(arr, dims=("time", "lat", "lon"),
                          coords={"time": yd.astype("datetime64[ns]"), "lat": cell_lat, "lon": cell_lon},
                          name="UVAI", attrs={"source": f"{STAC}/collections/{COLLECTION}", "credit": CREDIT})
        if path is not None and yd[-1] < np.datetime64("today") - np.timedelta64(30, "D"):
            da.to_netcdf(path)
        parts.append(da)
    return xr.concat(parts, "time")

