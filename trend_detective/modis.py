"""MODIS trend scenes at 1 km and 5 km through Google Earth Engine.

MERRA-2 cells are about 50 km. The only NASA records long enough for finer trend maps are
MODIS Terra (2000-): land surface temperature (MOD11A2, 1 km, 8-day), vegetation greenness
(MOD13A3, 1 km, monthly) and snow cover (MOD10A1, 500 m, daily). These are different
quantities from the reanalysis (surface not air temperature, clear-sky only, 26 instead of
45 years), so they are separate scenes, not a sharper version of the MERRA-2 ones. Nothing
is interpolated: a 5 km cell is the mean of the native pixels inside it and a 1 km cell is
one pixel. Months without enough clear observations stay missing, and the existing rule then
excludes the cell instead of gap-filling it.

Pixels come through ``ee.data.computePixels`` on an explicit EPSG:4326 grid, one year per
request (48 MB limit), cached on disk so an interrupted run resumes where it stopped.
"""

from __future__ import annotations

import calendar
import math
import time
from pathlib import Path

import numpy as np

from . import catalog, scenes, stats
from .geo import load_focus_rings, points_in_rings
from .payload import read_payload, write_payload

KM_PER_DEG = 111.32
MAX_REQUEST_BYTES = 48 * 1024 * 1024
MISSING = -9999.0
COLLECTIONS = {"lst": "MODIS/061/MOD11A2", "ndvi": "MODIS/061/MOD13A3", "snow": "MODIS/061/MOD10A1"}
NATIVE_KM = {"lst": 1.0, "ndvi": 1.0, "snow": 0.5}
NDSI_SNOW = 40            # NDSI_Snow_Cover >= 40 counts the day as snow-covered
MIN_CLEAR_OBS = 3         # a month's snow-day count needs at least this many clear-sky observations
MIN_COMPOSITES = 2        # a month's LST mean needs at least two valid 8-day composites
START_YEAR, END_YEAR = 2000, 2025
# Terra's last inclination manoeuvre was on 27 February 2020; its 10:30 equator crossing has
# drifted earlier since (10:15 by autumn 2022). A gradual change, tested here as a step.
TERRA_DRIFT = "2020-03"

VARS = {
    "lstd": {
        "suffix": "lst-day", "collection": "lst", "band": "Day", "sampling": "monthly", "units": "C",
        "title": "Surface temperature, day (MODIS)",
        "long_name": "Daytime land surface temperature, clear sky",
        "definition": "Monthly mean of the MOD11A2 8-day composites (Terra, ~10:30 local time) whose "
                      "start date falls in the month; composites with mandatory QA > 1 or LST error > 2 K "
                      "are dropped; a month needs at least two valid composites. Skin temperature of the "
                      "surface under clear sky, not air temperature.",
    },
    "lstn": {
        "suffix": "lst-night", "collection": "lst", "band": "Night", "sampling": "monthly", "units": "C",
        "title": "Surface temperature, night (MODIS)",
        "long_name": "Night-time land surface temperature, clear sky",
        "definition": "As the daytime scene, from the ~22:30 local time overpass.",
    },
    "ndvi": {
        "suffix": "ndvi", "collection": "ndvi", "sampling": "season", "months": (5, 9), "reduce": "mean",
        "units": "dimensionless", "title": "Greenness May-Sep (NDVI, MODIS)",
        "long_name": "Growing-season NDVI, May-September mean",
        "definition": "Mean of the five MOD13A3 monthly NDVI values May-September (SummaryQA good or "
                      "marginal only); a year with any of the five months missing is left empty. One value "
                      "per year.",
    },
    "snowdays": {
        "suffix": "snowdays", "collection": "snow", "sampling": "season", "months": (11, 3), "reduce": "sum",
        "units": "days", "title": "Snow-covered days Nov-Mar (MODIS)",
        "long_name": "Snow-covered days, November-March",
        "definition": "Days with MOD10A1 NDSI_Snow_Cover >= 40 among the clear-sky days of each month, "
                      "scaled to the month's length; a month needs at least three clear-sky observations. "
                      "The five months are summed and labelled by the year of March. One value per year.",
    },
}

