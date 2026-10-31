"""Earth Engine pixels -> a categorical layer in the existing Trend Detective map.

Experimental relative susceptibility, not ignition probability or operational FWI.
No missing pixels or absent credentials are replaced with sample data.
"""
from datetime import datetime, timedelta, timezone
import math
from pathlib import Path

import numpy as np
from scipy.stats import rankdata

from . import fire
from .geo import load_focus_rings, points_in_rings

SCHEMA = "trend-detective/fire-map/v1"
FACTORS = {"lst_c": 1, "ndmi": -1, "vpd_kpa": 1, "wind_ms": 1,
           "rain_7d_mm": -1, "soil_water": -1}


def classify(values, fuel):
    """Equal-weight percentile ranks on the common valid vegetated footprint.

    Ties get identical mid-ranks, constant factors carry no spatial information.
    Return null-equivalent -1 outside the footprint, never a 'zero-risk' class.
    """
    valid = np.asarray(fuel, bool).copy()
    for name in FACTORS:
        x = np.asarray(values[name], float)
        if x.shape != valid.shape:
            raise ValueError("factor grids must have the same shape")
        valid &= np.isfinite(x) & (x != -9999)
    valid &= (np.abs(values["ndmi"]) <= 1)
    valid &= (values["vpd_kpa"] >= 0) & (values["wind_ms"] >= 0) & (values["rain_7d_mm"] >= 0)
    valid &= (values["soil_water"] >= 0) & (values["soil_water"] <= 1)
    score = np.full(valid.shape, np.nan)
    classes = np.full(valid.shape, -1, dtype=np.int8)
    n = int(valid.sum())
    if n < 2:
        return score, classes
    ranks = [(rankdata(np.asarray(values[k])[valid] * direction, method="average") - 1) / (n - 1)
             for k, direction in FACTORS.items()]
    score[valid] = np.mean(ranks, axis=0)
    classes[valid] = np.minimum(4, np.floor(score[valid] * 5)).astype(np.int8)
    return score, classes


