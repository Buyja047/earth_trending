"""Direct MODIS daily pipeline: discover -> download -> calibrate -> classify.

Classify each native overpass independently, then take the union of observed
dust on a fixed ~1 km working grid. Display reduction never mixes spectral
bands from different times; the representative cell retains its source index.
"""
from dataclasses import asdict
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

from .dust import Settings
from .dust_map import SCHEMA
from .geo import load_focus_rings, points_in_rings
from .modis_source import discover, download, validate_request, ModisAccessError
from .modis_swath import read_swath

PIPELINE = "modis-c61-native-daily-union-v1"
DEFAULT_BBOX = (87.5, 41.5, 120., 52.5)
FACTOR_NAMES = ("idi", "ndai", "ndvi", "ndwi", "ndwi_nir_swir", "btd_20_31", "r47")
ROOT = Path(__file__).resolve().parent.parent
PRIORITY = np.array([0, 3, 6, 2, 6, 1])  # indexed by class+1: dust dominates clear/missing


def xyz(lon, lat):
    lon, lat = np.radians(lon), np.radians(lat)
    return np.column_stack((np.cos(lat)*np.cos(lon), np.cos(lat)*np.sin(lon), np.sin(lat)))


def output_grid(bbox, resolution):
    # Bounded native working grid and integer-factor display reduction.
    if not isinstance(resolution, (int, float)) or not math.isfinite(resolution) or resolution < 1000 or resolution > 20000 or resolution % 1000:
        raise ValueError("MODIS display resolution must be a multiple of 1000 m, between 1000 and 20000 m")
    w, s, e, n = bbox
    factor = int(resolution/1000)
    dy = 1000/111320
    dx = dy/math.cos(math.radians((s+n)/2))
    nx, ny = math.ceil((e-w)/(dx*factor)), math.ceil((n-s)/(dy*factor))
    if nx < 2 or ny < 2:
        raise ValueError("Select a region at least two display cells wide/high, or use finer display resolution")
    if nx*ny > 250000 or nx*ny*factor**2 > 6000000:
        raise ValueError("MODIS region exceeds processing limits; use a smaller region or coarser display")
    # Align the working grid to the display grid. Outside the requested box is excluded below.
    lon = w+(np.arange(nx*factor)+.5)*dx
    lat = s+(np.arange(ny*factor)+.5)*dy
    return lon, lat, dx, dy, nx, ny, factor


def sample_swath(swath, lon, lat, dx, dy):
    """Nearest valid geolocation, limited to 1.5 km; never bridge swath gaps.

    Query all geolocated pixels, including masked ones. Searching only clear
    pixels would incorrectly spread neighbouring clear observations into clouds.
    """
    geo = np.isfinite(swath.lon) & np.isfinite(swath.lat) & (np.abs(swath.lat) <= 90) & (np.abs(swath.lon) <= 180)
    flat = np.flatnonzero(geo.ravel())
    if not flat.size:
        return np.array([], dtype=int), np.array([], dtype=int)
    # Only query the part of the working grid intersecting this swath's bounds.
    columns = np.flatnonzero((lon >= swath.lon[geo].min()-dx) & (lon <= swath.lon[geo].max()+dx))
    rows = np.flatnonzero((lat >= swath.lat[geo].min()-dy) & (lat <= swath.lat[geo].max()+dy))
    if not rows.size or not columns.size:
        return np.array([], dtype=int), np.array([], dtype=int)
    xx, yy = np.meshgrid(lon[columns], lat[rows])
    tree = cKDTree(xyz(swath.lon.ravel()[flat], swath.lat.ravel()[flat]))
    chord = 2*math.sin(1500/(2*6371008.8))
    distance, index = tree.query(xyz(xx.ravel(), yy.ravel()), distance_upper_bound=chord)
    valid = np.isfinite(distance)
    grid_indices = (rows[:, None]*len(lon)+columns[None, :]).ravel()[valid]
    return grid_indices, flat[index[valid]]