REGIONS = {
    "country": {"region": "mongolia", "name": "Mongolia", "km": 5, "bbox": (87.5, 41.5, 120.0, 52.5),
                "group": "Mongolia MODIS 2000-2025 (5 km)", "aggregates": ["focus"]},
    "ub": {"region": "mn-ub", "name": "Ulaanbaatar, 160 km box", "km": 1, "centre": (106.883, 47.908), "size_km": 160,
           "group": "Ulaanbaatar MODIS 2000-2025 (1 km)", "aggregates": ["box"]},
    "gobi": {"region": "mn-gobi", "name": "South Gobi mines, 160 km box", "km": 1, "centre": (106.2, 43.4), "size_km": 160,
             "group": "South Gobi MODIS 2000-2025 (1 km)", "aggregates": ["box"]},
    "khovsgol": {"region": "mn-khovsgol", "name": "Khövsgöl, 160 km box", "km": 1, "centre": (100.4, 50.3), "size_km": 160,
                 "group": "Khövsgöl MODIS 2000-2025 (1 km)", "aggregates": ["box"]},
}


# ---------------------------------------------------------------------------- grids and seasons

def bbox_of(spec: dict) -> tuple[float, float, float, float]:
    if "bbox" in spec:
        return tuple(spec["bbox"])
    lon, lat = spec["centre"]
    half = spec["size_km"] / 2
    dlat = half / KM_PER_DEG
    dlon = dlat / math.cos(math.radians(lat))
    return (lon - dlon, lat - dlat, lon + dlon, lat + dlat)


def grid_for(bbox, km: float) -> dict:
    """Regular lon/lat grid of ``km`` cells inside ``bbox``, centres south to north and west to east."""
    w, s, e, n = bbox
    dlat = km / KM_PER_DEG
    dlon = dlat / math.cos(math.radians((s + n) / 2))
    ny, nx = int(math.floor((n - s) / dlat)), int(math.floor((e - w) / dlon))
    if ny < 2 or nx < 2:
        raise ValueError("box too small for this cell size")
    lat = s + (np.arange(ny) + 0.5) * dlat
    lon = w + (np.arange(nx) + 0.5) * dlon
    return {"lat": lat, "lon": lon, "dlat": dlat, "dlon": dlon, "ny": ny, "nx": nx,
            "west": w, "north": s + ny * dlat}


def season_months(months: tuple[int, int], year: int) -> list[tuple[int, int]]:
    """(year, month) pairs of a season labelled ``year``; one over New Year ends in that year."""
    m0, m1 = months
    seq = [((m - 1) % 12) + 1 for m in range(m0, m0 + ((m1 - m0) % 12) + 1)]
    out, y = [], year - 1 if m0 > m1 else year
    for k, m in enumerate(seq):
        if k and m == 1:
            y += 1
        out.append((y, m))
    return out


def years_for(var: dict, start=START_YEAR, end=END_YEAR) -> list[int]:
    if var["sampling"] == "season" and var["months"][0] > var["months"][1]:
        return list(range(start + 1, end + 1))   # the first winter needs the previous November
    return list(range(start, end + 1))


def months_for(start=START_YEAR, end=END_YEAR) -> list[tuple[int, int]]:
    out = [(y, m) for y in range(start, end + 1) for m in range(1, 13)]
    return [ym for ym in out if ym >= (START_YEAR, 3)]   # MOD11A2 and MOD13A3 begin in February 2000


def request_bytes(grid: dict, bands: int) -> int:
    return grid["nx"] * grid["ny"] * bands * 4


# ---------------------------------------------------------------------------- Earth Engine images

