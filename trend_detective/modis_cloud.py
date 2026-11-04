"""MODIS scenes without Earth Engine: the same products read from the archives themselves.

Country, on the 0.05° climate modelling grid (CMG): MOD11C3 monthly land surface temperature and
MOD13C2 monthly NDVI are subset by OPeNDAP from the LP DAAC cloud; MOD10C1 daily snow cover is
downloaded from the NSIDC cloud. Boxes at 1 km: MOD11A2 and MOD10A1 tiles are read as windows of
cloud-optimised GeoTIFFs from Microsoft's Planetary Computer mirror of the NASA archive (no account
needed); MOD13A3 tiles are downloaded from the LP DAAC cloud. The NASA downloads need an Earthdata
Login bearer token in ``EARTHDATA_TOKEN``. Quality rules, seasons and cell sizes follow
``trend_detective.modis``; see docs/MODIS_TRENDS.md.
"""
from __future__ import annotations

import calendar
import json
import math
import os
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from pathlib import Path

import numpy as np

from .modis import (MIN_CLEAR_OBS, MIN_COMPOSITES, NATIVE_KM, NDSI_SNOW, REGIONS, START_YEAR, VARS, bbox_of, grid_for,
                    season_months)

CMG_DEG = 0.05
CMR = "https://cmr.earthdata.nasa.gov/search/granules.json"
PC = "https://planetarycomputer.microsoft.com/api"
PC_COLLECTIONS = {"lst": "modis-11A2-061", "snow": "modis-10A1-061"}
PC_STORAGE = ("modiseuwest", "modis-061-cogs")
CMG_PRODUCTS = {"lst": ("MOD11C3", "061"), "ndvi": ("MOD13C2", "061"), "snow": ("MOD10C1", "61")}
TILE_PRODUCTS = {"ndvi": ("MOD13A3", "061")}
CMG_GROUPS = {"lst": "MODIS_MONTHLY_0_05DEG_CMG_LST/Data_Fields", "ndvi": "MOD_Grid_monthly_CMG_VI/Data_Fields"}
CMG_LST_FIELDS = {"Day": ("LST_Day_CMG", "QC_Day"), "Night": ("LST_Night_CMG", "QC_Night")}
CMG_NDVI_FIELDS = ("CMG_0_05_Deg_Monthly_NDVI", "CMG_0_05_Deg_Monthly_pixel_reliability")
TILE_NDVI_FIELDS = ("1 km monthly NDVI", "1 km monthly pixel reliability")
CLEAR_INDEX_MIN = 70        # MOD10C1: a day counts when more than 70 % of the cell's land was seen clear (the MOD10CM rule)
NDVI_FILL = -3000
LST_SCALE, KELVIN = 0.02, 273.15
# MODIS sinusoidal grid (sphere of radius R; 18 x 36 tiles of 10 degrees at the equator)
SINU_R = 6371007.181
TILE_M = 1111950.5196666666
TILE_X0, TILE_Y0 = -20015109.354, 10007554.677
UA = "trend-detective (https://github.com/Buyja047/earth_trending)"
PAGE = 2000


# ---------------------------------------------------------------------------- HTTP

def token() -> str:
    t = os.environ.get("EARTHDATA_TOKEN", "").strip()
    if not t:
        raise RuntimeError("EARTHDATA_TOKEN is not set: the NASA downloads need an Earthdata Login bearer token "
                           "(https://urs.earthdata.nasa.gov, Generate Token); see docs/MODIS_TRENDS.md")
    return t


def http_get(url: str, auth=False, data: bytes | None = None, timeout=300, retries=4) -> bytes:
    """GET (or POST when ``data`` is given) with retries on 5xx, 429 and network errors; never logs the token."""
    headers = {"User-Agent": UA}
    if auth:
        headers["Authorization"] = "Bearer " + token()
    if data is not None:
        headers["Content-Type"] = "application/json"
    err = None
    for k in range(retries + 1):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=headers), timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                raise RuntimeError(f"{url.split('?')[0]}: HTTP {e.code}; is EARTHDATA_TOKEN valid?") from None
            if e.code < 500 and e.code != 429:
                raise
            err = e
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
            err = e
        time.sleep(2 ** k)
    raise RuntimeError(f"{url.split('?')[0]}: {err}")


