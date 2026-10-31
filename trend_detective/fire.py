"""Authenticated Earth Engine observations, deliberately without a fire probability score.

Scene metadata is not weather. Landsat surface temperature, ERA5 air temperature,
and Sentinel-5P ozone have distinct units, supports and acquisition times.
"""
from __future__ import annotations

import base64
from datetime import date, datetime, timedelta, timezone
import math

LANDSAT = ("LANDSAT/LC08/C02/T1_L2", "LANDSAT/LC09/C02/T1_L2")
HOURLY = "ECMWF/ERA5_LAND/HOURLY"
DAILY = "ECMWF/ERA5_LAND/DAILY_AGGR"
OZONE = "COPERNICUS/S5P/OFFL/L3_O3"
SCHEMA = "trend-detective/fire-context/v1"


def validate(bbox, start, end, limit):
    if len(bbox) != 4 or not all(math.isfinite(x) for x in bbox):
        raise ValueError("bbox must contain four finite coordinates")
    w, s, e, n = bbox
    if not (-180 <= w < e <= 180 and -60 <= s < n <= 85):
        raise ValueError("bbox must be ordered west/south/east/north, latitude -60..85; split dateline regions")
    # Bound synchronous 30 m reductions. Large regions need a tiled batch workflow.
    area = 6371.0088 ** 2 * math.radians(e - w) * (math.sin(math.radians(n)) - math.sin(math.radians(s)))
    if area > 2500:
        raise ValueError("region exceeds 2,500 km²; use smaller boxes for 30 m analysis")
    try:
        first, last = date.fromisoformat(start), date.fromisoformat(end)
    except ValueError as exc:
        raise ValueError("dates must use YYYY-MM-DD") from exc
    if not (date(2013, 3, 18) <= first < last):
        raise ValueError("start must be on/after 2013-03-18 and before end (exclusive)")
    if (last - first).days > 366:
        raise ValueError("request at most 366 days per report")
    if not 1 <= limit <= 20:
        raise ValueError("limit must be between 1 and 20")


def weather_values(t_k, td_k, u, v, pressure_pa):
    """Magnus RH/VPD over liquid water; meteorological direction FROM, degrees."""
    t, td = t_k - 273.15, td_k - 273.15
    es = .6108 * math.exp(17.27 * t / (t + 237.3))
    ea = .6108 * math.exp(17.27 * td / (td + 237.3))
    speed = math.hypot(u, v)
    return dict(air_temperature_c=t, dewpoint_c=td,
                relative_humidity_pct=max(0., min(100., 100 * ea / es)),
                vapor_pressure_deficit_kpa=max(0., es - ea),
                wind_speed_ms=speed,
                wind_from_degrees=(math.degrees(math.atan2(-u, -v)) % 360) if speed >= .1 else None,
                surface_pressure_hpa=pressure_pa / 100)


def prepare_landsat(image):
    # Bits 0..5: fill, dilated cloud, cirrus, cloud, cloud shadow, snow.
    clear = image.select("QA_PIXEL").bitwiseAnd(63).eq(0).And(image.select("QA_RADSAT").eq(0))
    sr = image.select(["SR_B2", "SR_B3", "SR_B4", "SR_B5", "SR_B6", "SR_B7"]).multiply(.0000275).add(-.2).updateMask(clear)
    def index(a, b, name):
        x, y = sr.select(a), sr.select(b)
        # Do not let normalizedDifference silently mask negative reflectances.
        return x.subtract(y).divide(x.add(y)).updateMask(x.add(y).abs().gt(1e-6)).rename(name)
    lst = image.select("ST_B10").multiply(.00341802).add(149 - 273.15).updateMask(clear).rename("lst_c")
    uncertainty = image.select("ST_QA").multiply(.01).updateMask(clear).rename("lst_uncertainty_k")
    return sr.addBands([lst, uncertainty, index("SR_B5", "SR_B4", "ndvi"),
                        index("SR_B5", "SR_B6", "ndmi"), index("SR_B5", "SR_B7", "nbr")])


