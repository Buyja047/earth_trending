"""Precompute trend scenes for the web viewer.

A scene is one variable over one region and period. For each scene we write
``<id>.js`` holding per-cell statistics, verdicts, regions, region means and
a base64 int16 anomaly series per cell (for the inspector and
the trend triangle).
"""

from __future__ import annotations

import base64
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from . import analysis, catalog, grid, nsidc, power, stats
from .geo import load_focus_rings, points_in_rings
from .payload import read_payload, write_payload
from .synthetic import dipole_field

REGIONS = {
    "global": {"name": "Globe", "bbox": None, "wrap": True},
    "mongolia": {"name": "Mongolia", "bbox": (87.5, 41.0, 120.5, 52.5), "wrap": False},
}


@dataclass
class SceneSpec:
    id: str
    title: str
    product: str
    var: str
    region: str
    start: str = "1981-01"
    end: str = "2025-12"
    coarsen: int = 1
    group: str = ""
    case: str | None = None
    regrid_like: str | None = None  # scene id whose grid this one is averaged onto
    aggregates: list = field(default_factory=list)
    reference: str | None = None  # independent record to check the scene against


SCENES = [
    SceneSpec("global-t2m", "Air temperature at 2 m", "merra2", "T2M", "global", coarsen=4,
              group="Globe 1981-2025", case="arctic-amplification",
              aggregates=["globe", "nh", "sh"]),
    SceneSpec("global-precip", "Precipitation (corrected)", "merra2", "PRECTOTCORR", "global",
              coarsen=4, group="Globe 1981-2025", case="wet-dry",
              aggregates=["globe", "nh", "sh"]),
    SceneSpec("global-soil", "Root-zone soil wetness", "merra2", "GWETROOT", "global", coarsen=4,
              group="Globe 1981-2025", case="wet-dry", aggregates=["globe", "nh", "sh"]),
    SceneSpec("global-seaice", "Sea-ice fraction", "merra2", "FRSEAICE", "global", coarsen=4,
              group="Globe 1981-2025", case="sea-ice", aggregates=["arctic_area", "antarctic_area"],
              reference="nsidc"),
    SceneSpec("global-ozone", "Total column ozone", "merra2", "TO3", "global", coarsen=4,
              group="Globe 1981-2025", case="ozone", aggregates=["globe"]),
    SceneSpec("mn-t2m", "Air temperature at 2 m", "merra2", "T2M", "mongolia",
              group="Mongolia 1981-2025", case="mongolia", aggregates=["focus"]),
    SceneSpec("mn-precip", "Precipitation (corrected)", "merra2", "PRECTOTCORR", "mongolia",
              group="Mongolia 1981-2025", case="mongolia", aggregates=["focus"]),
    SceneSpec("mn-soil", "Root-zone soil wetness", "merra2", "GWETROOT", "mongolia",
              group="Mongolia 1981-2025", case="mongolia", aggregates=["focus"]),
    SceneSpec("mn-wind", "Wind speed at 10 m", "merra2", "WS10M", "mongolia",
              group="Mongolia 1981-2025", case="mongolia", aggregates=["focus"]),
    SceneSpec("mn-snow", "Snow depth", "merra2", "SNODP", "mongolia",
              group="Mongolia 1981-2025", case="mongolia", aggregates=["focus"]),
    SceneSpec("mn-aod", "Aerosol optical depth 550 nm", "syn1deg", "AOD_55_ADJ", "mongolia",
              start="2001-01", group="Mongolia 2001-2025", case="dust", aggregates=["focus"]),
    SceneSpec("mn-precip-m2-2001", "Precipitation, MERRA-2 (model)", "merra2", "PRECTOTCORR",
              "mongolia", start="2001-01", group="Mongolia 2001-2025", case="crosscheck",
              aggregates=["focus"]),
    SceneSpec("mn-precip-imerg", "Precipitation, GPM IMERG (satellites)", "imerg",
              "IMERG_PRECTOT", "mongolia", start="2001-01", group="Mongolia 2001-2025",
              case="crosscheck", regrid_like="mn-precip-m2-2001", aggregates=["focus"]),
]

COMPARISONS = [("mn-precip-m2-2001", "mn-precip-imerg")]


# ----------------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------------

def _num(a, sig=4):
    return [None if not np.isfinite(v) else float(f"{v:.{sig}g}")
            for v in np.asarray(a, dtype=float).ravel()]


