"""Check MERRA-2 snow-cover fraction (FRSNO) against MODIS Terra monthly snow cover (MOD10CM).

MODIS is an independent satellite record (MERRA-2 does not assimilate snow cover).
Tiles of the GIBS layer MODIS_Terra_L3_Snow_Cover_Monthly_Average_Pct (2 km) are
decoded with GIBS's own colormap (values 0-100 % = mean snow cover of the month;
cloud, night, water and fill are left out) and averaged over each 0.5 x 0.625 deg
MERRA-2 cell of the Mongolia box, then compared with the monthly mean of daily FRSNO.

Usage: python scripts/check_snow_modis.py OUT.json [first_year last_year]
"""

import io
import json
import re
import sys
import time
from pathlib import Path

import numpy as np
import requests
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from trend_detective import hazard  # noqa: E402

GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/MODIS_Terra_L3_Snow_Cover_Monthly_Average_Pct/default"
COLORMAP = "https://gibs.earthdata.nasa.gov/colormaps/v1.3/MODIS_NDSI_Snow_Cover.xml"
BBOX = (87.5, 41.0, 120.5, 52.5)
Z, DEG = 5, 288 / 2 ** 5           # 9 deg per 512-px tile, 0.0176 deg per pixel
MONTHS = (11, 12, 1, 2, 3, 4)


def colour_table(session) -> dict:
    t = session.get(COLORMAP, timeout=60).text
    out = {}
    for rgb, attrs in re.findall(r'<ColorMapEntry rgb="([\d,]+)"([^>]*)/>', t):
        m = re.search(r'value="\[(\d+)\]"', attrs)
        if m and 'transparent="true"' not in attrs:
            out[tuple(int(c) for c in rgb.split(","))] = int(m.group(1))
    return out  # 1..100; transparent entries (0, cloud, water, fill) stay out


