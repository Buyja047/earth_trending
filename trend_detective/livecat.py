"""Catalog of NASA POWER monthly Zarr variables for live analysis in the viewer.

The browser reads chunks straight from the public ``nasa-power`` bucket, so it
needs, per product, the grid (regular, checked here), the time axis, the chunk
layout and codecs, and per variable its name, long name and units. This module
writes that once to ``web/data/power-catalog.js``; the data themselves are
read live.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import numpy as np
import requests

from . import catalog, power
from .payload import write_payload

LIVE_PRODUCTS = ("merra2", "syn1deg")
SAMPLE_CHUNKS = 12
TYPICAL_VAR = {"merra2": "T2M", "syn1deg": "ALLSKY_SFC_SW_DWN"}  # for the download-size estimate


def _regular(values: np.ndarray, name: str) -> tuple[float, float]:
    step = np.diff(values)
    if not np.allclose(step, step[0], rtol=0, atol=1e-6):
        raise ValueError(f"{name} is not a regular grid")
    return float(values[0]), float(step[0])


def _zmetadata(product: str) -> dict:
    r = requests.get(f"{power.store_url(product)}/.zmetadata", timeout=120)
    r.raise_for_status()
    return r.json()["metadata"]


def _mean_chunk_mb(product: str, var: str, ny: int, nx: int) -> float:
    """Average compressed size of a few chunks of one variable (HEAD requests)."""
    rng = np.random.default_rng(1)
    sizes = []
    for _ in range(SAMPLE_CHUNKS):
        key = f"{var}/0.{rng.integers(0, ny)}.{rng.integers(0, nx)}"
        r = requests.head(f"{power.store_url(product)}/{key}", timeout=60)
        if r.ok:
            sizes.append(int(r.headers["Content-Length"]))
    return round(float(np.mean(sizes)) / 1e6, 3) if sizes else 1.0


def product_entry(product: str) -> tuple[dict, dict, dict]:
    meta = _zmetadata(product)
    ds = power.open_product(product)
    lat0, dlat = _regular(ds["lat"].values, "lat")
    lon0, dlon = _regular(ds["lon"].values, "lon")
    months = ds["time"].values.astype("datetime64[M]")
    if not np.all(np.diff(months).astype(int) == 1):
        raise ValueError(f"{product}: time axis is not consecutive months")

    layouts, rows, transitions, notes = {}, [], {}, {}
    for key, arr in meta.items():
        if not key.endswith("/.zarray"):
            continue
        var = key[: -len("/.zarray")]
        attrs = meta.get(f"{var}/.zattrs", {})
        if attrs.get("_ARRAY_DIMENSIONS") != ["time", "lat", "lon"]:
            continue
        # variables differ only in the fixedscaleoffset scale; that goes in the row
        filt = arr.get("filters") or []
        scaled = (len(filt) == 1 and filt[0].get("id") == "fixedscaleoffset"
                  and filt[0].get("dtype") == "<f4" and filt[0].get("astype") == "<f4")
        layout = json.dumps({k: arr[k] for k in ("shape", "chunks", "dtype", "compressor",
                                                 "order", "fill_value")} | {"scaled": scaled},
                            sort_keys=True)
        layouts.setdefault(layout, []).append(var)
        rows.append([var, attrs.get("long_name", var), attrs.get("units", ""),
                     1 if catalog.screenable(var) else 0,
                     filt[0]["scale"] if scaled else None, filt[0]["offset"] if scaled else None])
        tr = catalog.transitions_for(product, var)
        if tr:
            transitions[f"{product}/{var}"] = [{k: t[k] for k in ("date", "label", "verified", "source")} for t in tr]
        if (product, var) in catalog.NOTES:
            notes[f"{product}/{var}"] = [catalog.NOTES[(product, var)]]

    # every data variable must share one layout, or the browser would need per-variable codecs
    main = max(layouts, key=lambda k: len(layouts[k]))
    odd = {v for k, vs in layouts.items() if k != main for v in vs}
    rows = sorted((r for r in rows if r[0] not in odd), key=lambda r: r[0])
    lay = json.loads(main)
    if (lay["dtype"] != "<f4" or lay["order"] != "C" or lay["compressor"]["cname"] != "zstd"
            or not lay["scaled"]):
        raise ValueError(f"{product}: unsupported layout {lay}")
    if lay["chunks"][0] != lay["shape"][0]:
        raise ValueError(f"{product}: time is split across chunks")

    info = catalog.PRODUCTS[product]
    ny, nx = (-(-lay["shape"][1] // lay["chunks"][1]), -(-lay["shape"][2] // lay["chunks"][2]))
    entry = {
        "name": info["name"], "kind": info["kind"], "res": info["native_res"],
        "store": f"{power.store_url(product)}", "vars": rows, "skipped_vars": sorted(odd),
        "lat0": lat0, "dlat": dlat, "nlat": lay["shape"][1],
        "lon0": lon0, "dlon": dlon, "nlon": lay["shape"][2],
        "t0": str(months[0]), "nt": lay["shape"][0],
        "chunks": lay["chunks"], "compressor": lay["compressor"], "fill_value": lay["fill_value"],
        "var_columns": ["name", "long_name", "units", "screenable", "scale", "offset"],
        "note": catalog.NOTES.get((product, None)),
        "chunk_mb": _mean_chunk_mb(product, TYPICAL_VAR[product], ny, nx),
    }
    return entry, transitions, notes


def build_catalog(out_path: Path, products=LIVE_PRODUCTS) -> dict:
    last = power.last_available()
    out = {"built": date.today().isoformat(), "products": {}, "transitions": {}, "notes": {},
           "last_available": {p: last.get(p, {}).get("temporal", {}).get("monthly", {}).get("utc")
                              for p in products}}
    for p in products:
        entry, tr, nt = product_entry(p)
        out["products"][p] = entry
        out["transitions"].update(tr)
        out["notes"].update(nt)
    write_payload(out_path, "power-catalog", out)
    return out