def encode_series(arr: np.ndarray) -> tuple[str, float]:
    """Base64 of int16 little-endian values (-32768 = missing) and the scale."""
    finite = np.isfinite(arr)
    peak = float(np.max(np.abs(arr[finite]))) if finite.any() else 1.0
    scale = (peak / 32000.0) or 1.0
    q = np.where(finite, np.round(np.nan_to_num(arr) / scale), -32768).astype("<i2")
    return base64.b64encode(q.tobytes()).decode("ascii"), scale


def _edges(coord: np.ndarray) -> float:
    return float(np.median(np.diff(coord))) if coord.size > 1 else 1.0


def box_regrid(values: np.ndarray, lat_src, lon_src, lat_dst, lon_dst) -> np.ndarray:
    """Mean of fine cells whose centres fall inside each coarse target cell."""
    dlat, dlon = _edges(lat_dst), _edges(lon_dst)
    iy = np.floor((lat_src - (lat_dst[0] - dlat / 2)) / dlat).astype(int)
    ix = np.floor((lon_src - (lon_dst[0] - dlon / 2)) / dlon).astype(int)
    out = np.full((values.shape[0], lat_dst.size, lon_dst.size), np.nan, dtype=float)
    for j in range(lat_dst.size):
        rows = iy == j
        if not rows.any():
            continue
        sub = values[:, rows, :]
        for i in range(lon_dst.size):
            cols = ix == i
            if cols.any():
                out[:, j, i] = np.nanmean(sub[:, :, cols].reshape(values.shape[0], -1), axis=1)
    return out


def _aggregate_masks(key, lat, lon, focus_rings):
    lon2d, lat2d = np.meshgrid(lon, lat)
    if key == "globe":
        return "Globe (area-weighted mean)", np.ones_like(lat2d, bool), "mean"
    if key == "nh":
        return "Northern Hemisphere", lat2d > 0, "mean"
    if key == "sh":
        return "Southern Hemisphere", lat2d < 0, "mean"
    if key == "arctic_area":
        return "Arctic sea-ice area (approx.)", lat2d > 0, "area_sum"
    if key == "antarctic_area":
        return "Antarctic sea-ice area (approx.)", lat2d < 0, "area_sum"
    if key == "focus":
        return "Mongolia (country mask)", points_in_rings(lon2d, lat2d, focus_rings), "mean"
    raise KeyError(key)


def _stats_json(s: dict, per_decade=True) -> dict:
    f = 10.0 if per_decade else 1.0
    out = {
        "sen": s["sen"] * f, "sen_lo": s["sen_lo"] * f, "sen_hi": s["sen_hi"] * f,
        "p_naive": s["p_naive"], "p_mk": s["p_mk"], "p_hr_empirical": s["p_hr_empirical"],
        "ols": s["ols"] * f, "p_ols_ar1": s["p_ols_ar1"], "phi": s["phi"], "sigma": s["sigma"],
        "mdt": s["mdt"] * f, "nstar": s["nstar"], "n_eff": s["n_eff"], "n": s["n"],
    }
    out = {k: (None if v is None or not np.isfinite(v) else float(f"{v:.4g}"))
           for k, v in out.items()}
    out["steps"] = [{"t_break": st["t_break"], "label": st.get("label", ""),
                     "step": float(f"{st['step']:.4g}"), "p_step": float(f"{st['p_step']:.4g}"),
                     "trend_with_step": float(f"{st['trend_with_step'] * f:.4g}")}
                    for st in s["steps"]]
    return out


# ----------------------------------------------------------------------------
# scene builder
# ----------------------------------------------------------------------------

def _breaks(product, var):
    out, notes = [], []
    for tr in catalog.transitions_for(product, var):
        if tr["verified"] and tr["date"]:
            out.append((catalog.decimal_from_ym(tr["date"]), f"{tr['date']}: {tr['label']}"))
        notes.append({"date": tr["date"], "label": tr["label"], "verified": tr["verified"],
                      "source": tr["source"]})
    return out, notes


