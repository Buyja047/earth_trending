"""Map furniture: coastlines and borders from world-atlas (Natural Earth, ISC
licence) and searchable places from GeoNames (CC BY 4.0).

Coastlines: ``npm pack world-atlas@2.0.2`` and pass the extracted ``package/``
directory to :func:`build_geo`. Places: download ``MN.zip`` and
``cities15000.zip`` from https://download.geonames.org/export/dump/, unzip, and
pass that directory to :func:`build_places`.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from .payload import read_payload, write_payload


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
    write_payload(out_path, "geo", geo)
    return geo


def load_focus_rings(geo_path: Path) -> list[np.ndarray]:
    geo = read_payload(geo_path)
    return [np.asarray(r) for r in geo["focus"]["rings"]]


# Mongolian spellings for the GeoNames places we keep, keyed by GeoNames name.
MN_NAMES = {
    "Ulan Bator": "Улаанбаатар", "Erdenet": "Эрдэнэт", "Darhan": "Дархан",
    "Choibalsan": "Чойбалсан", "Nalayh": "Налайх", "Mörön": "Мөрөн",
    "Bayanhongor": "Баянхонгор", "Ulaangom": "Улаангом", "Khovd": "Ховд",
    "Arvayheer": "Арвайхээр", "Ölgii": "Өлгий", "Dalandzadgad": "Даланзадгад",
    "Sühbaatar": "Сүхбаатар", "Undurkhaan": "Чингис хот (Өндөрхаан)",
    "Tsetserleg": "Цэцэрлэг", "Saynshand": "Сайншанд", "Dzüünharaa": "Зүүнхараа",
    "Baruun-Urt": "Баруун-Урт", "Altai": "Алтай", "Bulgan": "Булган",
    "Dzuunmod": "Зуунмод", "Uliastay": "Улиастай", "Kharkhorin": "Хархорин",
    "Mandalgovi": "Мандалговь", "Zamiin Uud": "Замын-Үүд", "Choyr": "Чойр",
    "Oyu Tolgoi": "Оюу толгой (уурхай)", "Tavan Tolgoi": "Таван толгой (нисэх буудал)",
}
EXTRA_MN = {("PPL", "Nalayh"), ("PPL", "Dzüünharaa"), ("PPL", "Zamiin Uud"),
            ("PPLA2", "Kharkhorin"), ("MN", "Oyu Tolgoi"), ("AIRF", "Tavan Tolgoi")}


def _geonames_rows(path: Path):
    with open(path, encoding="utf-8") as f:
        for line in f:
            r = line.rstrip("\n").split("\t")
            if len(r) >= 15:
                yield r


def build_places(geonames_dir: Path, out_path: Path) -> list[dict]:
    """Mongolian aimag centres, larger towns and two mining sites, plus world capitals."""
    d = Path(geonames_dir)
    places, seen = [], set()
    for r in _geonames_rows(d / "MN.txt"):
        name, lat, lon, fcode = r[1], float(r[4]), float(r[5]), r[7]
        keep = fcode in ("PPLC", "PPLA") or (fcode, name) in EXTRA_MN
        if not keep or name in seen:
            continue
        seen.add(name)
        kind = {"PPLC": "capital", "PPLA": "aimag", "MN": "mine", "AIRF": "airfield"}.get(fcode, "town")
        places.append({"en": name.replace("Ulan Bator", "Ulaanbaatar") + (" (mine)" if kind == "mine" else
                                                                            " (airfield)" if kind == "airfield" else ""),
                       "mn": MN_NAMES.get(name, name), "lat": round(lat, 3), "lon": round(lon, 3),
                       "kind": kind, "cc": "MN"})
    for r in _geonames_rows(d / "cities15000.txt"):
        if r[7] == "PPLC" and r[8] != "MN":
            places.append({"en": r[1], "mn": r[1], "lat": round(float(r[4]), 3),
                           "lon": round(float(r[5]), 3), "kind": "capital", "cc": r[8]})
    write_payload(out_path, "places", {"source": "GeoNames (CC BY 4.0), downloaded 2026-10-27",
                                      "places": places})
    return places