def compose(swaths, day, bbox, resolution=5000, settings=None, country_rings=None):
    """Stream native swaths, retaining one representative per working pixel."""
    settings = settings or Settings()
    lon, lat, dx, dy, nx, ny, factor = output_grid(bbox, resolution)
    xx, yy = np.meshgrid(lon, lat)
    w, s, e, n = bbox
    eligible = (xx <= e) & (yy <= n)
    rings = country_rings if country_rings is not None else load_focus_rings(ROOT/"web/data/geo.js")
    eligible &= points_in_rings(xx, yy, rings)
    eligible = eligible.ravel()
    if not eligible.any():
        raise ValueError("Selected region contains no Mongolian land/territory on the working grid")
    count = xx.size
    classes = np.full(count, -1, dtype=np.int8)
    observed = np.full(count, -1, dtype=np.int16)
    fields = {k: np.full(count, np.nan, dtype=np.float64) for k in FACTOR_NAMES}
    sources = []
    for swath in swaths:
        if swath is None:
            continue
        stamp = datetime.fromisoformat(swath.acquired_utc.replace("Z", "+00:00"))
        if stamp.astimezone(timezone.utc).date().isoformat() != day:
            raise ValueError("MODIS swath is not from the requested UTC day")
        source_index = len(sources)
        sources.append({"id": swath.names[0], "files": swath.names,
                        "acquired_utc": swath.acquired_utc, "idi_threshold": swath.threshold})
        dst, src = sample_swath(swath, lon, lat, dx, dy)
        candidate = swath.classes.ravel()[src]
        keep = eligible[dst] & (candidate >= 0) & (PRIORITY[candidate+1] >= PRIORITY[classes[dst]+1])
        dst, src, candidate = dst[keep], src[keep], candidate[keep]
        classes[dst] = candidate
        observed[dst] = source_index
        for key in fields:
            fields[key][dst] = swath.factors[key].ravel()[src]
    if not sources:
        raise ModisAccessError("No matching daytime MODIS pixels intersect this region")
    strip = 6371.0088**2*np.radians(dx)*(np.sin(np.radians(lat+dy/2))-np.sin(np.radians(lat-dy/2)))
    area = np.broadcast_to(strip[:, None], (len(lat), len(lon))).ravel()
    stats = {"total_km2": float(area[eligible].sum()),
             "observed_km2": float(area[eligible & (classes >= 0)].sum()),
             "land_dust_km2": float(area[classes == 1].sum()),
             "water_dust_km2": float(area[classes == 3].sum()),
             "unclassified_km2": float(area[np.isin(classes, [2, 4])].sum()),
             "missing_km2": float(area[eligible & (classes < 0)].sum())}
    # Choose a representative native cell of the highest-priority class in each
    # display cell. Area totals above stay on the finer grid, not the painted cells.
    blocks = np.arange(count).reshape(ny, factor, nx, factor).transpose(0, 2, 1, 3).reshape(nx*ny, factor*factor)
    chosen = blocks[np.arange(nx*ny), np.argmax(PRIORITY[classes[blocks]+1], axis=1)]
    def clean(a):
        return [float(v) if np.isfinite(v) else None for v in a]
    return {"schema": SCHEMA, "id": "dust-risk", "kind": "dust-risk", "method": "modis-idi-otsu-v1",
            "title": "Daily yellow dust · MODIS channels", "region": "mongolia", "group": "Risk zones",
            "region_name": "Mongolia within selected footprint", "units": "detection class",
            "period": {"start": day, "end": day}, "acquired_utc": sources[0]["acquired_utc"],
            "generated_utc": datetime.now(timezone.utc).isoformat(), "source": "NASA LAADS · MODIS Collection 6.1 · native spectral/thermal channels",
            "native_resolution_m": 1000, "display_resolution_m": resolution, "area_grid_resolution_m": 1000,
            "settings": asdict(settings), "idi_threshold": sources[0]["idi_threshold"],
            "aggregation": PIPELINE, "observations": sources, "observation_index": observed[chosen].tolist(),
            "grid": {"nx": nx, "ny": ny, "lon": (w+(np.arange(nx)+.5)*dx*factor).tolist(),
                     "lat": (s+(np.arange(ny)+.5)*dy*factor).tolist(), "dlon": dx*factor, "dlat": dy*factor},
            "classes": classes[chosen].tolist(), "factors": {k: clean(v[chosen]) for k, v in fields.items()},
            "areas": stats, "water_detection_enabled": settings.water_ndai_min is not None}


def build_direct(day, bbox=DEFAULT_BBOX, cache_dir=None, sensor="terra", resolution=5000, settings=None):
    validate_request(day, bbox, sensor)
    output_grid(bbox, resolution)  # reject unbounded requests before network/disk work
    settings = settings or Settings()
    folder = Path(cache_dir) if cache_dir is not None else ROOT/"cache/modis"
    key = hashlib.sha256(json.dumps([PIPELINE, day, list(bbox), sensor, resolution, asdict(settings)], sort_keys=True).encode()).hexdigest()[:24]
    cached = folder/"maps"/(key+".json")
    groups = discover(day, bbox, sensor)
    names = [[g.name for g in group] for group in groups]
    # Recheck discovery so late-arriving granules refresh yesterday's map.
    # Cache hits still avoid large raw downloads, calibration and resampling.
    if cached.exists():
        previous = json.loads(cached.read_text())
        if previous.get("input_granules") == names:
            return previous
    def swaths():
        for group in groups:
            paths = [download(g, folder) for g in group]
            yield read_swath(*paths, bbox, settings)
    result = compose(swaths(), day, bbox, resolution, settings)
    result["discovered_granules"] = len(groups)
    result["request_bbox"] = list(bbox)
    result["sensor"] = sensor
    result["input_granules"] = names
    cached.parent.mkdir(parents=True, exist_ok=True)
    temp = cached.with_suffix(".json.tmp")
    temp.write_text(json.dumps(result, allow_nan=False))
    temp.replace(cached)
    return result