def write_scene(spec_meta: dict, values, times, lat, lon, out_dir: Path, focus_rings,
                breaks, transition_notes, aggregates, truth=None, extra=None) -> dict:
    lat = np.asarray(lat, float)
    lon = np.asarray(lon, float)
    dlat, dlon = _edges(lat), _edges(lon)
    region = REGIONS[spec_meta["region"]]
    t0 = time.time()
    res = analysis.analyze_field(values, times, lat, lon, breaks, dlat, dlon, region["wrap"])
    ny, nx = lat.size, lon.size
    sid = spec_meta["id"]

    # per-cell series: monthly for regional scenes, annual means for the globe
    if spec_meta["region"] == "global":
        years, ann = analysis.annual_means(res["anom"], res["t"])
        cell_series = np.full((ny * nx, years.size), np.nan)
        cell_series[res["valid"]] = ann[res["valid"]]
        series_meta = {"kind": "annual", "start": float(years[0]), "n": int(years.size)}
    else:
        cell_series = np.where(res["valid"][:, None], res["anom"], np.nan)
        series_meta = {"kind": "monthly", "start": float(res["t"][0]), "n": int(res["t"].size)}
    series_meta["b64"], series_meta["scale"] = encode_series(cell_series)

    area = grid.cell_area_km2(lat, dlat, dlon)
    region_means = []
    for key in aggregates:
        name, mask, how = _aggregate_masks(key, lat, lon, focus_rings)
        if how == "area_sum":  # a cell that is always ice-covered still counts toward area
            mask = mask & np.isfinite(values).all(axis=0)
        else:
            mask = mask & res["valid"].reshape(ny, nx)
        if not mask.any():
            continue
        series = analysis.region_series(values, times, lat, mask, how, area)
        units = spec_meta["units"]
        if how == "area_sum":
            series = series / 1e6
            units = "million km2"
        rm = analysis.analyze_region(series, times, breaks)
        yrs, ann = analysis.annual_means(rm["anom"], rm["t"])
        region_means.append({
            "key": key, "name": name, "how": how, "units": units,
            "raw_mean": float(f"{rm['raw_mean']:.4g}"), "cells": int(mask.sum()),
            "monthly": _num(rm["anom"]), "monthly_start": float(rm["t"][0]),
            "annual_years": yrs.tolist(), "annual": _num(ann),
            "stats": _stats_json(rm["stats"]),
        })

    warnings = []
    if res["counts"]["gappy"]:
        msg = (f"{res['counts']['gappy']} of {ny * nx} cells have missing months and were "
               "excluded rather than gap-filled.")
        lo, hi = spec_meta.get("valid_min"), spec_meta.get("valid_max")
        if lo is not None:
            msg += (f" The provider masks values outside its valid range [{lo:g}, {hi:g}] "
                    f"{spec_meta['units']}, so the missing months can be real extremes: "
                    "any trend computed with them dropped would be censored.")
        warnings.append(msg)

    c = res["cells"]
    out = dict(spec_meta)
    out.update({
        "data_warnings": warnings,
        "period": {"start": str(np.asarray(times[0], "datetime64[M]")),
                   "end": str(np.asarray(times[-1], "datetime64[M]")),
                   "years": round(res["years"], 3), "n_months": int(len(times))},
        "grid": {"lat": _num(lat, 6), "lon": _num(lon, 6), "dlat": dlat, "dlon": dlon,
                 "ny": ny, "nx": nx, "wrap": region["wrap"]},
        "alpha_global": analysis.ALPHA_GLOBAL,
        "alpha_fdr": analysis.ALPHA_GLOBAL * analysis.WILKS_FACTOR,
        "p_star": res["p_star"],
        "counts": res["counts"],
        "transitions": transition_notes,
        "cells": {
            "sen": _num(c["sen"] * 10), "sen_lo": _num(c["sen_lo"] * 10),
            "sen_hi": _num(c["sen_hi"] * 10), "p_naive": _num(c["p_naive"], 3),
            "p_mk": _num(c["p_mk"], 3), "p_hr_empirical": _num(c["p_hr_empirical"], 3),
            "p_ols": _num(c["p_ols_ar1"], 3), "phi": _num(c["phi"], 3),
            "sigma": _num(c["sigma"]), "mdt": _num(c["mdt"] * 10), "nstar": _num(c["nstar"], 3),
            "clim_mean": _num(c["clim_mean"]), "status": res["status"].tolist(),
        },
        "steps": [{"t_break": s["t_break"], "label": s["label"], "p_star": s["p_star"],
                   "flagged": int(s["flag"].sum()), "step": _num(s["step"]),
                   "p_step": _num(s["p_step"], 3), "flag": s["flag"].astype(int).tolist(),
                   "trend_with_step": _num(s["trend_with_step"] * 10)} for s in res["steps"]],
        "regions": [{k: v for k, v in r.items() if k != "label_cells"} | {"cells_idx": r["label_cells"]}
                    for r in res["regions"]],
        "region_means": region_means,
        "series": series_meta,
        "status_legend": analysis.STATUS,
        "compute_seconds": round(time.time() - t0, 1),
    })
    if truth is not None:
        true = truth.ravel() != 0
        naive = (np.nan_to_num(c["p_naive"], nan=1) < 0.05)
        scores = {}
        for name, m in (("naive", naive), ("fdr", res["fdr"])):
            tp, fp = int(np.sum(m & true)), int(np.sum(m & ~true))
            fn = int(np.sum(~m & true))
            scores[name] = {"tp": tp, "fp": fp, "fn": fn,
                            "fdp": round(fp / max(tp + fp, 1), 3),
                            "power": round(tp / max(tp + fn, 1), 3)}
        out["truth"] = {"slope": _num(truth.ravel() * 10), "scores": scores}
    if extra:
        out.update(extra)
    write_payload(out_dir / f"{sid}.js", sid, out)
    return out


