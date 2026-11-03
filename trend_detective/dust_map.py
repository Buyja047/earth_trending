"""Dated MODIS NetCDF observations -> existing viewer and static daily archive."""
from dataclasses import asdict
from datetime import date, datetime, timezone
import json
from pathlib import Path

import numpy as np
import xarray as xr

from .dust import BANDS, METHOD, Settings, classify
from .payload import write_payload

SCHEMA = "trend-detective/dust-map/v1"


def _axis(values, name, low, high):
    a = np.asarray(values, float)
    if a.ndim != 1 or a.size < 2:
        raise ValueError(f"{name} must be a one-dimensional coordinate with at least two centres")
    d = float(a[1] - a[0])
    if (not np.all(np.isfinite(a)) or
            d <= 0 or not np.allclose(np.diff(a), d, rtol=1e-5, atol=1e-8) or
            a[0] - d / 2 < low or a[-1] + d / 2 > high):
        raise ValueError(f"{name} must be increasing regular WGS84 pixel centres (at least two)")
    return a, d


def build(input_path, day, bbox=None, settings=None):
    """One daytime overpass per input; never average spectral bands across passes."""
    date.fromisoformat(day)
    settings = settings or Settings()
    with xr.open_dataset(input_path) as source:
        required = [*BANDS, "cloud_mask", "snow_mask"]
        if any(k not in source for k in required) or any(k not in source.coords for k in ["lon", "lat"]):
            raise ValueError("Missing calibrated MODIS bands/masks; see docs/DUST_MODIS.md")
        acquired = str(source.attrs.get("acquired_utc", ""))
        try:
            stamp = datetime.fromisoformat(acquired.replace("Z", "+00:00"))
            if stamp.tzinfo is None or stamp.astimezone(timezone.utc).date().isoformat() != day:
                raise ValueError()
        except ValueError:
            raise ValueError("acquired_utc must be a timezone-qualified timestamp on the requested UTC day") from None
        provenance = str(source.attrs.get("source", "")).strip()
        resolution = float(source.attrs.get("native_resolution_m", 0))
        if not provenance or not np.isfinite(resolution) or resolution < 1000:
            raise ValueError("source and native_resolution_m >= 1000 are required")
        for k in required:
            if set(source[k].dims) != {"lat", "lon"}:
                raise ValueError(f"{k} must have lat/lon dimensions from one overpass")
            expected = "K" if k.startswith("bt") else "1"
            if source[k].attrs.get("units") != expected:
                raise ValueError(f"{k} requires calibrated units={expected}")
        # Establish geometry before slicing; descending inputs must be normalized upstream.
        _axis(source.lon.values, "lon", -180, 180)
        _axis(source.lat.values, "lat", -90, 90)
        selected = source
        if bbox is not None:
            w, s, e, n = bbox
            if not (-180 <= w < e <= 180 and -90 <= s < n <= 90):
                raise ValueError("Invalid WGS84 bounding box")
            selected = source.sel(lon=slice(w, e), lat=slice(s, n))
        lon, dx = _axis(selected.lon.values, "lon", -180, 180)
        lat, dy = _axis(selected.lat.values, "lat", -90, 90)
        if lon.size * lat.size > 250000:
            raise ValueError("Map exceeds 250,000 cells; subset or aggregate upstream")
        data = {k: selected[k].transpose("lat", "lon").values for k in required}
    classes, factors, threshold = classify(data, data["cloud_mask"], data["snow_mask"], settings)
    # Spherical cell areas, including the latitude dependence; never pixel count * 1 km².
    strip = 6371.0088 ** 2 * np.radians(dx) * (
        np.sin(np.radians(lat + dy/2)) - np.sin(np.radians(lat - dy/2)))
    area = np.broadcast_to(strip[:, None], classes.shape)
    stats = {"observed_km2": float(area[classes >= 0].sum()),
             "land_dust_km2": float(area[classes == 1].sum()),
             "water_dust_km2": float(area[classes == 3].sum()),
             "unclassified_km2": float(area[np.isin(classes, [2, 4])].sum()),
             "missing_km2": float(area[classes < 0].sum()), "total_km2": float(area.sum())}
    def clean(a):
        return [float(x) if np.isfinite(x) else None for x in a.ravel()]
    return {"schema": SCHEMA, "id": "dust-risk", "kind": "dust-risk",
            "title": "Daily yellow dust · MODIS", "region": "mongolia", "group": "Risk zones",
            "region_name": "Selected MODIS footprint", "units": "detection class", "method": METHOD,
            "period": {"start": day, "end": day}, "acquired_utc": acquired,
            "generated_utc": datetime.now(timezone.utc).isoformat(), "source": provenance,
            "native_resolution_m": resolution, "settings": asdict(settings), "idi_threshold": threshold,
            "grid": dict(nx=len(lon), ny=len(lat), lon=lon.tolist(), lat=lat.tolist(), dlon=dx, dlat=dy),
            "classes": classes.ravel().tolist(), "factors": {k: clean(v) for k, v in factors.items()},
            "areas": stats, "water_detection_enabled": settings.water_ndai_min is not None}


def publish(result, out):
    """Publish only the requested actual date, preserving other daily snapshots."""
    out = Path(out)
    index_path = out.parent / "dust-map-index.json"
    index = json.loads(index_path.read_text()) if index_path.exists() else {
        "schema": "trend-detective/dust-map-index/v1", "maps": []}
    if index.get("schema") != "trend-detective/dust-map-index/v1" or not isinstance(index.get("maps"), list):
        raise ValueError("Invalid dust archive index; existing archive preserved")
    day = date.fromisoformat(result["period"]["start"]).isoformat()
    key = "dust-risk-" + day
    out.parent.mkdir(parents=True, exist_ok=True)
    write_payload(out.parent / (key + ".js"), key, result)
    write_payload(out, out.stem, result)
    index["maps"] = sorted([x for x in index["maps"] if x["date"] != day] +
                           [{"date": day, "key": key}], key=lambda x: x["date"])
    temp = index_path.with_suffix(".json.tmp")
    temp.write_text(json.dumps(index, indent=2))
    temp.replace(index_path)
    write_payload(out.parent / "dust-map-index.js", "dust-map-index", index)


def build_day(input_dir, day, bbox=None):
    """Exact-date service adapter: a missing file never falls back to yesterday."""
    day = date.fromisoformat(day).isoformat()
    path = Path(input_dir) / (day + ".nc")
    if not path.is_file():
        raise RuntimeError("No calibrated MODIS observation is available for this day")
    return build(path, day, bbox)
