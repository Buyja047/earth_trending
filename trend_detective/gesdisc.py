"""MERRA-2 aerosol diagnostics (M2TMNXAER) from NASA GES DISC, for dust trends.

NASA POWER carries no dust variables, so dust comes from the MERRA-2 monthly
aerosol collection at GES DISC (CMR concept C1276812866-GES_DISC, 0.5 x 0.625 deg,
the same grid as POWER's MERRA-2 store). GES DISC data need an Earthdata Login:
set EARTHDATA_TOKEN to an EDL user token (https://urs.earthdata.nasa.gov, "Generate
Token"), from an account that has approved the "NASA GESDISC DATA ARCHIVE"
application.

Granules are listed through the public CMR API. Each month's box is cut out
server-side by Cloud OPeNDAP (DAP4, a few kB per month); if that answer is not
usable the whole 80 MB file is downloaded and cut here. ``verify`` reads one
month both ways and checks they agree before a full build trusts the subset.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from urllib.parse import quote

import numpy as np
import requests
import xarray as xr

COLLECTION = "C1276812866-GES_DISC"          # M2TMNXAER 5.12.4
CMR_GRANULES = "https://cmr.earthdata.nasa.gov/search/granules.umm_json"
LAT0, DLAT, NLAT = -90.0, 0.5, 361           # MERRA-2 native grid
LON0, DLON, NLON = -180.0, 0.625, 576
DEFAULT_CACHE = Path(__file__).resolve().parent.parent / "cache" / "gesdisc"

# variable: (long name, display units, factor from the file's SI units)
DUST_VARS = {
    "DUSMASS": ("Dust surface mass concentration", "ug m-3", 1e9),
    "DUSMASS25": ("Dust surface mass concentration, PM2.5", "ug m-3", 1e9),
    "DUCMASS": ("Dust column mass density", "g m-2", 1e3),
    "DUEXTTAU": ("Dust extinction aerosol optical thickness, 550 nm", "dimensionless", 1.0),
}


class LoginRequired(RuntimeError):
    pass


def token() -> str:
    tok = os.environ.get("EARTHDATA_TOKEN", "").strip()
    if not tok:
        raise LoginRequired(
            "GES DISC needs an Earthdata Login. Create a free account at "
            "https://urs.earthdata.nasa.gov, approve the 'NASA GESDISC DATA ARCHIVE' "
            "application, generate a user token and provide it as EARTHDATA_TOKEN.")
    return tok


def box_index(bbox) -> tuple[int, int, int, int]:
    """Rows and columns whose cell centres lie inside (lon0, lat0, lon1, lat1), inclusive."""
    lon0, lat0, lon1, lat1 = bbox
    iy0 = max(0, int(np.ceil((lat0 - LAT0) / DLAT - 1e-9)))
    iy1 = min(NLAT - 1, int(np.floor((lat1 - LAT0) / DLAT + 1e-9)))
    ix0 = max(0, int(np.ceil((lon0 - LON0) / DLON - 1e-9)))
    ix1 = min(NLON - 1, int(np.floor((lon1 - LON0) / DLON + 1e-9)))
    return iy0, iy1, ix0, ix1


def parse_granules(items: list[dict]) -> list[dict]:
    """Month, granule id, file URL and OPeNDAP URL from CMR UMM-G items."""
    out = []
    for it in items:
        u = it["umm"]
        urls = u.get("RelatedUrls", [])
        data = next((x["URL"] for x in urls if x.get("Type") == "GET DATA" and x["URL"].endswith(".nc4")), None)
        dap = next((x["URL"] for x in urls if x.get("Type") == "USE SERVICE API" and "opendap" in x["URL"]), None)
        begin = u["TemporalExtent"]["RangeDateTime"]["BeginningDateTime"]
        out.append({"ym": begin[:7], "ur": u["GranuleUR"], "data": data, "opendap": dap})
    return sorted(out, key=lambda g: g["ym"])


def granules(start: str, end: str) -> list[dict]:
    """All monthly granules from start to end ('YYYY-MM'), via the public CMR search."""
    items, page = [], 1
    while True:
        r = requests.get(CMR_GRANULES, timeout=120, params={
            "collection_concept_id": COLLECTION, "temporal": f"{start}-01T00:00:00Z,{end}-28T23:59:59Z",
            "page_size": 200, "page_num": page, "sort_key": "start_date"})
        r.raise_for_status()
        batch = r.json()["items"]
        items += batch
        if len(batch) < 200:
            break
        page += 1
    return latest_per_month(parse_granules(items))


def latest_per_month(gs: list[dict]) -> list[dict]:
    """A reprocessed month (MERRA2_401) supersedes the original (400); keep the later stream."""
    by_month = {}
    for g in gs:
        if g["ym"] not in by_month or g["ur"] > by_month[g["ym"]]["ur"]:
            by_month[g["ym"]] = g
    return [by_month[k] for k in sorted(by_month)]


def dap4_url(opendap: str, variables, idx) -> str:
    """Cloud OPeNDAP request for a lat/lon box of some variables, answered as netCDF-4."""
    iy0, iy1, ix0, ix1 = idx
    parts = [f"/{v}[0:1:0][{iy0}:1:{iy1}][{ix0}:1:{ix1}]" for v in variables]
    parts += [f"/lat[{iy0}:1:{iy1}]", f"/lon[{ix0}:1:{ix1}]"]
    return f"{opendap}.dap.nc4?dap4.ce=" + quote(";".join(parts), safe="/:")


def _get(url: str, session: requests.Session) -> bytes:
    r = session.get(url, headers={"Authorization": f"Bearer {token()}"}, timeout=600, allow_redirects=True)
    if r.status_code in (401, 403) or "urs.earthdata.nasa.gov" in r.url or r.content[:15].lower().startswith(b"<!doctype html"):
        raise LoginRequired(f"Earthdata Login refused the request ({r.status_code}); check the token "
                            "and that the 'NASA GESDISC DATA ARCHIVE' application is approved")
    r.raise_for_status()
    return r.content


def read_box(content: bytes, variables, idx=None) -> dict:
    """Arrays of a netCDF-4 answer, cut to the box when the file is the whole globe."""
    import netCDF4

    with netCDF4.Dataset("mem.nc4", memory=content) as nc:
        out = {}
        for v in list(variables) + ["lat", "lon"]:
            a = np.ma.filled(nc.variables[v][:].astype("float64"), np.nan)
            if idx is not None and v not in ("lat", "lon"):
                iy0, iy1, ix0, ix1 = idx
                a = a[..., iy0:iy1 + 1, ix0:ix1 + 1]
            elif idx is not None:
                iy0, iy1, ix0, ix1 = idx
                a = a[iy0:iy1 + 1] if v == "lat" else a[ix0:ix1 + 1]
            out[v] = a.reshape(a.shape[-2:]) if v not in ("lat", "lon") else a
    return out


def month_box(g: dict, variables, idx, session, prefer_subset=True) -> dict:
    """One month's box: server-side subset first, whole file as the fallback."""
    if prefer_subset and g["opendap"]:
        try:
            d = read_box(_get(dap4_url(g["opendap"], variables, idx), session), variables)
            ny, nx = idx[1] - idx[0] + 1, idx[3] - idx[2] + 1
            if all(d[v].shape == (ny, nx) for v in variables):
                return d
        except LoginRequired:
            raise
        except Exception:  # noqa: BLE001 - any unusable answer falls back to the full file
            pass
    return read_box(_get(g["data"], session), variables, idx)


