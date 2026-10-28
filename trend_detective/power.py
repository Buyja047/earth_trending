"""Read monthly NASA POWER analysis-ready Zarr stores from the public S3 bucket.

The ``nasa-power`` bucket (AWS Open Data, us-west-2, anonymous access) holds
POWER v10 products re-gridded from NASA sources:

* ``merra2``  - GMAO MERRA-2 reanalysis (a model), 0.5 x 0.625 deg, 1981-
* ``syn1deg`` - CERES SYN1deg (Terra/Aqua + geostationary), 1 deg, 2001-
* ``imerg``   - GPM IMERG precipitation (satellite mission), 0.1 deg, 1998-

The "temporal" stores are chunked as (all months, 30x30 cells), so reading a
region pulls every month for only the tiles it overlaps - the right layout
for per-cell trend analysis. Loaded subsets are cached as NetCDF.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
import xarray as xr

BUCKET_URL = "https://nasa-power.s3.us-west-2.amazonaws.com"
STORES = {
    "merra2": "merra2/temporal/power_merra2_monthly_temporal_utc.zarr",
    "syn1deg": "syn1deg/temporal/power_syn1deg_monthly_temporal_utc.zarr",
    "imerg": "imerg/temporal/power_imerg_monthly_temporal_utc.zarr",
}
STORAGE_OPTIONS = {"client_kwargs": {"trust_env": True}}  # honour HTTPS_PROXY
DEFAULT_CACHE = Path(__file__).resolve().parent.parent / "cache"

_open: dict[str, xr.Dataset] = {}


def store_url(product: str) -> str:
    return f"{BUCKET_URL}/{STORES[product]}"


def open_product(product: str) -> xr.Dataset:
    """Lazily open a product's monthly store (metadata only, no data read)."""
    if product not in _open:
        _open[product] = xr.open_zarr(store_url(product), consolidated=True,
                                      storage_options=STORAGE_OPTIONS)
    return _open[product]


def last_available() -> dict:
    """The bucket's own record of the latest date per product and level."""
    import requests

    r = requests.get(f"{BUCKET_URL}/last_available.json", timeout=60)
    r.raise_for_status()
    return r.json()


def load(product: str, var: str, bbox=None, start="1981-01", end="2025-12",
         coarsen: int = 1, cache_dir: Path | None = DEFAULT_CACHE) -> xr.DataArray:
    """Monthly (time, lat, lon) array for a region and period.

    ``bbox`` is (lon_min, lat_min, lon_max, lat_max) or None for the globe.
    ``coarsen`` > 1 block-averages lat/lon (edges trimmed). Months are
    labelled by their last day in the store and are returned unchanged.
    """
    key = json.dumps([product, var, bbox, start, end, coarsen])
    path = None
    if cache_dir is not None:
        cache_dir.mkdir(parents=True, exist_ok=True)
        path = cache_dir / f"{product}_{var}_{hashlib.sha1(key.encode()).hexdigest()[:10]}.nc"
        if path.exists():
            return xr.open_dataarray(path).load()

    ds = open_product(product)
    da = ds[var]
    if bbox is not None:
        lon0, lat0, lon1, lat1 = bbox
        da = da.sel(lat=slice(lat0, lat1), lon=slice(lon0, lon1))
    t = da["time"].values.astype("datetime64[M]")
    sel = (t >= np.datetime64(start, "M")) & (t <= np.datetime64(end, "M"))
    da = da.isel(time=np.flatnonzero(sel)).load()
    if coarsen > 1:
        da = da.coarsen(lat=coarsen, lon=coarsen, boundary="trim").mean()
    da = da.astype("float32")
    da.attrs.update({k: v for k, v in ds[var].attrs.items() if isinstance(v, (str, int, float))})
    da.attrs["product"] = product
    if path is not None:
        da.to_netcdf(path)
    return da


def variable_table(product: str) -> list[dict]:
    """Base monthly variables of a product with name, units and definition.

    Hour-of-day variants (``T2M_00`` ... ``T2M_23``) are left out.
    """
    ds = open_product(product)
    rows = []
    for name, v in ds.data_vars.items():
        if len(name) > 3 and name[-3] == "_" and name[-2:].isdigit():
            continue
        if v.dims != ("time", "lat", "lon"):
            continue
        rows.append({
            "product": product,
            "var": name,
            "long_name": v.attrs.get("long_name", name),
            "units": v.attrs.get("units", ""),
            "definition": v.attrs.get("definition", ""),
        })
    return rows
