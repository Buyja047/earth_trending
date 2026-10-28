"""Daily snow, rain and wind hazard indices from MERRA-2 (NASA POWER daily store).

Dust from open-pit mines, tailings, stockpiles and unpaved haul roads needs bare,
dry ground and a strong wind. Snow cover and a wet surface switch it off:

* US EPA AP-42 section 13.2.2 (11/06) treats a day with at least 0.254 mm (0.01 in)
  of precipitation as one without road dust, so annual emissions scale with
  (365 - P) / 365, P being the number of such days.
* AP-42 section 13.2.5 (11/06) finds wind erosion of mine surfaces (overburden,
  coal piles) only above threshold winds of 10-27 m/s at 10 m in gusts.
* Snow cover raises the threshold wind for dust outbreaks in Mongolia
  (Kurosaki and Mikami 2004, 2005).

A **dust-prone day** here is a day on which the cell is not mostly snow-covered
(MERRA-2 FRSNO < 0.3, see below), less than 0.254 mm of precipitation falls and the
daily maximum (of hourly) 10 m wind reaches 6, 8 or 10 m/s. Snow depth (SNODP)
is not used: in the POWER store it sits at 17.33 cm through whole Gobi winters while
FRSNO says 1-20 % of the cell is covered, so it is a depth over the snow-covered
part, not over the cell. FRSNO in turn reads low: against MODIS Terra monthly snow
cover (MOD10CM) over 186,092 Mongolian cell-months (Nov-Apr 2001-2025) it averages
25 % where MODIS sees 45 % (r = 0.80), and the fit MODIS = 1.10 FRSNO + 17.5 puts
MODIS's "half covered" at FRSNO = 0.30, the threshold used here
(scripts/check_snow_modis.py, docs/snow_check_modis.json). MERRA-2 cell winds are
hourly means over ~50 km, smoother than the gusts AP-42 uses, so the wind
thresholds are a sensitivity range, not a site emission model.
For floods, the ETCCDI indices R10mm (days with >= 10 mm) and Rx1day (largest
daily total) describe heavy rain. Every index is counted per month, so the
existing trend battery, months filter and FDR apply to it unchanged.

The store (``power_merra2_daily_temporal_utc.zarr``) is chunked (5844 days,
15 x 15 cells); the Mongolia box needs 45 chunks per variable. Monthly indices
are cached as one NetCDF so a rebuild reads S3 once.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
import xarray as xr

from . import power

DAILY_STORE = "merra2/temporal/power_merra2_daily_temporal_utc.zarr"
SNOW_FRAC = 0.3         # MERRA-2 snow-cover fraction matching MODIS's 50 % (scripts/check_snow_modis.py)
WET_MM = 0.254          # AP-42 13.2.2: a day with >= 0.254 mm precipitation has no road dust
HEAVY_MM = 10.0         # ETCCDI R10mm
WIND_THRESHOLDS = (6.0, 8.0, 10.0)  # daily maximum of hourly 10 m wind, m/s
DEFAULT_CACHE = power.DEFAULT_CACHE

# index: (title, units, definition, MERRA-2 variables it is built from)
INDICES = {
    "DUSTDAYS6": ("Dust-prone days (wind >= 6 m/s)", "days",
                  "days with MERRA-2 snow cover < 0.3 (MODIS ~50 %), precipitation < 0.254 mm and daily max 10 m wind >= 6 m/s",
                  ("FRSNO", "PRECTOTCORR", "WS10M_MAX")),
    "DUSTDAYS8": ("Dust-prone days (wind >= 8 m/s)", "days",
                  "days with MERRA-2 snow cover < 0.3 (MODIS ~50 %), precipitation < 0.254 mm and daily max 10 m wind >= 8 m/s",
                  ("FRSNO", "PRECTOTCORR", "WS10M_MAX")),
    "DUSTDAYS10": ("Dust-prone days (wind >= 10 m/s)", "days",
                   "days with MERRA-2 snow cover < 0.3 (MODIS ~50 %), precipitation < 0.254 mm and daily max 10 m wind >= 10 m/s",
                   ("FRSNO", "PRECTOTCORR", "WS10M_MAX")),
    "SNOWDAYS": ("Snow-covered days", "days", "days with MERRA-2 snow cover >= 0.3, which matches MODIS's 50 %",
                 ("FRSNO",)),
    "WETDAYS": ("Wet days (>= 0.254 mm)", "days",
                "days with precipitation >= 0.254 mm (AP-42 13.2.2 'wet' day)", ("PRECTOTCORR",)),
    "WINDYDAYS8": ("Windy days (max wind >= 8 m/s)", "days", "days with daily max 10 m wind >= 8 m/s",
                   ("WS10M_MAX",)),
    "R10MM": ("Heavy-rain days (>= 10 mm)", "days", "days with precipitation >= 10 mm (ETCCDI R10mm)",
              ("PRECTOTCORR",)),
    "RX1DAY": ("Wettest day of the month", "mm", "largest daily precipitation in the month (ETCCDI Rx1day)",
               ("PRECTOTCORR",)),
}


def daily_flags(frsno, prec, wsmax, thresholds=WIND_THRESHOLDS) -> dict:
    """Boolean day flags on matching (time, ...) arrays; NaN inputs give False."""
    snow = frsno >= SNOW_FRAC
    wet = prec >= WET_MM
    open_dry = (frsno < SNOW_FRAC) & (prec < WET_MM)
    out = {"SNOWDAYS": snow, "WETDAYS": wet, "R10MM": prec >= HEAVY_MM, "WINDYDAYS8": wsmax >= 8.0}
    for u in thresholds:
        out[f"DUSTDAYS{u:g}"] = open_dry & (wsmax >= u)
    return out


def month_index(days) -> tuple[np.ndarray, np.ndarray]:
    """Calendar months covered by the days, and each day's position among them."""
    m = np.asarray(days, dtype="datetime64[M]")
    months = np.unique(m)
    return months, np.searchsorted(months, m)