def cmr_granules(short_name: str, version: str, t0: date, t1: date, bbox=None) -> list[dict]:
    """Granules of a product between two dates (inclusive), oldest first: title, data URL, OPeNDAP URL, start date."""
    q = {"short_name": short_name, "version": version, "page_size": PAGE, "sort_key": "start_date",
         "temporal": f"{t0:%Y-%m-%d}T00:00:00Z,{t1:%Y-%m-%d}T23:59:59Z"}
    if bbox:
        q["bounding_box"] = ",".join(f"{v:.4f}" for v in bbox)
    out, page = [], 1
    while True:
        q["page_num"] = page
        entries = json.loads(http_get(CMR + "?" + urllib.parse.urlencode(q)))["feed"]["entry"]
        for e in entries:
            links = e.get("links", [])
            data = next((l["href"] for l in links if l.get("rel", "").endswith("/data#") and l["href"].startswith("https://")
                         and l["href"].endswith(".hdf") and "prod-protected" in l["href"]), None)
            opendap = next((l["href"] for l in links if "opendap.earthdata.nasa.gov" in l.get("href", "")), None)
            out.append({"title": e["title"], "data": data, "opendap": opendap, "start": e["time_start"][:10]})
        if len(entries) < PAGE:
            return out
        page += 1


# ---------------------------------------------------------------------------- grids

COUNTRY_DEG = 0.1         # the published country scenes: 2 x 2 climate-modelling-grid cells (the 0.05° scene is 22 MB)


