"""Coastlines and borders from the world-atlas TopoJSON (Natural Earth, ISC licence).

Get the files with ``npm pack world-atlas@2.0.2`` and pass the extracted
``package/`` directory to :func:`build_geo`.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np


def _decode_arcs(topo: dict) -> list[np.ndarray]:
    sx, sy = topo["transform"]["scale"]
    tx, ty = topo["transform"]["translate"]
    arcs = []
    for arc in topo["arcs"]:
        a = np.cumsum(np.asarray(arc, dtype=float), axis=0)
        arcs.append(np.column_stack([a[:, 0] * sx + tx, a[:, 1] * sy + ty]))
    return arcs


def _ring(arcs, idx_list) -> np.ndarray:
    pts = []
    for i in idx_list:
        a = arcs[i] if i >= 0 else arcs[~i][::-1]
        pts.append(a if not pts else a[1:])
    return np.vstack(pts)


def _rings(topo: dict, geom: dict, arcs) -> list[np.ndarray]:
    if geom["type"] == "Polygon":
        polys = [geom["arcs"]]
    elif geom["type"] == "MultiPolygon":
        polys = geom["arcs"]
    else:
        return []
    return [_ring(arcs, r) for poly in polys for r in poly]


def _rounded(rings, nd=2):
    return [np.round(r, nd).tolist() for r in rings]


def points_in_rings(lon: np.ndarray, lat: np.ndarray, rings: list[np.ndarray]) -> np.ndarray:
    """Even-odd ray casting; works for polygons with holes."""
    inside = np.zeros(lon.shape, dtype=bool)
    for r in rings:
        x0, y0 = r[:-1, 0], r[:-1, 1]
        x1, y1 = r[1:, 0], r[1:, 1]
        for a, b, c, d in zip(x0, y0, x1, y1):
            cond = (b > lat) != (d > lat)
            with np.errstate(divide="ignore", invalid="ignore"):
                xint = a + (lat - b) * (c - a) / (d - b)
            inside ^= cond & (lon < xint)
    return inside


def build_geo(world_atlas_dir: Path, out_path: Path, country: str = "Mongolia") -> dict:
    wa = Path(world_atlas_dir)
    land = json.loads((wa / "land-110m.json").read_text())
    countries = json.loads((wa / "countries-50m.json").read_text())
    land_arcs = _decode_arcs(land)
    land_rings = []
    for g in land["objects"]["land"]["geometries"]:
        land_rings += _rings(land, g, land_arcs)
    c_arcs = _decode_arcs(countries)
    borders, focus = [], []
    for g in countries["objects"]["countries"]["geometries"]:
        rings = _rings(countries, g, c_arcs)
        name = g.get("properties", {}).get("name")
        if name == country:
            focus = rings
        # keep neighbours near the focus region only, to stay small
        for r in rings:
            if (r[:, 0].max() > 70 and r[:, 0].min() < 135 and r[:, 1].max() > 30
                    and r[:, 1].min() < 60):
                borders.append(r)
    geo = {
        "source": "world-atlas 2.0.2 (Natural Earth 1:110m land, 1:50m countries), ISC licence",
        "land": _rounded(land_rings, 2),
        "borders": _rounded(borders, 2),
        "focus": {"name": country, "rings": _rounded(focus, 3)},
    }
    out_path.write_text(json.dumps(geo, separators=(",", ":")))
    return geo


def load_focus_rings(geo_path: Path) -> list[np.ndarray]:
    geo = json.loads(Path(geo_path).read_text())
    return [np.asarray(r) for r in geo["focus"]["rings"]]