def build_spec(spec: SceneSpec, out_dir: Path, focus_rings, built: dict) -> dict:
    region = REGIONS[spec.region]
    da = power.load(spec.product, spec.var, region["bbox"], spec.start, spec.end, spec.coarsen)
    values, lat, lon = da.values, da["lat"].values, da["lon"].values
    if spec.regrid_like:
        ref = built[spec.regrid_like]
        lat_d = np.asarray(ref["grid"]["lat"], float)
        lon_d = np.asarray(ref["grid"]["lon"], float)
        values = box_regrid(values, lat, lon, lat_d, lon_d)
        lat, lon = lat_d, lon_d
    prod = catalog.PRODUCTS[spec.product]
    breaks, tnotes = _breaks(spec.product, spec.var)
    spec_meta = {
        "id": spec.id, "title": spec.title, "group": spec.group, "case": spec.case,
        "product": spec.product, "product_name": prod["name"], "kind": prod["kind"],
        "source": prod["source"], "var": spec.var,
        "long_name": da.attrs.get("long_name", spec.var), "units": da.attrs.get("units", ""),
        "definition": da.attrs.get("definition", ""), "region": spec.region,
        "region_name": REGIONS[spec.region]["name"], "notes": catalog.notes_for(spec.product, spec.var),
        "native_res": prod["native_res"],
        "valid_min": da.attrs.get("valid_min"), "valid_max": da.attrs.get("valid_max"),
        "grid_note": (f"block-averaged {spec.coarsen}x{spec.coarsen} from native grid"
                      if spec.coarsen > 1 else
                      ("averaged onto the MERRA-2 grid" if spec.regrid_like else "native grid")),
    }
    extra = None
    if spec.reference == "nsidc":
        extra = {"reference": nsidc_reference(values, da["time"].values, lat, lon, breaks)}
    return write_scene(spec_meta, values, da["time"].values, lat, lon, out_dir, focus_rings,
                       breaks, tnotes, spec.aggregates, extra=extra)


def nsidc_reference(values, times, lat, lon, merra_breaks) -> dict:
    """Check MERRA-2 hemispheric sea-ice area against the NSIDC Sea Ice Index.

    Differencing the two anomaly series removes the weather and climate
    variability they share, so a step in MERRA-2 minus NSIDC at a documented
    data-source change is evidence of an artifact rather than of real change.
    """
    lat = np.asarray(lat, float)
    area = grid.cell_area_km2(lat, _edges(lat), _edges(np.asarray(lon, float)))
    complete = np.isfinite(values).all(axis=0)
    t = stats.decimal_year(times)
    nsidc_breaks, _ = _breaks("nsidc", "area")
    out = {"name": catalog.PRODUCTS["nsidc"]["name"], "url": catalog.PRODUCTS["nsidc"]["url"],
           "hemispheres": []}
    for hemi, name, sel in (("S", "Antarctic", lat < 0), ("N", "Arctic", lat > 0)):
        m2 = analysis.region_series(values, times, lat, sel[:, None] & complete, "area_sum", area) / 1e6
        ref = nsidc.monthly_series(hemi, times)
        r_m2 = analysis.analyze_region(m2, times, merra_breaks)
        r_area = analysis.analyze_region(ref["area"], times, nsidc_breaks)
        r_ext = analysis.analyze_region(ref["extent"], times, nsidc_breaks)
        diff = r_m2["anom"] - r_area["anom"]
        d = stats.analyze_series(diff, t, breaks=[b for b, _ in merra_breaks])
        for st, (_, label) in zip(d["steps"], merra_breaks):
            st["label"] = label
        ok = np.isfinite(diff)
        years, d_ann = analysis.annual_means(np.where(ok, diff, np.nan), t)
        out["hemispheres"].append({
            "key": hemi, "name": name,
            "merra2_area": _stats_json(r_m2["stats"]), "nsidc_area": _stats_json(r_area["stats"]),
            "nsidc_extent": _stats_json(r_ext["stats"]),
            "merra2_mean": float(f"{np.nanmean(m2):.4g}"),
            "nsidc_mean": float(f"{np.nanmean(ref['area']):.4g}"),
            "anomaly_correlation": round(float(np.corrcoef(r_m2["anom"][ok], r_area["anom"][ok])[0, 1]), 3),
            "difference": _stats_json(d),
            "difference_monthly": _num(diff), "monthly_start": float(t[0]),
            "difference_annual": _num(d_ann), "annual_years": years.tolist(),
            "missing_months": int((~ok).sum()),
            "sources": sorted(set(s for s in ref["source"] if s)),
        })
    return out