def monthly_counts(flag, pos, n_months) -> np.ndarray:
    """Sum a (time, ...) boolean array into (month, ...) counts."""
    out = np.zeros((n_months,) + flag.shape[1:], dtype="float32")
    np.add.at(out, pos, flag.astype("float32"))
    return out


def monthly_max(x, pos, n_months) -> np.ndarray:
    out = np.full((n_months,) + x.shape[1:], -np.inf, dtype="float32")
    np.maximum.at(out, pos, np.where(np.isfinite(x), x, -np.inf).astype("float32"))
    return np.where(np.isfinite(out), out, np.nan)


def _retry(fn, tries: int = 4):
    """S3 over the proxy now and then drops a connection; try again before giving up."""
    import time

    for k in range(tries):
        try:
            return fn()
        except Exception as e:  # noqa: BLE001 - aiohttp disconnects are not OSError; re-raised below
            if k == tries - 1:
                raise
            print(f"retrying after {type(e).__name__}: {e}", flush=True)
            time.sleep(2 ** (k + 1))


def _open_daily() -> xr.Dataset:
    return _retry(lambda: xr.open_zarr(f"{power.BUCKET_URL}/{DAILY_STORE}", consolidated=True,
                                       storage_options=power.STORAGE_OPTIONS))


def read_daily(variables, bbox, start: str, end: str) -> xr.Dataset:
    """Daily values of some variables for a box, first day of ``start`` to last day of ``end``."""
    ds = _open_daily()
    lon0, lat0, lon1, lat1 = bbox
    t = ds["time"].values
    d0 = np.datetime64(start, "M").astype("datetime64[D]")
    d1 = (np.datetime64(end, "M") + np.timedelta64(1, "M")).astype("datetime64[D]") - np.timedelta64(1, "D")
    sel = np.flatnonzero((t >= d0) & (t <= d1))
    sub = ds[list(variables)].isel(time=slice(sel[0], sel[-1] + 1)).sel(
        lat=slice(lat0, lat1), lon=slice(lon0, lon1))
    return _retry(sub.load)