def build(project, bbox, start, end, resolution=100):
    fire.validate(bbox, start, end, 1)
    if not 100 <= resolution <= 1000:
        raise ValueError("display resolution must be 100–1000 metres")
    import ee
    try:
        ee.Initialize(project=project)
    except Exception:
        raise RuntimeError("Earth Engine authentication required; no map was generated. See docs/FIRE_EARTH_ENGINE.md.") from None
    w, s, e, n = bbox
    dlat = resolution / 111320
    dlon = dlat / math.cos(math.radians((s + n) / 2))
    nx, ny = math.ceil((e - w) / dlon), math.ceil((n - s) / dlat)
    if nx * ny > 250000:
        raise ValueError("display exceeds 250,000 cells; use a smaller region or coarser resolution")
    region = ee.Geometry.Rectangle(bbox, "EPSG:4326", False)
    images = fire.collection(ee, region, start, end)
    if not images.size().getInfo():
        raise RuntimeError("No Landsat L2SP scene with 0–2% cloud cover in this region/period")
    raw = ee.Image(images.first())
    metadata = raw.toDictionary(["LANDSAT_PRODUCT_ID", "SPACECRAFT_ID", "CLOUD_COVER", "system:time_start"]).getInfo()
    acquired = datetime.fromtimestamp(metadata["system:time_start"] / 1000, timezone.utc)
    hour = acquired.replace(minute=0, second=0, microsecond=0)
    day = hour.replace(hour=0)
    met = ee.ImageCollection(fire.HOURLY).filterDate(hour.isoformat(), (hour + timedelta(hours=1)).isoformat())
    rain = ee.ImageCollection(fire.DAILY).filterDate((day - timedelta(days=7)).isoformat(), day.isoformat()).select("total_precipitation_sum")
    if not met.size().getInfo() or rain.size().getInfo() != 7:
        raise RuntimeError("Acquisition-hour weather or seven complete days of rain unavailable; no risk map generated")
    weather = ee.Image(met.first())
    t = weather.select("temperature_2m").subtract(273.15)
    td = weather.select("dewpoint_temperature_2m").subtract(273.15)
    def vapor(c):
        return c.multiply(17.27).divide(c.add(237.3)).exp().multiply(.6108)
    fields = fire.prepare_landsat(raw).select(["lst_c", "ndmi"])
    fields = fields.addBands([
        vapor(t).subtract(vapor(td)).max(0).rename("vpd_kpa"),
        weather.select("u_component_of_wind_10m").hypot(weather.select("v_component_of_wind_10m")).rename("wind_ms"),
        weather.select("volumetric_soil_water_layer_1").rename("soil_water"),
        rain.sum().updateMask(rain.count().eq(7)).multiply(1000).rename("rain_7d_mm"),
        ee.ImageCollection("ESA/WorldCover/v200").first().select("Map").rename("landcover")])
    # Explicit output grid, bounded transfer. Native ERA5 support stays ~11 km;
    # nearest-neighbour sampling is not claimed to add meteorological detail.
    pixels = ee.data.computePixels({"expression": fields.clip(region).unmask(-9999),
        "fileFormat": "NUMPY_NDARRAY", "bandIds": list(FACTORS) + ["landcover"],
        "grid": {"dimensions": {"width": nx, "height": ny}, "crsCode": "EPSG:4326",
                 "affineTransform": {"scaleX": dlon, "shearX": 0, "translateX": w,
                                     "shearY": 0, "scaleY": -dlat, "translateY": n}}})
    # Viewer uses row-major south-to-north cells; computePixels returns north first.
    values = {k: np.flipud(pixels[k]).astype(float) for k in FACTORS}
    lon, lat = w + (np.arange(nx) + .5) * dlon, n - (ny - np.arange(ny) - .5) * dlat
    xx, yy = np.meshgrid(lon, lat)
    rings = load_focus_rings(Path(__file__).resolve().parent.parent / "web/data/geo.js")
    country = points_in_rings(xx, yy, rings)
    fuel = np.isin(np.flipud(pixels["landcover"]), [10, 20, 30, 40, 90, 95, 100]) & country
    score, classes = classify(values, fuel)
    if not np.any(classes >= 0):
        raise RuntimeError("No complete vegetated pixels inside Mongolia; no map generated")
    def clean(a):
        return [round(float(x), 4) if np.isfinite(x) and x != -9999 else None for x in a.ravel()]
    return {"schema": SCHEMA, "id": "fire-risk", "kind": "fire-risk", "title": "Fire susceptibility · Earth Engine",
        "group": "Earth Engine", "region": "mongolia", "region_name": "Mongolia", "units": "relative score",
        "period": {"start": acquired.date().isoformat(), "end": acquired.date().isoformat()},
        "grid": {"nx": nx, "ny": ny, "lon": lon.tolist(), "lat": lat.tolist(), "dlon": dlon, "dlat": dlat},
        "classes": classes.ravel().tolist(), "score": [float(x) if np.isfinite(x) else None for x in score.ravel()], "factors": {k: clean(v) for k, v in values.items()},
        "metadata": metadata, "acquired_utc": acquired.isoformat(), "weather_hour_utc": hour.isoformat(),
        "rain_start_utc": (day-timedelta(days=7)).isoformat(), "rain_end_exclusive_utc": day.isoformat(),
        "generated_utc": datetime.now(timezone.utc).isoformat(), "display_resolution_m": resolution,
        "sources": [*fire.LANDSAT, fire.HOURLY, fire.DAILY, "ESA/WorldCover/v200"],
        "method": "relative-percentile-six-factor-v1", "class_edges": [0, .2, .4, .6, .8, 1],
        "native_resolution_m": {"thermal": 100, "reflectance": 30, "weather": 11132, "landcover": 10}}


def publish(result, out):
    """Retain dated snapshots so the unchanged viewer can select exact dates."""
    import json
    from .payload import write_payload
    out = Path(out)
    index_path = out.parent / "fire-map-index.json"
    index = json.loads(index_path.read_text()) if index_path.exists() else {"schema": "trend-detective/fire-map-index/v1", "maps": []}
    if index.get("schema") != "trend-detective/fire-map-index/v1" or not isinstance(index.get("maps"), list):
        raise ValueError("Invalid archive index; existing archive was preserved")
    day = result["period"]["start"]
    key = "fire-risk-" + day
    out.parent.mkdir(parents=True, exist_ok=True)
    write_payload(out.parent / (key + ".js"), key, result)
    write_payload(out, out.stem, result)
    index["maps"] = sorted([r for r in index["maps"] if r["date"] != day] + [{"date": day, "key": key}], key=lambda r: r["date"])
    temp = index_path.with_suffix(".json.tmp")
    temp.write_text(json.dumps(index, indent=2))
    temp.replace(index_path)