def month_image(ee, var: dict, year: int, month: int):
    """One masked band for one month: LST mean (°C), NDVI, or snow-covered days."""
    days = calendar.monthrange(year, month)[1]
    t0, t1 = f"{year}-{month:02d}-01", (f"{year + 1}-01-01" if month == 12 else f"{year}-{month + 1:02d}-01")
    if var["collection"] == "lst":
        band = var["band"]

        def prep(img):
            lst = img.select(f"LST_{band}_1km").multiply(0.02).subtract(273.15)
            qc = img.select(f"QC_{band}")
            good = qc.bitwiseAnd(3).lte(1).And(qc.rightShift(6).bitwiseAnd(3).lte(1))
            return lst.updateMask(good).rename("v")

        col = ee.ImageCollection(COLLECTIONS["lst"]).filterDate(t0, t1).map(prep)
        return col.mean().updateMask(col.count().gte(MIN_COMPOSITES)).rename("v")
    if var["collection"] == "ndvi":
        img = ee.Image(ee.ImageCollection(COLLECTIONS["ndvi"]).filterDate(t0, t1).first())
        return img.select("NDVI").multiply(1e-4).updateMask(img.select("SummaryQA").lte(1)).rename("v")
    col = ee.ImageCollection(COLLECTIONS["snow"]).filterDate(t0, t1).select("NDSI_Snow_Cover")
    snow = col.map(lambda i: i.gte(NDSI_SNOW))
    count = snow.count()
    return snow.sum().divide(count).multiply(days).updateMask(count.gte(MIN_CLEAR_OBS)).rename("v")


def year_image(ee, var: dict, year: int):
    """Bands for one year: m01..m12 for monthly variables, one season band otherwise."""
    if var["sampling"] == "monthly":
        imgs = [month_image(ee, var, year, m).rename(f"m{m:02d}") for m in range(1, 13) if (year, m) >= (START_YEAR, 3)]
        return ee.Image.cat(imgs)
    parts = [month_image(ee, var, y, m) for y, m in season_months(var["months"], year)]
    col = ee.ImageCollection(parts)
    total = col.sum() if var["reduce"] == "sum" else col.mean()
    return total.updateMask(col.count().eq(len(parts))).rename("s")


def native_projection(ee, var: dict):
    key = var["collection"]
    band = {"lst": f"LST_{var.get('band', 'Day')}_1km", "ndvi": "NDVI", "snow": "NDSI_Snow_Cover"}[key]
    return ee.ImageCollection(COLLECTIONS[key]).first().select(band).projection()


def fetch_year(ee, var: dict, region: dict, grid: dict, year: int) -> np.ndarray:
    """(bands, ny, nx) float array for one year, south-to-north rows, NaN where missing."""
    img = year_image(ee, var, year).setDefaultProjection(native_projection(ee, var))
    if region["km"] > NATIVE_KM[var["collection"]] * 1.5:
        img = img.reduceResolution(ee.Reducer.mean(), True, 4096)   # a coarse cell is the mean of its pixels
    nbands = 12 if var["sampling"] == "monthly" else 1
    if year == START_YEAR and var["sampling"] == "monthly":
        nbands = 10
    if request_bytes(grid, nbands) > MAX_REQUEST_BYTES:
        raise ValueError(f"{region['name']} at {region['km']} km needs {request_bytes(grid, nbands) / 2**20:.0f} MB per "
                         "year; use a smaller box or a coarser cell")
    names = img.bandNames().getInfo()
    pixels = ee.data.computePixels({
        "expression": img.unmask(MISSING, False), "fileFormat": "NUMPY_NDARRAY", "bandIds": names,
        "grid": {"dimensions": {"width": grid["nx"], "height": grid["ny"]}, "crsCode": "EPSG:4326",
                 "affineTransform": {"scaleX": grid["dlon"], "shearX": 0, "translateX": grid["west"],
                                     "shearY": 0, "scaleY": -grid["dlat"], "translateY": grid["north"]}}})
    out = np.stack([np.flipud(np.asarray(pixels[b], dtype=float)) for b in names])   # north-first -> south-first
    out[out <= MISSING + 1] = np.nan
    return out