def build_indices(bbox, start="1981-01", end="2025-12", cache_dir: Path | None = DEFAULT_CACHE) -> xr.Dataset:
    """Monthly indices (time, lat, lon) for a box; months labelled by their last day like power.load."""
    key = json.dumps(["hazard-v2", bbox, start, end, SNOW_FRAC, WET_MM, HEAVY_MM, WIND_THRESHOLDS])
    path = None
    if cache_dir is not None:
        cache_dir.mkdir(parents=True, exist_ok=True)
        path = cache_dir / f"hazard_{hashlib.sha1(key.encode()).hexdigest()[:10]}.nc"
        if path.exists():
            return xr.open_dataset(path).load()
    d = read_daily(("FRSNO", "PRECTOTCORR", "WS10M_MAX"), bbox, start, end)
    days = d["time"].values
    months, pos = month_index(days)
    flags = daily_flags(d["FRSNO"].values, d["PRECTOTCORR"].values, d["WS10M_MAX"].values)
    data = {k: monthly_counts(v, pos, months.size) for k, v in flags.items()}
    data["RX1DAY"] = monthly_max(d["PRECTOTCORR"].values, pos, months.size)
    # a month with any missing day is unknown, not a month with fewer events
    gaps = monthly_counts(~np.isfinite(d["FRSNO"].values + d["PRECTOTCORR"].values + d["WS10M_MAX"].values),
                          pos, months.size) > 0
    last_day = (months + np.timedelta64(1, "M")).astype("datetime64[D]") - np.timedelta64(1, "D")
    coords = {"time": last_day.astype("datetime64[ns]"), "lat": d["lat"].values, "lon": d["lon"].values}
    out = xr.Dataset({k: (("time", "lat", "lon"), np.where(gaps, np.nan, v)) for k, v in data.items()},
                     coords=coords)
    for k, (title, units, definition, base) in INDICES.items():
        out[k].attrs.update({"long_name": title, "units": units, "definition": definition,
                             "built_from": ", ".join(base)})
    out.attrs["source"] = f"{power.BUCKET_URL}/{DAILY_STORE}"
    if path is not None:
        out.to_netcdf(path)
    return out


def load(product: str, var: str, bbox=None, start="1981-01", end="2025-12", coarsen: int = 1,
         cache_dir: Path | None = DEFAULT_CACHE) -> xr.DataArray:
    """One monthly index as a (time, lat, lon) array, the same shape as power.load."""
    if var not in INDICES:
        raise KeyError(f"{var} is not one of {sorted(INDICES)}")
    if bbox is None:
        raise ValueError("daily indices are built for a box, not the globe")
    da = build_indices(tuple(bbox), start, end, cache_dir)[var]
    if coarsen > 1:
        da = da.coarsen(lat=coarsen, lon=coarsen, boundary="trim").mean()
    da.attrs["product"] = product
    return da.astype("float32")


# ----------------------------------------------------------------------------
# Downwind of a mine on dust-prone days
# ----------------------------------------------------------------------------

def bearing(lat0, lon0, lat1, lon1) -> float:
    """Initial great-circle bearing from point 0 to point 1, degrees clockwise from north."""
    p0, p1, dl = np.radians(lat0), np.radians(lat1), np.radians(lon1 - lon0)
    y = np.sin(dl) * np.cos(p1)
    x = np.cos(p0) * np.sin(p1) - np.sin(p0) * np.cos(p1) * np.cos(dl)
    return float(np.degrees(np.arctan2(y, x)) % 360)


def distance_km(lat0, lon0, lat1, lon1) -> float:
    p0, p1 = np.radians(lat0), np.radians(lat1)
    a = np.sin((p1 - p0) / 2) ** 2 + np.cos(p0) * np.cos(p1) * np.sin(np.radians(lon1 - lon0) / 2) ** 2
    return float(2 * 6371.0 * np.arcsin(np.sqrt(a)))


def blows_toward(u, v) -> np.ndarray:
    """Direction the wind blows toward, degrees clockwise from north (u east, v north)."""
    return np.degrees(np.arctan2(u, v)) % 360