def build_synthetic(out_dir: Path) -> dict:
    values, lat, lon, t, truth = dipole_field()
    years = np.floor(t).astype(int)
    months = np.round((t - years) * 12 - 0.5).astype(int) + 1
    times = np.array([np.datetime64(f"{y}-{m:02d}", "M") for y, m in zip(years, months)])
    spec_meta = {
        "id": "synthetic-truth", "title": "Known-truth test field", "group": "Validation",
        "case": "truth", "product": "synthetic", "product_name": "Synthetic AR(1) field",
        "kind": "synthetic", "source": "trend_detective.synthetic.dipole_field(seed=42)",
        "var": "X", "long_name": "Synthetic anomaly (noise sd = 1)", "units": "sd",
        "definition": "AR(1) noise (phi=0.5, spatially smoothed) plus one planted warming and "
                      "one planted cooling region. Used only to score the statistics.",
        "region": "global", "region_name": "Synthetic globe", "notes": [],
        "native_res": "5 deg", "grid_note": "synthetic",
    }
    return write_scene(spec_meta, values, times, lat, lon, out_dir, [], [], [], ["globe"],
                       truth=truth)


def compare(a: dict, b: dict) -> dict:
    """Agreement between two scenes on the same grid (e.g. model vs satellites)."""
    sa = np.array([np.nan if v is None else v for v in a["cells"]["sen"]])
    sb = np.array([np.nan if v is None else v for v in b["cells"]["sen"]])
    fa = np.isin(a["cells"]["status"], [1, 2])
    fb = np.isin(b["cells"]["status"], [1, 2])
    both = np.isfinite(sa) & np.isfinite(sb)
    either = both & (fa | fb)
    same = np.sign(sa) == np.sign(sb)
    ra = a["region_means"][0]
    rb = b["region_means"][0]
    ma, mb = np.array(ra["monthly"], float), np.array(rb["monthly"], float)
    ok = np.isfinite(ma) & np.isfinite(mb)
    return {
        "a": a["id"], "b": b["id"],
        "cells_compared": int(both.sum()),
        "sign_agreement_all": round(float(np.mean(same[both])), 3) if both.any() else None,
        "cells_significant_either": int(either.sum()),
        "sign_agreement_significant": round(float(np.mean(same[either])), 3) if either.any() else None,
        "both_significant_same_sign": int(np.sum(fa & fb & same & both)),
        "both_significant_opposite": int(np.sum(fa & fb & ~same & both)),
        "region_anomaly_correlation": round(float(np.corrcoef(ma[ok], mb[ok])[0, 1]), 3),
        "region_trend_a": ra["stats"], "region_trend_b": rb["stats"],
    }