def fetch(ee, var: dict, region: dict, grid: dict, years: list[int], cache: Path | None, log=print, fetch_year_fn=None) -> np.ndarray:
    """All years, from the cache where present. Returns (time, ny, nx). ``fetch_year_fn(var, region, grid, year)``
    replaces the Earth Engine request (the Earthdata source in ``modis_cloud``)."""
    blocks = []
    for y in years:
        f = cache / f"{region['region']}-{var['suffix']}-{y}.npy" if cache else None
        if f and f.exists():
            arr = np.load(f)
        else:
            t0 = time.time()
            arr = fetch_year_fn(var, region, grid, y) if fetch_year_fn else fetch_year(ee, var, region, grid, y)
            if f:
                f.parent.mkdir(parents=True, exist_ok=True)
                np.save(f, arr.astype(np.float32))
            log(f"  {region['region']} {var['suffix']} {y}: {arr.shape[0]} band(s), "
                f"{100 * np.isfinite(arr).mean():.0f} % of cells observed, {time.time() - t0:.0f} s")
        blocks.append(arr)
    return np.concatenate(blocks, axis=0)


# ---------------------------------------------------------------------------- scenes

def times_for(var: dict, years: list[int]) -> np.ndarray:
    if var["sampling"] == "monthly":
        return np.array([np.datetime64(f"{y}-{m:02d}", "M") for y in years for m in range(1, 13) if (y, m) >= (START_YEAR, 3)])
    label = 7 if var["months"][0] <= var["months"][1] else 2   # July for a summer season, February for a winter
    return np.array([np.datetime64(f"{y}-{label:02d}", "M") for y in years])


def trim_trailing_empty(values: np.ndarray, times: np.ndarray, monthly: bool):
    """Drop months (whole years when monthly) after the last one with any observation."""
    has = np.isfinite(values).any(axis=(1, 2))
    if not has.any():
        raise RuntimeError("no observations at all; check the Earth Engine project and the region")
    last = int(np.max(np.nonzero(has)[0]))
    if not monthly:
        return values[:last + 1], times[:last + 1]
    t = np.asarray(times, "datetime64[M]")
    years = t.astype("datetime64[Y]").astype(int) + 1970
    last_month = int(t[last].astype(int) % 12) + 1
    last_year = int(years[last]) - (0 if last_month == 12 else 1)     # only years that run through December
    keep = int(np.sum(years <= last_year))
    if keep == 0:
        raise RuntimeError("fewer than one complete year observed")
    return values[:keep], times[:keep]


def scene_id(region_key: str, var_key: str) -> str:
    return f"{'mn' if region_key == 'country' else region_key}-modis-{VARS[var_key]['suffix']}"


def build_scene(var_key: str, region_key: str, values: np.ndarray, times: np.ndarray, grid: dict,
                out_dir: Path, focus_rings, provenance: dict | None = None) -> dict:
    """``provenance`` (collection, access, source, native_res, grid_note) describes a source other than Earth Engine."""
    var, region = VARS[var_key], REGIONS[region_key]
    lat, lon = grid["lat"], grid["lon"]
    lon2d, lat2d = np.meshgrid(lon, lat)
    inside = points_in_rings(lon2d, lat2d, focus_rings)
    values = np.array(values, dtype=float)
    if region["region"] == "mongolia":
        values[:, ~inside] = np.nan
    scenes.REGIONS.setdefault(region["region"], {"name": region["name"], "bbox": bbox_of(region), "wrap": False})
    prod = catalog.PRODUCTS["modis"]
    var_name = {"lstd": "LST_Day_1km", "lstn": "LST_Night_1km", "ndvi": "NDVI", "snowdays": "SNOWDAYS"}[var_key]
    breaks, tnotes = scenes._breaks("modis", var_name)
    t_dec = stats.decimal_year(times)
    breaks = [(tb, label) for tb, label in breaks if t_dec[0] + 1 < tb < t_dec[-1] - 1]   # a step needs data on both sides
    spec_meta = {
        "id": scene_id(region_key, var_key), "title": var["title"], "group": (provenance or {}).get("group", region["group"]), "case": None,
        "product": "modis", "product_name": prod["name"], "kind": prod["kind"], "source": prod["source"],
        "var": var_name, "long_name": var["long_name"], "units": var["units"], "definition": var["definition"],
        "region": region["region"], "region_name": region["name"], "notes": catalog.notes_for("modis", var_name),
        "native_res": f"{NATIVE_KM[var['collection']]:g} km (MODIS sinusoidal)",
        "grid_note": (f"{region['km']} km cells, each the mean of the native pixels inside it"
                      if region["km"] > NATIVE_KM[var["collection"]] * 1.5 else f"{region['km']} km cells, one native pixel each"),
        "series_kind": "annual", "focus": bool(inside.any()) and region["region"] != "mongolia",
        "modis": {"collection": COLLECTIONS[var["collection"]], "access": "Google Earth Engine", "sampling": var["sampling"],
                  "months": list(var.get("months", (1, 12))), "ndsi_snow": NDSI_SNOW if var_key == "snowdays" else None},
    }
    if provenance:
        spec_meta.update({k: provenance[k] for k in ("source", "native_res", "grid_note") if k in provenance})
        spec_meta["modis"].update({k: provenance[k] for k in ("collection", "access") if k in provenance})
    aggregates = list(region["aggregates"])
    if region["region"] != "mongolia" and inside.any() and not inside.all():
        aggregates.append("focus_part")
    return scenes.write_scene(spec_meta, values, times, lat, lon, out_dir, focus_rings, breaks, tnotes, aggregates)