def angle_diff(a, b) -> np.ndarray:
    return np.abs((np.asarray(a) - b + 180.0) % 360.0 - 180.0)


def season_years(days, m0: int, m1: int) -> np.ndarray:
    """Season year of each day for months m0..m1 (wrapping), -1 outside the season.

    A season over New Year belongs to the year of its last month, as in web/js/season.js.
    """
    d = np.asarray(days, dtype="datetime64[D]")
    y = d.astype("datetime64[Y]").astype(int) + 1970
    m = d.astype("datetime64[M]").astype(int) % 12 + 1
    want = [(k - 1) % 12 + 1 for k in range(m0, m0 + ((m1 - m0) % 12) + 1)]
    inside = np.isin(m, want)
    sy = np.where((m0 > m1) & (m >= m0), y + 1, y)
    return np.where(inside, sy, -1)


def complete_season_years(days, m0: int, m1: int) -> np.ndarray:
    """Season years whose every day lies inside the record."""
    d = np.asarray(days, dtype="datetime64[D]")
    sy = season_years(d, m0, m1)
    out = []
    for year in np.unique(sy[sy >= 0]):
        first_m = np.datetime64(f"{year - 1 if m0 > m1 else year}-{m0:02d}", "M")
        last_m = np.datetime64(f"{year}-{m1:02d}", "M")
        n_days = int(((last_m + np.timedelta64(1, "M")).astype("datetime64[D]") - first_m.astype("datetime64[D]"))
                     / np.timedelta64(1, "D"))
        if np.sum(sy == year) == n_days:
            out.append(int(year))
    return np.array(out, dtype=int)


# presets mirror web/js/season.js
SEASONS = {"all": (1, 12), "djf": (12, 2), "mam": (3, 5), "jja": (6, 8), "son": (9, 11),
           "ndjfm": (11, 3), "mjjas": (5, 9), **{f"m{k}": (k, k) for k in range(1, 13)}}
SECTOR_HALF_WIDTH = 22.5    # a settlement counts as downwind within +-22.5 deg of the wind's heading


def downwind_summary(days, dust, u, v, mine: dict, settlements: list, n_sectors: int = 16) -> dict:
    """Where the wind carries dust from one mine cell, per season preset.

    ``dust`` flags the dust-prone days of the mine's cell; ``u``/``v`` are its daily mean
    10 m winds. For each preset: the dust-prone days blowing toward each of
    ``n_sectors`` directions per season year, and per settlement the dust-prone days per season year on
    which it lies within +-22.5 deg of the wind's heading.
    """
    heading = blows_toward(u, v)
    width = 360.0 / n_sectors
    sector = np.floor(((heading + width / 2) % 360) / width).astype(int)
    places = []
    for p in settlements:
        brg = bearing(mine["lat"], mine["lon"], p["lat"], p["lon"])
        places.append(dict(p, bearing=round(brg, 1), km=round(distance_km(mine["lat"], mine["lon"], p["lat"], p["lon"]), 1),
                           hit=angle_diff(heading, brg) <= SECTOR_HALF_WIDTH))
    out = {}
    for sid, (m0, m1) in SEASONS.items():
        sy = season_years(days, m0, m1)
        years = complete_season_years(days, m0, m1)
        inside = np.isin(sy, years) & dust
        out[sid] = {
            "years": years.tolist(),
            "dust_days_per_year": [int(np.sum(inside & (sy == y))) for y in years],
            # dust-prone days per year blowing toward each sector, so any run of years can be summed
            "sectors_per_year": [np.bincount(sector[inside & (sy == y)], minlength=n_sectors).tolist() for y in years],
            "places": [{"name": p["name"], "per_year": [int(np.sum(inside & p["hit"] & (sy == y))) for y in years]}
                       for p in places],
        }
    return {"mine": mine, "settlements": [{k: p[k] for k in ("name", "mn", "lat", "lon", "bearing", "km", "source")}
                                         for p in places],
            "n_sectors": n_sectors, "half_width": SECTOR_HALF_WIDTH, "seasons": out}