def screen_region(out_dir: Path, focus_rings, bbox=REGIONS["mongolia"]["bbox"],
                  products=(("merra2", "1981-01"), ("syn1deg", "2001-01")), end="2025-12",
                  limit=None) -> dict:
    """Rank every screenable variable by how large its regional trend is.

    The family of variable-level p-values gets its own BH-FDR at 5 %.
    Variables are not independent, so treat the ranking as a guide to where
    to look, not as independent discoveries.
    """
    rows = []
    for product, start in products:
        table = [r for r in power.variable_table(product) if catalog.screenable(r["var"])]
        if limit:
            table = table[:limit]
        for r in table:
            try:
                da = power.load(product, r["var"], bbox, start, end)
            except Exception as exc:  # a missing or malformed variable should not stop the screen
                print(f"  skip {product}:{r['var']}: {exc}")
                continue
            lat, lon = da["lat"].values, da["lon"].values
            lon2d, lat2d = np.meshgrid(lon, lat)
            mask = points_in_rings(lon2d, lat2d, focus_rings)
            vals = da.values
            series = analysis.region_series(vals, da["time"].values, lat, mask)
            if not np.all(np.isfinite(series)) or np.nanstd(series) < 1e-9:
                continue
            breaks, _ = _breaks(product, r["var"])
            rm = analysis.analyze_region(series, da["time"].values, breaks)
            s = rm["stats"]
            change = s["sen"] * rm["years"]
            nonneg = np.nanmin(vals) >= 0 and r["units"] not in ("C", "degrees")
            yrs, ann = analysis.annual_means(rm["anom"], rm["t"])
            rows.append({
                "product": product, "kind": catalog.PRODUCTS[product]["kind"], "var": r["var"],
                "long_name": r["long_name"], "units": r["units"],
                "start": start[:4], "years": round(rm["years"], 1),
                "clim_mean": float(f"{rm['raw_mean']:.4g}"),
                "change_sd": float(f"{change / s['sigma']:.3g}") if s["sigma"] > 0 else None,
                "change_pct": (float(f"{100 * change / rm['raw_mean']:.3g}")
                               if nonneg and rm["raw_mean"] > 0 else None),
                "annual": _num(ann), "annual_years": yrs.tolist(),
                "stats": _stats_json(s),
            })
            print(f"  screened {product}:{r['var']}", flush=True)
    p = np.array([row["stats"]["p_mk"] if row["stats"]["p_mk"] is not None else np.nan
                  for row in rows])
    mask, pstar = stats.fdr_mask(p, alpha_global=0.05, wilks_factor=1.0)
    for row, m in zip(rows, mask):
        row["fdr"] = bool(m)
    # Evidence first, then size: ranking by size alone puts slow, strongly
    # autocorrelated variables (deep soil temperature) on top without support.
    rows.sort(key=lambda r: (not r["fdr"], -abs(r["change_sd"] or 0)))
    out = {"region": "Mongolia (country mask)", "alpha_fdr": 0.05, "p_star": pstar,
           "n_variables": len(rows), "rows": rows}
    write_payload(out_dir / "screen-mongolia.js", "screen-mongolia", out)
    return out


def build_all(out_dir: Path, geo_path: Path, only=None, screen=True, screen_limit=None) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    focus = load_focus_rings(geo_path)
    built = {}
    syn = build_synthetic(out_dir)
    built[syn["id"]] = syn
    wanted = set(only or [s.id for s in SCENES])
    wanted |= {s.regrid_like for s in SCENES if s.id in wanted and s.regrid_like}
    for spec in SCENES:
        if spec.id not in wanted:
            continue
        t0 = time.time()
        built[spec.id] = build_spec(spec, out_dir, focus, built)
        print(f"built {spec.id} in {time.time() - t0:.0f}s  counts={built[spec.id]['counts']}",
              flush=True)
    keys = ("id", "title", "group", "case", "product", "product_name", "kind", "var",
            "long_name", "units", "region", "region_name", "counts", "period")
    entries = {sc["id"]: {k: sc[k] for k in keys} for sc in built.values()}
    comps = [compare(built[a], built[b]) for a, b in COMPARISONS if a in built and b in built]
    old_index = out_dir / "index.js"
    if only and old_index.exists():  # partial rebuild: keep what was not rebuilt
        prev = read_payload(old_index)
        merged = {e["id"]: e for e in prev["scenes"]}
        merged.update(entries)
        order = [s.id for s in SCENES]
        entries = {i: merged[i] for i in ["synthetic-truth", *order] if i in merged}
        done = {(c["a"], c["b"]) for c in comps}
        comps += [c for c in prev.get("comparisons", []) if (c["a"], c["b"]) not in done]
        screen_kept = prev.get("has_screen", False)
    else:
        screen_kept = False
    index = list(entries.values())
    if screen:
        screen_region(out_dir, focus, limit=screen_limit)
    idx = {
        "generated_utc": np.datetime_as_string(np.datetime64("now"), unit="s"),
        "data_source": power.BUCKET_URL,
        "scenes": index,
        "comparisons": comps,
        "products": catalog.PRODUCTS,
        "transitions": catalog.TRANSITIONS,
        "has_screen": screen or screen_kept,
    }
    write_payload(out_dir / "index.js", "index", idx)
    return idx