def cmg_grid(bbox, deg: float = COUNTRY_DEG) -> dict:
    """Cells of ``deg`` (a multiple of 0.05°) made of whole climate-modelling-grid cells inside ``bbox``, centres
    south to north and west to east. ``rows``/``cols`` are the 0.05° subset to read, ``block`` the cells per side."""
    f = int(round(deg / CMG_DEG))
    w, s, e, n = bbox
    c0, rn = int(round((w + 180) / CMG_DEG)), int(round((90 - n) / CMG_DEG))
    c1 = c0 + ((int(round((e + 180) / CMG_DEG)) - c0) // f) * f
    rs = rn + ((int(round((90 - s) / CMG_DEG)) - rn) // f) * f
    lat = 90 - CMG_DEG * np.arange(rs - f, rn - 1, -f) - deg / 2
    lon = -180 + CMG_DEG * np.arange(c0, c1, f) + deg / 2
    return {"lat": lat, "lon": lon, "dlat": deg, "dlon": deg, "ny": (rs - rn) // f, "nx": (c1 - c0) // f,
            "west": -180 + CMG_DEG * c0, "north": 90 - CMG_DEG * rn, "rows": (rn, rs), "cols": (c0, c1), "block": f}


def block_mean(arr: np.ndarray, f: int) -> np.ndarray:
    """Mean of f x f blocks over the last two axes, ignoring NaN; NaN where a block has no value."""
    if f == 1:
        return arr
    *lead, ny, nx = arr.shape
    a = np.asarray(arr, float).reshape(*lead, ny // f, f, nx // f, f)
    ok = np.isfinite(a)
    n = ok.sum(axis=(-3, -1))
    return np.where(n > 0, np.where(ok, a, 0.0).sum(axis=(-3, -1)) / np.maximum(n, 1), np.nan)


def region_grid(region: dict, country_deg: float = COUNTRY_DEG) -> dict:
    return cmg_grid(bbox_of(region), country_deg) if region["region"] == "mongolia" else grid_for(bbox_of(region), region["km"])


def sinu_xy(lon, lat):
    lat_r = np.radians(lat)
    return SINU_R * np.radians(lon) * np.cos(lat_r), SINU_R * lat_r


def sinu_lonlat(x, y):
    lat = y / SINU_R
    return np.degrees(x / (SINU_R * np.cos(lat))), np.degrees(lat)


def _edge_points(bbox, n=101):
    w, s, e, nn = bbox
    lons, lats = np.linspace(w, e, n), np.linspace(s, nn, n)
    return (np.concatenate([lons, lons, np.full(n, w), np.full(n, e)]),
            np.concatenate([np.full(n, s), np.full(n, nn), lats, lats]))


def tiles_for(bbox) -> list[tuple[int, int]]:
    """The sinusoidal tiles (h, v) a lon/lat box touches."""
    x, y = sinu_xy(*_edge_points(bbox))
    h = np.floor((x - TILE_X0) / TILE_M).astype(int)
    v = np.floor((TILE_Y0 - y) / TILE_M).astype(int)
    return sorted(set(zip(h.tolist(), v.tolist())))


def tile_window(bbox, h: int, v: int, npx: int):
    """(row0, row1, col0, col1), half-open, of the tile pixels that cover the box; None when the box misses the tile."""
    px = TILE_M / npx
    x, y = sinu_xy(*_edge_points(bbox))
    cols, rows = (x - (TILE_X0 + h * TILE_M)) / px, ((TILE_Y0 - v * TILE_M) - y) / px
    c0, c1 = max(0, int(math.floor(cols.min())) - 1), min(npx, int(math.ceil(cols.max())) + 1)
    r0, r1 = max(0, int(math.floor(rows.min())) - 1), min(npx, int(math.ceil(rows.max())) + 1)
    return None if c1 <= c0 or r1 <= r0 else (r0, r1, c0, c1)


def cell_pixels(grid: dict, h: int, v: int, npx: int, window):
    """For each cell centre: row and column inside the window of the native pixel that holds it, and whether it does."""
    lon2d, lat2d = np.meshgrid(grid["lon"], grid["lat"])
    x, y = sinu_xy(lon2d, lat2d)
    px = TILE_M / npx
    r0, r1, c0, c1 = window
    col = np.floor((x - (TILE_X0 + h * TILE_M)) / px).astype(int) - c0
    row = np.floor(((TILE_Y0 - v * TILE_M) - y) / px).astype(int) - r0
    ok = (row >= 0) & (row < r1 - r0) & (col >= 0) & (col < c1 - c0)
    return row, col, ok


def pixel_cells(grid: dict, h: int, v: int, npx: int, window) -> np.ndarray:
    """For each pixel of the window: the flat index of the grid cell holding its centre, or -1."""
    r0, r1, c0, c1 = window
    px = TILE_M / npx
    x = TILE_X0 + h * TILE_M + (np.arange(c0, c1) + 0.5) * px
    y = TILE_Y0 - v * TILE_M - (np.arange(r0, r1) + 0.5) * px
    lon, lat = sinu_lonlat(*np.meshgrid(x, y))
    south = grid["north"] - grid["ny"] * grid["dlat"]
    i = np.floor((lon - grid["west"]) / grid["dlon"]).astype(int)
    j = np.floor((lat - south) / grid["dlat"]).astype(int)
    ok = (i >= 0) & (i < grid["nx"]) & (j >= 0) & (j < grid["ny"])
    return np.where(ok, j * grid["nx"] + i, -1)


def _sample(arr: np.ndarray, mapping, grid: dict) -> np.ndarray:
    """Window values at each cell's native pixel (NaN outside the window)."""
    row, col, ok = mapping
    out = np.full((grid["ny"], grid["nx"]), np.nan)
    out[ok] = arr[row[ok], col[ok]]
    return out


# ---------------------------------------------------------------------------- quality rules (shared with the Earth Engine path)

def lst_celsius(raw: np.ndarray, qc: np.ndarray) -> np.ndarray:
    """MOD11 LST in °C where the mandatory QA is good or other quality and the LST error is <= 2 K; NaN elsewhere."""
    raw, qc = np.asarray(raw, np.float64), np.asarray(qc).astype(np.uint8)
    good = (raw > 0) & ((qc & 3) <= 1) & (((qc >> 6) & 3) <= 1)
    return np.where(good, raw * LST_SCALE - KELVIN, np.nan)


def ndvi_value(raw: np.ndarray, reliability: np.ndarray) -> np.ndarray:
    """MOD13 NDVI where the pixel reliability is good (0) or marginal (1); NaN elsewhere."""
    raw, rel = np.asarray(raw, np.float64), np.asarray(reliability).astype(np.int16)
    return np.where((raw != NDVI_FILL) & (rel >= 0) & (rel <= 1), raw / 10000.0, np.nan)


def snow_days_month(snow_sum: np.ndarray, clear: np.ndarray, days: int, min_obs: int = MIN_CLEAR_OBS) -> np.ndarray:
    """Snow-covered days of a month: the snow share of the clear-sky observations times the month's days, or NaN
    where the month has fewer than ``min_obs`` clear observations."""
    out = np.asarray(snow_sum, np.float64) / np.maximum(clear, 1) * days
    return np.where(clear >= min_obs, out, np.nan)


def month_key(y: int, m: int, tile=None) -> str:
    return f"{y}-{m:02d}" + (f"-h{tile[0]:02d}v{tile[1]:02d}" if tile else "")


def season_from_raw(raw: dict, months, grid: dict, maps: dict | None, min_obs: int = MIN_CLEAR_OBS) -> np.ndarray:
    """A winter's snow-covered days per cell from the cached monthly ingredients; NaN unless all months are valid.
    ``maps`` (tile -> (window, pixel cell index)) aggregates 500 m pixels into the 1 km cells of a box; None for the CMG."""
    ncell = grid["ny"] * grid["nx"]
    total, ok = np.zeros(ncell), np.ones(ncell, bool)
    for y, m in months:
        days = calendar.monthrange(y, m)[1]
        if maps is None:
            month = snow_days_month(raw[month_key(y, m) + "-sum"], raw[month_key(y, m) + "-cnt"], days, min_obs).reshape(-1)
        else:
            csum, ccnt = np.zeros(ncell), np.zeros(ncell)
            for tile, (_, idx) in maps.items():
                k = month_key(y, m, tile)
                if k + "-sum" not in raw:
                    continue
                per_pixel = snow_days_month(raw[k + "-sum"], raw[k + "-cnt"], days, min_obs)
                keep = np.isfinite(per_pixel) & (idx >= 0)
                np.add.at(csum, idx[keep], per_pixel[keep])
                np.add.at(ccnt, idx[keep], 1)
            month = np.where(ccnt > 0, csum / np.maximum(ccnt, 1), np.nan)
        ok &= np.isfinite(month)
        total += np.where(np.isfinite(month), month, 0.0)
    return np.where(ok, total, np.nan).reshape(grid["ny"], grid["nx"])


# ---------------------------------------------------------------------------- Planetary Computer (COG windows)

class PlanetaryComputer:
    """STAC search of the MODIS mirror and signed window reads of its cloud-optimised GeoTIFFs."""

    def __init__(self):
        self._sas, self._expiry = None, 0.0

    def sas(self) -> str:
        if self._sas is None or time.time() > self._expiry - 300:
            d = json.loads(http_get(f"{PC}/sas/v1/token/{PC_STORAGE[0]}/{PC_STORAGE[1]}"))
            exp = datetime.fromisoformat(d["msft:expiry"].replace("Z", "+00:00"))
            self._sas, self._expiry = d["token"], exp.replace(tzinfo=exp.tzinfo or timezone.utc).timestamp()
        return self._sas

    def items(self, collection: str, bbox, t0: date, t1: date) -> list[dict]:
        """Terra items of a collection over a box and a date range (composite or day start dates), oldest first."""
        body = {"collections": [collection], "bbox": list(bbox), "limit": 1000,
                "datetime": f"{t0:%Y-%m-%d}T00:00:00Z/{t1:%Y-%m-%d}T23:59:59Z", "query": {"platform": {"eq": "terra"}}}
        out = []
        while body is not None:
            d = json.loads(http_get(PC + "/stac/v1/search", data=json.dumps(body).encode()))
            out += [f for f in d["features"] if f["id"].startswith("MOD") and f["properties"].get("platform", "terra") == "terra"]
            nxt = next((l for l in d.get("links", []) if l.get("rel") == "next"), None)
            body = nxt.get("body") if nxt else None
        out.sort(key=lambda f: f["properties"].get("start_datetime", ""))
        return out

    def window(self, href: str, window, retries=3) -> np.ndarray:
        import rasterio
        from rasterio.windows import Window
        r0, r1, c0, c1 = window
        err = None
        for k in range(retries + 1):
            try:
                with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
                                  GDAL_HTTP_MAX_RETRY="3", GDAL_HTTP_RETRY_DELAY="2", VSI_CACHE="FALSE"):
                    with rasterio.open(f"/vsicurl/{href}?{self.sas()}") as ds:
                        return ds.read(1, window=Window(c0, r0, c1 - c0, r1 - r0))
            except Exception as e:  # rasterio.errors.RasterioIOError and friends
                err = e
                time.sleep(2 ** k)
        raise RuntimeError(f"{href.rsplit('/', 1)[-1]}: {err}")


def _item_tile(it: dict) -> tuple[int, int]:
    return int(it["properties"]["modis:horizontal-tile"]), int(it["properties"]["modis:vertical-tile"])


# ---------------------------------------------------------------------------- country: CMG products

def _find_var(ds, name: str):
    stack = [ds]
    while stack:
        g = stack.pop()
        if name in g.variables:
            return g.variables[name]
        stack.extend(g.groups.values())
    raise KeyError(name)


def opendap_bytes(url: str, group: str, fields, grid: dict) -> bytes:
    """The DAP4 NetCDF response holding the CMG rows and columns of ``grid`` for each field (safe to call in threads)."""
    rn, rs = grid["rows"]
    c0, c1 = grid["cols"]
    ce = ";".join(f"/{group}/{f}[{rn}:1:{rs - 1}][{c0}:1:{c1 - 1}]" for f in fields)
    return http_get(url + ".dap.nc4?dap4.ce=" + urllib.parse.quote(ce, safe=""), auth=True)


def opendap_parse(data: bytes, fields) -> dict[str, np.ndarray]:
    """Each field south to north as raw integers (no scaling). netCDF4/HDF5 are not thread-safe: call on one thread."""
    import netCDF4
    ds = netCDF4.Dataset("subset.nc4", memory=data)
    try:
        out = {}
        for f in fields:
            var = _find_var(ds, f)
            var.set_auto_maskandscale(False)
            out[f] = np.asarray(var[:])[::-1].copy()
    finally:
        ds.close()
    return out


def _month_granule(short_name: str, version: str, year: int, month: int) -> dict | None:
    days = calendar.monthrange(year, month)[1]
    found = [g for g in cmr_granules(short_name, version, date(year, month, 1), date(year, month, days)) if g["opendap"]]
    return found[0] if found else None


LST_FIELDS = [n for pair in CMG_LST_FIELDS.values() for n in pair]


def cmg_lst_bytes(year: int, month: int, grid: dict) -> bytes | None:
    g = _month_granule(*CMG_PRODUCTS["lst"], year, month)
    return None if g is None else opendap_bytes(g["opendap"], CMG_GROUPS["lst"], LST_FIELDS, grid)


def cmg_lst_parse(data: bytes | None) -> dict[str, np.ndarray] | None:
    if data is None:
        return None
    sub = opendap_parse(data, LST_FIELDS)
    return {key: lst_celsius(sub[lst], sub[qc]) for key, (lst, qc) in CMG_LST_FIELDS.items()}


def cmg_lst_month(year: int, month: int, grid: dict) -> dict[str, np.ndarray] | None:
    return cmg_lst_parse(cmg_lst_bytes(year, month, grid))


def cmg_ndvi_month(year: int, month: int, grid: dict) -> np.ndarray | None:
    g = _month_granule(*CMG_PRODUCTS["ndvi"], year, month)
    if g is None:
        return None
    sub = opendap_parse(opendap_bytes(g["opendap"], CMG_GROUPS["ndvi"], CMG_NDVI_FIELDS, grid), CMG_NDVI_FIELDS)
    return ndvi_value(sub[CMG_NDVI_FIELDS[0]], sub[CMG_NDVI_FIELDS[1]])


def cmg_snow_month_raw(year: int, month: int, grid: dict, workdir: Path, threads=8) -> tuple[np.ndarray, np.ndarray]:
    """One month of daily MOD10C1 per cell: the summed snow share of the clearly seen land, and the number of clear days
    (Clear Index above 70 %, the MOD10CM rule). The minimum-observation rule is applied later (season_from_raw)."""
    from pyhdf.SD import SD, SDC
    days = calendar.monthrange(year, month)[1]
    granules = [g for g in cmr_granules(*CMG_PRODUCTS["snow"], date(year, month, 1), date(year, month, days)) if g["data"]]
    rn, rs = grid["rows"]
    c0, c1 = grid["cols"]
    frac_sum, valid = np.zeros((rs - rn, c1 - c0)), np.zeros((rs - rn, c1 - c0))     # at 0.05°, whatever the cell size

    def download(g):
        p = workdir / g["title"]
        p.write_bytes(http_get(g["data"], auth=True))
        return p

    with ThreadPoolExecutor(threads) as ex:
        for p in ex.map(download, granules):           # downloads in threads; HDF4 is read on this thread only
            try:
                sd = SD(str(p), SDC.READ)
                snow = sd.select("Day_CMG_Snow_Cover")[rn:rs, c0:c1][::-1].astype(np.float64)
                ci = sd.select("Day_CMG_Clear_Index")[rn:rs, c0:c1][::-1].astype(np.float64)
                sd.end()
            finally:
                p.unlink(missing_ok=True)
            ok = (ci > CLEAR_INDEX_MIN) & (ci <= 100) & (snow <= 100)
            frac_sum += np.where(ok, np.minimum(1.0, snow / np.maximum(ci, 1.0)), 0.0)
            valid += ok
    return frac_sum.astype(np.float32), valid.astype(np.uint8)


# ---------------------------------------------------------------------------- boxes: tiles

def box_lst_year(pc: PlanetaryComputer, region: dict, grid: dict, year: int, threads=8) -> dict[str, np.ndarray]:
    """Monthly means of the QA-passing 8-day composites (>= 2 per month) at each cell's pixel; {"Day", "Night"}: (months, ny, nx)."""
    bbox = bbox_of(region)
    months = [m for m in range(1, 13) if (year, m) >= (START_YEAR, 3)]
    items = pc.items(PC_COLLECTIONS["lst"], bbox, date(year, 1, 1), date(year, 12, 31))
    maps = {}
    for h, v in tiles_for(bbox):
        win = tile_window(bbox, h, v, 1200)
        if win:
            maps[(h, v)] = (win, cell_pixels(grid, h, v, 1200, win))
    shape = (grid["ny"], grid["nx"])
    acc = {key: {m: [np.zeros(shape), np.zeros(shape)] for m in months} for key in ("Day", "Night")}

    def read(it):
        tile = _item_tile(it)
        if tile not in maps:
            return None
        win, mapping = maps[tile]
        m = int(it["properties"]["start_datetime"][5:7])
        if m not in months:
            return None
        out = {}
        for key in ("Day", "Night"):
            raw = pc.window(it["assets"][f"LST_{key}_1km"]["href"], win)
            qc = pc.window(it["assets"][f"QC_{key}"]["href"], win)
            out[key] = _sample(lst_celsius(raw, qc), mapping, grid)
        return m, out

    with ThreadPoolExecutor(threads) as ex:
        for res in ex.map(read, items):
            if res is None:
                continue
            m, out = res
            for key, vals in out.items():
                good = np.isfinite(vals)
                acc[key][m][0] += np.where(good, vals, 0.0)
                acc[key][m][1] += good
    result = {}
    for key in ("Day", "Night"):
        bands = []
        for m in months:
            s, n = acc[key][m]
            bands.append(np.where(n >= MIN_COMPOSITES, s / np.maximum(n, 1), np.nan))
        result[key] = np.stack(bands)
    return result


def box_maps(region: dict, grid: dict) -> dict:
    """tile -> (window, flat cell index of every 500 m pixel) for the MOD10A1 tiles a box touches."""
    bbox = bbox_of(region)
    maps = {}
    for h, v in tiles_for(bbox):
        win = tile_window(bbox, h, v, 2400)
        if win:
            maps[(h, v)] = (win, pixel_cells(grid, h, v, 2400, win))
    return maps


def box_snow_month_raw(pc: PlanetaryComputer, region: dict, y: int, m: int, maps: dict, threads=8) -> dict:
    """One month of daily MOD10A1 per 500 m pixel of each tile window: snow-covered days and clear days (uint8)."""
    days = calendar.monthrange(y, m)[1]
    items = pc.items(PC_COLLECTIONS["snow"], bbox_of(region), date(y, m, 1), date(y, m, days))
    psum = {t: np.zeros((w[1] - w[0], w[3] - w[2]), np.uint16) for t, (w, _) in maps.items()}
    pcnt = {t: np.zeros_like(a) for t, a in psum.items()}

    def read(it):
        tile = _item_tile(it)
        return (tile, pc.window(it["assets"]["NDSI_Snow_Cover"]["href"], maps[tile][0])) if tile in maps else None

    with ThreadPoolExecutor(threads) as ex:
        for res in ex.map(read, items):
            if res is None:
                continue
            tile, arr = res
            valid = arr <= 100
            psum[tile] += (valid & (arr >= NDSI_SNOW)).astype(np.uint16)
            pcnt[tile] += valid.astype(np.uint16)
    return {t: (psum[t].astype(np.uint8), pcnt[t].astype(np.uint8)) for t in maps}


class TileNdvi:
    """Monthly MOD13A3 tiles from the LP DAAC cloud, downloaded once and cut into the boxes that share them."""

    def __init__(self, cache: Path | None, workdir: Path, threads=4):
        self.cache, self.workdir, self.threads = cache, workdir, threads
        self.boxes = {k: r for k, r in REGIONS.items() if r["region"] != "mongolia"}

    def _store(self, region_key: str, y: int, m: int, h: int, v: int) -> Path | None:
        return self.cache / "windows" / f"MOD13A3-{region_key}-{y}-{m:02d}-h{h:02d}v{v:02d}.npy" if self.cache else None

    def _cut(self, path: Path, h: int, v: int, y: int, m: int) -> dict[str, np.ndarray]:
        from pyhdf.SD import SD, SDC
        sd = SD(str(path), SDC.READ)
        raw = sd.select(TILE_NDVI_FIELDS[0])[:]
        rel = sd.select(TILE_NDVI_FIELDS[1])[:]
        sd.end()
        vals = ndvi_value(raw, rel)
        out = {}
        for key, reg in self.boxes.items():
            bbox = bbox_of(reg)
            win = tile_window(bbox, h, v, 1200)
            if win is None:
                continue
            grid = grid_for(bbox, reg["km"])
            r0, r1, c0, c1 = win
            cells = _sample(vals[r0:r1, c0:c1], cell_pixels(grid, h, v, 1200, win), grid)
            out[key] = cells
            store = self._store(key, y, m, h, v)
            if store:
                store.parent.mkdir(parents=True, exist_ok=True)
                np.save(store, cells.astype(np.float32))
        return out

    def month(self, region_key: str, grid: dict, y: int, m: int) -> np.ndarray | None:
        """NDVI of one month at the cells of a box, from the stored windows or from freshly downloaded tiles."""
        bbox = bbox_of(REGIONS[region_key])
        tiles = [(h, v) for h, v in tiles_for(bbox) if tile_window(bbox, h, v, 1200)]
        out = np.full((grid["ny"], grid["nx"]), np.nan)
        missing = []
        for h, v in tiles:
            store = self._store(region_key, y, m, h, v)
            if store and store.exists():
                part = np.load(store)
                out = np.where(np.isfinite(part), part, out)
            else:
                missing.append((h, v))
        if not missing:
            return out
        days = calendar.monthrange(y, m)[1]
        granules = {}
        for g in cmr_granules(*TILE_PRODUCTS["ndvi"], date(y, m, 1), date(y, m, days), bbox=bbox):
            for h, v in missing:
                if f".h{h:02d}v{v:02d}." in g["title"] and g["data"]:
                    granules[(h, v)] = g
        if not granules:
            return None if not tiles else out

        def download(hv):
            p = self.workdir / granules[hv]["title"]
            p.write_bytes(http_get(granules[hv]["data"], auth=True))
            return hv, p

        with ThreadPoolExecutor(self.threads) as ex:
            for (h, v), p in ex.map(download, list(granules)):
                try:
                    part = self._cut(p, h, v, y, m)[region_key]
                finally:
                    p.unlink(missing_ok=True)
                out = np.where(np.isfinite(part), part, out)
        return out


# ---------------------------------------------------------------------------- the source the pipeline calls

class Source:
    """One ``fetch_year(var, region, grid, year)`` for every variable and region, with the per-year cache of the pipeline."""
    name = "earthdata"

    def __init__(self, cache: Path | None, log=print, threads=8, min_obs: int = MIN_CLEAR_OBS, country_deg: float = COUNTRY_DEG):
        self.cache, self.log, self.threads, self.min_obs, self.country_deg = cache, log, threads, min_obs, country_deg
        self.pc = PlanetaryComputer()
        self.work = Path(tempfile.mkdtemp(prefix="modis-cloud-"))
        self.ndvi_tiles = TileNdvi(cache, self.work, threads=min(4, threads))

    def grid(self, region: dict) -> dict:
        return region_grid(region, self.country_deg)

    def _save_twin(self, region: dict, var_key: str, year: int, arr: np.ndarray):
        if self.cache:
            f = self.cache / f"{region['region']}-{VARS[var_key]['suffix']}-{year}.npy"
            f.parent.mkdir(parents=True, exist_ok=True)
            np.save(f, arr.astype(np.float32))

    def fetch_year(self, var: dict, region: dict, grid: dict, year: int) -> np.ndarray:
        country = region["region"] == "mongolia"
        shape = (grid["ny"], grid["nx"])
        if var["collection"] == "lst":
            key = var["band"]
            if country:
                months = [m for m in range(1, 13) if (year, m) >= (START_YEAR, 3)]
                rn, rs = grid["rows"]
                c0, c1 = grid["cols"]
                with ThreadPoolExecutor(min(4, self.threads)) as ex:          # downloads in threads, parsing on this one
                    got = [cmg_lst_parse(b) for b in ex.map(lambda m: cmg_lst_bytes(year, m, grid), months)]
                both = {k: block_mean(np.stack([g[k] if g else np.full((rs - rn, c1 - c0), np.nan) for g in got]), grid["block"])
                        for k in ("Day", "Night")}
            else:
                both = box_lst_year(self.pc, region, grid, year, self.threads)
            twin = "lstn" if key == "Day" else "lstd"
            self._save_twin(region, twin, year, both[VARS[twin]["band"]])
            return both[key]
        if var["collection"] == "ndvi":
            parts = []
            for y, m in season_months(var["months"], year):
                parts.append(cmg_ndvi_month(y, m, grid) if country else self.ndvi_tiles.month(_region_key(region), grid, y, m))
            if any(p is None for p in parts):
                return np.full((1,) + shape, np.nan)
            stack = np.stack(parts)
            season = np.where(np.isfinite(stack).all(axis=0), stack.mean(axis=0), np.nan)
            return (block_mean(season, grid["block"]) if country else season)[None]
        months = season_months(var["months"], year)
        maps = None if country else box_maps(region, grid)
        raw = self.snow_raw(region, grid, year, months, maps)
        if country:                                                   # the rule at 0.05°, then the block mean
            rn, rs = grid["rows"]
            c0, c1 = grid["cols"]
            season = season_from_raw(raw, months, {"ny": rs - rn, "nx": c1 - c0}, None, self.min_obs)
            return block_mean(season, grid["block"])[None]
        return season_from_raw(raw, months, grid, maps, self.min_obs)[None]

    def snow_raw(self, region: dict, grid: dict, year: int, months, maps) -> dict:
        """The monthly snow ingredients of one winter, from the raw cache or freshly read (and then cached)."""
        path = self.cache / "raw" / f"{region['region']}-snow-{year}.npz" if self.cache else None
        if path and path.exists():
            with np.load(path) as z:
                return dict(z)
        raw = {}
        for y, m in months:
            if maps is None:
                raw[month_key(y, m) + "-sum"], raw[month_key(y, m) + "-cnt"] = cmg_snow_month_raw(y, m, grid, self.work, self.threads)
            else:
                for tile, (s, c) in box_snow_month_raw(self.pc, region, y, m, maps, self.threads).items():
                    raw[month_key(y, m, tile) + "-sum"], raw[month_key(y, m, tile) + "-cnt"] = s, c
        if path:
            path.parent.mkdir(parents=True, exist_ok=True)
            np.savez_compressed(path, **raw)
        return raw

    def provenance(self, var: dict, region: dict) -> dict:
        coll = var["collection"]
        if region["region"] == "mongolia":
            name = {"lst": "MOD11C3.061", "ndvi": "MOD13C2.061", "snow": "MOD10C1.061"}[coll]
            access = "NSIDC Earthdata Cloud (HTTPS)" if coll == "snow" else "LP DAAC Earthdata Cloud (OPeNDAP subset)"
            deg = self.country_deg
            f = int(round(deg / CMG_DEG))
            note = (f"{deg:g}° cells (about {deg * 111.32:.0f} km north-south and {deg * 111.32 * 0.68:.1f} km east-west at 47°N), "
                    f"each the mean of the {f} × {f} climate-modelling-grid cells (0.05°) inside it" if f > 1 else
                    "0.05° cells (about 5.6 km north-south and 3.8 km east-west at 47°N), the product's own grid")
            return {"collection": name, "access": access, "group": f"Mongolia MODIS 2000-2025 ({deg:g}°)",
                    "source": f"NASA {name} on the 0.05° climate modelling grid, read from the {access}",
                    "native_res": "0.05° climate modelling grid, binned by the product from the 1 km (LST, NDVI) or 500 m (snow) tiles",
                    "grid_note": note}
        name = {"lst": "MOD11A2.061", "ndvi": "MOD13A3.061", "snow": "MOD10A1.061"}[coll]
        access = "LP DAAC Earthdata Cloud (HTTPS tiles)" if coll == "ndvi" else "Microsoft Planetary Computer mirror of the NASA archive (COG windows)"
        note = ("1 km cells, each the mean of the 500 m pixels whose centres fall inside it" if coll == "snow"
                else "1 km cells, one native pixel each (the pixel holding the cell centre)")
        return {"collection": name, "access": access, "source": f"NASA {name} sinusoidal tiles, read from the {access}",
                "native_res": f"{NATIVE_KM[coll]:g} km (MODIS sinusoidal)", "grid_note": note}


def _region_key(region: dict) -> str:
    return next(k for k, r in REGIONS.items() if r is region or r["region"] == region["region"])