def collection(ee, region, start, end):
    images = ee.ImageCollection(LANDSAT[0]).merge(ee.ImageCollection(LANDSAT[1]))
    return (images.filterBounds(region).filterDate(start, end)
            .filter(ee.Filter.gte("CLOUD_COVER", 0))  # -1 means unknown, not clear
            .filter(ee.Filter.lte("CLOUD_COVER", 2))
            .filter(ee.Filter.eq("PROCESSING_LEVEL", "L2SP"))
            .sort("system:time_start", False))


def mean(ee, image, region, scale):
    return image.reduceRegion(reducer=ee.Reducer.mean(), geometry=region, scale=scale,
                              maxPixels=5e7, tileScale=4).getInfo()


def weather(ee, region, acquired):
    hour = acquired.replace(minute=0, second=0, microsecond=0)
    hourly = ee.ImageCollection(HOURLY).filterDate(hour.isoformat(), (hour + timedelta(hours=1)).isoformat())
    result = {"dataset": HOURLY, "nominal_scale_m": 11132, "requested_hour_utc": hour.isoformat(),
              "status": "unavailable", "values": None}
    if hourly.size().getInfo():
        bands = ["temperature_2m", "dewpoint_temperature_2m", "u_component_of_wind_10m",
                 "v_component_of_wind_10m", "surface_pressure", "volumetric_soil_water_layer_1"]
        image = ee.Image(hourly.first())
        values = mean(ee, image.select(bands), region, 11132)
        if all(values.get(b) is not None for b in bands):
            result.update(status="available", values=weather_values(*(values[b] for b in bands[:5])))
            result["values"]["soil_water_0_7cm_m3_m3"] = values[bands[5]]
            result["actual_time_utc"] = datetime.fromtimestamp(image.get("system:time_start").getInfo()/1000, timezone.utc).isoformat()
    day = acquired.replace(hour=0, minute=0, second=0, microsecond=0)
    previous = day - timedelta(days=7)
    rain = ee.ImageCollection(DAILY).filterDate(previous.isoformat(), day.isoformat()).select("total_precipitation_sum")
    count = rain.size().getInfo()
    result["rain_7d"] = {"dataset": DAILY, "start_inclusive": previous.isoformat(), "end_exclusive": day.isoformat(),
                         "days_available": count, "mm": None}
    if count == 7:
        # Never turn missing daily pixels into an apparent complete 7-day total.
        total = rain.sum().updateMask(rain.count().eq(7)).multiply(1000)
        result["rain_7d"]["mm"] = mean(ee, total, region, 11132).get("total_precipitation_sum")
    return result


def ozone_context(ee, region, acquired):
    day = acquired.replace(hour=0, minute=0, second=0, microsecond=0)
    images = ee.ImageCollection(OZONE).filterBounds(region).filterDate(day.isoformat(), (day + timedelta(days=1)).isoformat())
    result = {"dataset": OZONE, "day_utc": day.date().isoformat(), "image_count": images.size().getInfo(),
              "column_mol_m2": None, "column_du": None, "role": "atmospheric_context_only"}
    if result["image_count"]:
        val = mean(ee, images.select("O3_column_number_density").mean(), region, 1113.2).get("O3_column_number_density")
        result["column_mol_m2"] = val
        result["column_du"] = val / .00044615 if val is not None else None
    return result


def previews(image, region):
    import requests
    styles = {"rgb": {"bands": ["SR_B4", "SR_B3", "SR_B2"], "min": 0, "max": .3},
              "lst_c": {"bands": ["lst_c"], "min": -10, "max": 50, "palette": ["2455a4", "f4e9ad", "c32622"]},
              "ndmi": {"bands": ["ndmi"], "min": -.5, "max": .5, "palette": ["a45c25", "f4e9ad", "167b58"]}}
    result = {}
    for name, style in styles.items():
        # Download temporary URLs immediately. Tokens/URLs are never written to a report.
        url = image.getThumbURL(dict(style, region=region, dimensions=512, format="png"))
        try:
            response = requests.get(url, timeout=120)
            response.raise_for_status()
            if not response.content.startswith(b"\x89PNG\r\n\x1a\n"):
                raise RuntimeError("Earth Engine did not return a PNG preview")
        except requests.RequestException:
            raise RuntimeError("Preview download failed; check Earth Engine access or retry with --no-previews") from None
        result[name] = "data:image/png;base64," + base64.b64encode(response.content).decode("ascii")
    return result