def mines_payload(mines: list, settlements: dict, start="1981-01", end="2025-12", threshold=8.0) -> dict:
    """Downwind summaries for several mines, reading only the tiles that hold them."""
    ds = _open_daily()
    t = ds["time"].values
    d0 = np.datetime64(start, "M").astype("datetime64[D]")
    d1 = (np.datetime64(end, "M") + np.timedelta64(1, "M")).astype("datetime64[D]") - np.timedelta64(1, "D")
    sel = np.flatnonzero((t >= d0) & (t <= d1))
    out = []
    for mine in mines:
        cell = _retry(ds[["FRSNO", "PRECTOTCORR", "WS10M_MAX", "U10M", "V10M"]].isel(
            time=slice(sel[0], sel[-1] + 1)).sel(lat=mine["lat"], lon=mine["lon"], method="nearest").load)
        days = cell["time"].values
        dust = daily_flags(cell["FRSNO"].values, cell["PRECTOTCORR"].values, cell["WS10M_MAX"].values,
                           (threshold,))[f"DUSTDAYS{threshold:g}"]
        s = downwind_summary(days, dust, cell["U10M"].values, cell["V10M"].values, mine, settlements[mine["id"]])
        s["cell"] = {"lat": float(cell["lat"]), "lon": float(cell["lon"])}
        out.append(s)
    return {"threshold_ms": threshold, "period": [start, end], "mines": out,
            "source": f"{power.BUCKET_URL}/{DAILY_STORE}"}


# Mines and the soum centres around them. Oyu Tolgoi and Tsagaan Suvarga are GeoNames mine
# features; Tavan Tolgoi has none, so its centre was read off NASA HLS (Sentinel-2) imagery
# from GIBS (HLS_S30, 2025-07-25): pits and dumps span about 105.40-105.56 E, 43.57-43.68 N.
GEONAMES = "GeoNames (CC BY 4.0)"
MINES = [
    {"id": "tavan-tolgoi", "name": "Tavan Tolgoi (coal)", "mn": "Таван толгой (нүүрс)", "lat": 43.63, "lon": 105.49,
     "source": "centre of the pits read off NASA HLS S30 imagery, 2025-07-25 (GIBS)"},
    {"id": "oyu-tolgoi", "name": "Oyu Tolgoi (copper-gold)", "mn": "Оюу толгой (зэс, алт)", "lat": 43.0083,
     "lon": 106.8431, "source": "GeoNames 7648663"},
    {"id": "tsagaan-suvarga", "name": "Tsagaan Suvarga (copper)", "mn": "Цагаан суварга (зэс)", "lat": 44.3306,
     "lon": 108.2854, "source": "GeoNames 11980164"},
]
_SOUM = {  # GeoNames id: (English, Mongolian, lat, lon)
    2032631: ("Tsogttsetsii", "Цогтцэций", 43.65595, 105.75577),
    2031403: ("Bayan-Ovoo", "Баян-Овоо", 42.97238, 106.11866),
    2029735: ("Khankhongor", "Ханхонгор", 43.78336, 104.48067),
    2032007: ("Dalanzadgad", "Даланзадгад", 43.57083, 104.425),
    2031832: ("Tsogt-Ovoo", "Цогт-Овоо", 44.42446, 105.32078),
    2030251: ("Khanbogd", "Ханбогд", 43.2, 107.2),
    2028905: ("Mandakh", "Мандах", 44.4, 108.25),
    2029700: ("Saikhandulaan", "Сайхандулаан", 44.68333, 109.01667),
}
SETTLEMENTS = {  # soum centres within about 100 km of each mine
    "tavan-tolgoi": [2032631, 2031403, 2029735, 2032007, 2031832],
    "oyu-tolgoi": [2030251, 2031403],
    "tsagaan-suvarga": [2028905, 2029700],
}


def settlements_for(mine_id: str) -> list[dict]:
    return [{"name": _SOUM[g][0], "mn": _SOUM[g][1], "lat": _SOUM[g][2], "lon": _SOUM[g][3],
             "source": f"GeoNames {g}"} for g in SETTLEMENTS[mine_id]]