def month_field(session, table, ym) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Snow cover % on the 2 km grid of the box (NaN where not a 0-100 value), with pixel centres."""
    c0, c1 = int((BBOX[0] + 180) // DEG), int((BBOX[2] + 180) // DEG)
    r0, r1 = int((90 - BBOX[3]) // DEG), int((90 - BBOX[1]) // DEG)
    mosaic = np.full(((r1 - r0 + 1) * 512, (c1 - c0 + 1) * 512), np.nan, dtype="float32")
    lut = np.full(256 ** 3, np.nan, dtype="float32")
    for (r, g, b), v in table.items():
        lut[(r << 16) | (g << 8) | b] = v
    for r in range(r0, r1 + 1):
        for c in range(c0, c1 + 1):
            im = None
            for k in range(4):
                try:
                    resp = session.get(f"{GIBS}/{ym}-01/2km/{Z}/{r}/{c}.png", timeout=120)
                    if resp.status_code == 200:
                        im = np.asarray(Image.open(io.BytesIO(resp.content)).convert("RGBA")).astype(np.int64)
                        break
                except Exception:  # noqa: BLE001 - a broken tile is retried, then left out
                    pass
                time.sleep(2 ** k)
            if im is None:
                print(f"  tile {ym} {r}/{c} unavailable, left out", flush=True)
                continue
            code = (im[..., 0] << 16) | (im[..., 1] << 8) | im[..., 2]
            vals = np.where(im[..., 3] > 0, lut[code], np.nan)
            # 0 % is drawn transparent; an opaque-free pixel inside the land area is snow-free land
            vals = np.where((im[..., 3] == 0) & (code == 0x00FF00), 0.0, vals)
            mosaic[(r - r0) * 512:(r - r0 + 1) * 512, (c - c0) * 512:(c - c0 + 1) * 512] = vals
    lat = 90 - (np.arange(mosaic.shape[0]) + 0.5) * DEG / 512 - r0 * DEG
    lon = -180 + (np.arange(mosaic.shape[1]) + 0.5) * DEG / 512 + c0 * DEG
    return mosaic, lat, lon


def to_cells(field, lat, lon, cell_lat, cell_lon, min_valid=0.5) -> np.ndarray:
    """Mean of the 2 km pixels in each MERRA-2 cell; NaN when fewer than half are valid."""
    out = np.full((cell_lat.size, cell_lon.size), np.nan)
    for i, la in enumerate(cell_lat):
        ri = (lat >= la - 0.25) & (lat < la + 0.25)
        for j, lo in enumerate(cell_lon):
            cj = (lon >= lo - 0.3125) & (lon < lo + 0.3125)
            block = field[np.ix_(ri, cj)]
            ok = np.isfinite(block)
            if ok.mean() >= min_valid:
                out[i, j] = block[ok].mean()
    return out


def main(out_path, y0=2001, y1=2025):
    ds = hazard._open_daily()
    fr = hazard._retry(ds["FRSNO"].sel(time=slice(f"{y0}-01-01", f"{y1}-12-31"),
                                       lat=slice(BBOX[1], BBOX[3]), lon=slice(BBOX[0], BBOX[2])).load)
    months = fr["time"].values.astype("datetime64[M]")
    cell_lat, cell_lon = fr["lat"].values, fr["lon"].values
    session = requests.Session()
    table = colour_table(session)
    pairs = []
    for y in range(y0, y1 + 1):
        for m in MONTHS:
            ym = f"{y}-{m:02d}"
            sel = months == np.datetime64(ym)
            if not sel.any():
                continue
            field, lat, lon = month_field(session, table, ym)
            modis = to_cells(field, lat, lon, cell_lat, cell_lon)
            m2 = 100 * np.nanmean(fr.values[sel], axis=0)
            pairs.append((ym, modis, m2))
            print(ym, "cells", int(np.isfinite(modis).sum()), "MODIS %.1f%% MERRA-2 %.1f%%" %
                  (np.nanmean(modis), np.nanmean(np.where(np.isfinite(modis), m2, np.nan))), flush=True)
    modis = np.stack([p[1] for p in pairs])
    m2 = np.stack([p[2] for p in pairs])
    ok = np.isfinite(modis) & np.isfinite(m2)
    r_all = float(np.corrcoef(modis[ok], m2[ok])[0, 1])
    bias = float(np.mean(m2[ok] - modis[ok]))
    # how often each says "at least half covered" in the same cell-month
    agree = float(np.mean((modis[ok] >= 50) == (m2[ok] >= 50)))
    # MODIS % against MERRA-2 %: the MERRA-2 cover that matches MODIS's "half covered"
    slope, intercept = np.polyfit(m2[ok], modis[ok], 1)
    south = cell_lat[:, None].repeat(cell_lon.size, 1) < 45.5
    s_ok = ok & south[None]
    res = {
        "months": [p[0] for p in pairs], "cell_months": int(ok.sum()),
        "r": round(r_all, 3), "bias_merra2_minus_modis_pct": round(bias, 1),
        "mean_modis_pct": round(float(modis[ok].mean()), 1), "mean_merra2_pct": round(float(m2[ok].mean()), 1),
        "agree_half_covered": round(agree, 3),
        "fit_modis_on_merra2": {"slope": round(float(slope), 3), "intercept": round(float(intercept), 2),
                                "merra2_pct_matching_modis_50": round(float((50 - intercept) / slope), 1)},
        "by_month": {str(mo): {"mean_modis_pct": round(float(np.nanmean(modis[[int(p[0][5:]) == mo for p in pairs]])), 1),
                               "mean_merra2_pct": round(float(np.nanmean(np.where(np.isfinite(modis), m2, np.nan)[[int(p[0][5:]) == mo for p in pairs]])), 1)}
                     for mo in MONTHS},
        "interannual_r_by_month": {str(mo): round(float(np.corrcoef(
            np.nanmean(modis[[int(p[0][5:]) == mo for p in pairs]], axis=(1, 2)),
            np.nanmean(np.where(np.isfinite(modis), m2, np.nan)[[int(p[0][5:]) == mo for p in pairs]], axis=(1, 2)))[0, 1]), 3)
            for mo in MONTHS},
        "gobi_south_of_45_5": {"cell_months": int(s_ok.sum()), "r": round(float(np.corrcoef(modis[s_ok], m2[s_ok])[0, 1]), 3),
                               "mean_modis_pct": round(float(modis[s_ok].mean()), 1),
                               "mean_merra2_pct": round(float(m2[s_ok].mean()), 1)},
        "source": {"modis": "GIBS MODIS_Terra_L3_Snow_Cover_Monthly_Average_Pct (MOD10CM), 2 km",
                   "merra2": "NASA POWER daily FRSNO, monthly mean"},
    }
    Path(out_path).write_text(json.dumps(res, indent=1))
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    main(sys.argv[1], *(int(a) for a in sys.argv[2:4]))