def run(project, bbox, start, end, limit=3, include_previews=True):
    validate(bbox, start, end, limit)
    try:
        import ee
    except ImportError:
        raise RuntimeError("Install requirements-earthengine.txt first") from None
    try:
        # Uses existing supported credentials; never launches an interactive login implicitly.
        ee.Initialize(project=project)
    except Exception:
        raise RuntimeError("Earth Engine initialization failed. Use a registered project with the API enabled and an authorized account; see docs/FIRE_EARTH_ENGINE.md. No credentials were changed.") from None
    region = ee.Geometry.Rectangle(bbox, proj="EPSG:4326", geodesic=False)
    scenes = collection(ee, region, start, end)
    count = scenes.size().getInfo()
    report = {"schema": SCHEMA, "created_utc": datetime.now(timezone.utc).isoformat(),
              "bbox": bbox, "start_inclusive": start, "end_exclusive": end,
              "cloud_cover_pct": [0, 2], "matched_scene_count": count,
              "scene_limit": limit, "scenes": [],
              "attribution": ["Landsat imagery courtesy of the U.S. Geological Survey.",
                              "Contains modified Copernicus Climate Change Service Information; see acquisition years. The European Commission and ECMWF are not responsible for use made of this information.",
                              "Contains modified Copernicus Sentinel data; see acquisition years."],
              "notes": ["Observations, not a calibrated fire forecast or ignition probability.",
                        "Cloud cover is whole-scene metadata; QA masks local clouds, shadows, snow and saturated pixels.",
                        "Landsat thermal measurements have ~100 m native resolution, resampled to 30 m; air weather is ~11 km.",
                        "Weather RH/VPD and wind direction derive from ROI mean inputs, not means of per-pixel derived values.",
                        "No missing observation is replaced by zero or by an older observation.",
                        "Ozone columns do not measure ozone thinning or surface ozone; pressure is contextual, not an ignition score."]}
    selected = scenes.toList(min(count, limit)) if count else None
    keys = ["LANDSAT_PRODUCT_ID", "SPACECRAFT_ID", "CLOUD_COVER", "CLOUD_COVER_LAND", "WRS_PATH", "WRS_ROW", "PROCESSING_LEVEL", "system:time_start", "SUN_ELEVATION"]
    for i in range(min(count, limit)):
        raw = ee.Image(selected.get(i))
        metadata = raw.toDictionary(keys).getInfo()
        acquired = datetime.fromtimestamp(metadata["system:time_start"]/1000, timezone.utc)
        image = prepare_landsat(raw)
        metrics = mean(ee, image.select(["lst_c", "lst_uncertainty_k", "ndvi", "ndmi", "nbr"]), region, 30)
        # Pixel-area fraction over the ENTIRE requested ROI, including outside scene footprints.
        coverage = {}
        for band in ("lst_c", "ndmi"):
            valid_area = ee.Image.pixelArea().updateMask(image.select(band).mask()).reduceRegion(
                reducer=ee.Reducer.sum(), geometry=region, scale=30, maxPixels=5e7, tileScale=4).get("area")
            area = ee.Number(ee.Algorithms.If(valid_area, valid_area, 0)).divide(region.area(1)).multiply(100).getInfo()
            coverage[band + "_valid_roi_pct"] = min(100., max(0., area))
        entry = {"metadata": metadata, "acquired_utc": acquired.isoformat(), "surface_means": metrics,
                 "coverage": coverage, "weather": weather(ee, region, acquired),
                 "ozone": ozone_context(ee, region, acquired),
                 "previews": previews(image, region) if include_previews else {}}
        report["scenes"].append(entry)
    return report