def verify(month: str = "2010-07", bbox=(87.5, 41.0, 120.5, 52.5), variables=("DUSMASS",)) -> dict:
    """Read one month by subset and by whole file and report the largest difference."""
    g = granules(month, month)[0]
    idx = box_index(bbox)
    with requests.Session() as s:
        a = month_box(g, variables, idx, s, prefer_subset=True)
        b = read_box(_get(g["data"], s), variables, idx)
    return {v: float(np.nanmax(np.abs(a[v] - b[v]))) for v in variables} | {
        "lat_equal": bool(np.allclose(a["lat"], b["lat"])), "lon_equal": bool(np.allclose(a["lon"], b["lon"]))}


def load(product: str, var: str, bbox=None, start="1981-01", end="2025-12", coarsen: int = 1,
         cache_dir: Path | None = DEFAULT_CACHE) -> xr.DataArray:
    """Monthly (time, lat, lon) dust field for a box, in display units (same shape as power.load)."""
    if var not in DUST_VARS:
        raise KeyError(f"{var} is not one of {sorted(DUST_VARS)}")
    if bbox is None:
        raise ValueError("a box is required: the whole globe would be 540 x 80 MB")
    key = json.dumps([product, var, bbox, start, end, coarsen])
    path = None
    if cache_dir is not None:
        cache_dir.mkdir(parents=True, exist_ok=True)
        path = cache_dir / f"{var}_{hashlib.sha1(key.encode()).hexdigest()[:10]}.nc"
        if path.exists():
            return xr.open_dataarray(path).load()
    long_name, units, factor = DUST_VARS[var]
    idx = box_index(bbox)
    gs = granules(start, end)
    want = [f"{y}-{m:02d}" for y in range(int(start[:4]), int(end[:4]) + 1) for m in range(1, 13)
            if start <= f"{y}-{m:02d}" <= end]
    have = {g["ym"] for g in gs}
    missing = [m for m in want if m not in have]
    if missing:
        raise RuntimeError(f"CMR lists no granule for {len(missing)} months, e.g. {missing[:3]}")
    fields, lat, lon = [], None, None
    with requests.Session() as s:
        for g in gs:
            d = month_box(g, [var], idx, s)
            fields.append(d[var] * factor)
            lat, lon = d["lat"], d["lon"]
    times = np.array([np.datetime64(g["ym"], "M") for g in gs]).astype("datetime64[ns]")
    da = xr.DataArray(np.stack(fields).astype("float32"), dims=("time", "lat", "lon"),
                      coords={"time": times, "lat": lat, "lon": lon}, name=var,
                      attrs={"long_name": long_name, "units": units, "product": product,
                             "definition": f"MERRA-2 M2TMNXAER {var}, monthly mean"})
    if coarsen > 1:
        da = da.coarsen(lat=coarsen, lon=coarsen, boundary="trim").mean()
    if path is not None:
        da.to_netcdf(path)
    return da