def publish_index(out_dir: Path, built: list[dict]) -> dict:
    """Add or replace the scene entries in web/data/index.js, keeping everything else."""
    path = out_dir / "index.js"
    idx = read_payload(path) if path.exists() else {"scenes": [], "comparisons": [], "has_screen": False}
    keys = ("id", "title", "group", "case", "product", "product_name", "kind", "var",
            "long_name", "units", "region", "region_name", "counts", "period")
    entries = {e["id"]: e for e in idx.get("scenes", [])}
    for sc in built:
        entries[sc["id"]] = {k: sc.get(k) for k in keys}
    idx["scenes"] = list(entries.values())
    idx["products"] = catalog.PRODUCTS
    idx["transitions"] = catalog.TRANSITIONS
    write_payload(path, "index", idx)
    return idx


def run(project: str | None, regions: list[str], var_keys: list[str], out_dir: Path, geo_path: Path, cache: Path | None,
        start=START_YEAR, end=END_YEAR, log=print, ee_module=None, source="earthengine", country_deg=None) -> list[dict]:
    """Build the scenes. ``source`` is "earthengine" (needs a registered project) or "earthdata" (the archives
    themselves through NASA Earthdata Cloud and the Planetary Computer mirror; see modis_cloud)."""
    cloud = None
    ee = ee_module
    if source == "earthdata":
        from . import modis_cloud
        cloud = modis_cloud.Source(cache, log, country_deg=country_deg or modis_cloud.COUNTRY_DEG)
    elif source != "earthengine":
        raise ValueError(f"unknown source {source!r}; use earthengine or earthdata")
    elif ee is None:
        import ee as ee_module  # noqa: F811
        ee = ee_module
        try:
            ee.Initialize(project=project)
        except Exception:
            raise RuntimeError("Earth Engine authentication required; no scene was generated. See docs/MODIS_TRENDS.md.") from None
    focus = load_focus_rings(geo_path)
    built = []
    for region_key in regions:
        region = REGIONS[region_key]
        grid = cloud.grid(region) if cloud else grid_for(bbox_of(region), region["km"])
        log(f"{region['name']}: {grid['nx']} x {grid['ny']} cells of " + (f"{grid['dlat']:g}° (CMG)" if cloud and region["region"] == "mongolia" else f"{region['km']} km"))
        for var_key in var_keys:
            var = VARS[var_key]
            years = years_for(var, start, end)
            values = fetch(ee, var, region, grid, years, cache, log, fetch_year_fn=cloud.fetch_year if cloud else None)
            times = times_for(var, years)
            values, times = trim_trailing_empty(values, times, var["sampling"] == "monthly")
            t0 = time.time()
            sc = build_scene(var_key, region_key, values, times, grid, out_dir, focus,
                             provenance=cloud.provenance(var, region) if cloud else None)
            built.append(sc)
            log(f"  wrote {sc['id']}: {sc['counts']} in {time.time() - t0:.0f} s")
    publish_index(out_dir, built)
    return built
