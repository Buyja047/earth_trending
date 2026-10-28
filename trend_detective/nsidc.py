"""NSIDC Sea Ice Index (G02135, version 4) monthly extent and area.

Used as the independent reference for MERRA-2 sea ice: NSIDC builds a
consistent passive-microwave record for exactly this purpose, while MERRA-2
copies its sea ice from other analyses whose sources changed over time.
Missing months (-9999, e.g. Dec 1987-Jan 1988) become NaN.
"""

from __future__ import annotations

import csv
import io
from pathlib import Path

import numpy as np

BASE_URL = "https://noaadata.apps.nsidc.org/NOAA/G02135"
DEFAULT_CACHE = Path(__file__).resolve().parent.parent / "cache" / "nsidc"
HEMI = {"S": "south", "N": "north"}


def parse_monthly_csv(text: str) -> dict:
    """{(year, month): (source, extent, area)} with -9999 mapped to NaN."""
    out = {}
    rows = list(csv.reader(io.StringIO(text)))
    for r in rows[1:]:
        if len(r) < 6:
            continue
        y, m, src, _region, ext, area = (x.strip() for x in r[:6])
        ext_v, area_v = float(ext), float(area)
        out[(int(y), int(m))] = ("" if src == "-9999" else src, np.nan if ext_v < 0 else ext_v,
                                 np.nan if area_v < 0 else area_v)
    return out


def _fetch(hemi: str, month: int, cache_dir: Path) -> str:
    name = f"{hemi}_{month:02d}_extent_v4.0.csv"
    path = cache_dir / name
    if path.exists():
        return path.read_text()
    import requests

    r = requests.get(f"{BASE_URL}/{HEMI[hemi]}/monthly/data/{name}", timeout=60)
    r.raise_for_status()
    cache_dir.mkdir(parents=True, exist_ok=True)
    path.write_text(r.text)
    return r.text


def monthly_series(hemi: str, times, cache_dir: Path = DEFAULT_CACHE) -> dict:
    """Extent, area (million km2) and source dataset for each month in ``times``."""
    table = {}
    for m in range(1, 13):
        table.update(parse_monthly_csv(_fetch(hemi, m, cache_dir)))
    keys = [(int(str(t)[:4]), int(str(t)[5:7])) for t in np.asarray(times, "datetime64[M]")]
    rows = [table.get(k, ("", np.nan, np.nan)) for k in keys]
    return {
        "extent": np.array([r[1] for r in rows], dtype=float),
        "area": np.array([r[2] for r in rows], dtype=float),
        "source": [r[0] for r in rows],
    }
