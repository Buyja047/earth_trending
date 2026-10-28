/* Live analysis: read any monthly NASA POWER variable for a lon/lat box straight from
 * the public Zarr store and turn it into a scene the viewer analyses like the
 * precomputed ones. The catalog (data/power-catalog.js) describes the grids and codecs. */
(function (root) {
  "use strict";
  const Z = root.TDZarr || (typeof require === "function" ? require("./zarr.js") : null);
  const MAX_CELLS = 5000, MAX_CHUNKS = 40, MIN_YEARS = 10;
  const MS_PER_CELL_540 = 8;            // measured cost of TDStats.analyze for 540 monthly values

  const COLS = ["name", "long_name", "units", "screenable", "scale", "offset"];
  function findVar(cat, product, name) {
    const p = cat.products[product], n = String(name || "").trim().toUpperCase();
    const row = p && p.vars.find((r) => r[0].toUpperCase() === n);
    return row ? Object.fromEntries(COLS.map((c, k) => [c, row[k]])) : null;
  }
  const yearOf = (ym) => +String(ym).slice(0, 4);
  // last calendar year the bucket says is complete for this product
  function lastFullYear(cat, product) {
    const last = cat.last_available && cat.last_available[product];
    if (!last) return yearOf(cat.built) - 1;
    const y = yearOf(last), m = +last.slice(5, 7);
    return m === 12 ? y : y - 1;
  }

  /** Grid rows/columns, chunks and cost for a box; `error` names the first problem. */
  function plan(cat, product, name, bbox, y0, y1) {
    const p = cat.products[product], v = findVar(cat, product, name);
    const out = { product, v, bbox, y0, y1 };
    if (!v) return Object.assign(out, { error: "var" });
    const [W, S, E, N] = bbox.map(Number);
    if (![W, S, E, N].every(Number.isFinite) || W >= E || S >= N) return Object.assign(out, { error: "box" });
    const iy0 = Math.max(0, Math.ceil((S - p.lat0) / p.dlat - 1e-9)), iy1 = Math.min(p.nlat - 1, Math.floor((N - p.lat0) / p.dlat + 1e-9));
    const ix0 = Math.max(0, Math.ceil((W - p.lon0) / p.dlon - 1e-9)), ix1 = Math.min(p.nlon - 1, Math.floor((E - p.lon0) / p.dlon + 1e-9));
    if (iy1 < iy0 || ix1 < ix0) return Object.assign(out, { error: "box" });
    const ny = iy1 - iy0 + 1, nx = ix1 - ix0 + 1, [, cy, cx] = p.chunks, chunks = [];
    for (let a = Math.floor(iy0 / cy); a <= Math.floor(iy1 / cy); a++) for (let b = Math.floor(ix0 / cx); b <= Math.floor(ix1 / cx); b++) chunks.push([a, b]);
    const t0 = yearOf(p.t0), last = lastFullYear(cat, product);
    y0 = Math.max(t0, y0); y1 = Math.min(last, y1);
    const nm = (y1 - y0 + 1) * 12;
    Object.assign(out, { iy0, iy1, ix0, ix1, ny, nx, cells: nx * ny, chunks, y0, y1, nm,
      m0: (y0 - t0) * 12, mb: chunks.length * p.chunk_mb,
      seconds: nx * ny * MS_PER_CELL_540 * Math.pow(Math.max(nm, 1) / 540, 2) / 1000 });
    if (y1 - y0 + 1 < MIN_YEARS) out.error = "years";
    else if (out.cells > MAX_CELLS) out.error = "cells";
    else if (chunks.length > MAX_CHUNKS) out.error = "chunks";
    return out;
  }

  /** Even-odd ray casting, the same rule as trend_detective.geo.points_in_rings. */
  function inRings(lon, lat, rings) {
    let inside = false;
    for (const r of rings) {
      for (let k = 0; k + 1 < r.length; k++) {
        const [a, b] = r[k], [c, d] = r[k + 1];
        if ((b > lat) !== (d > lat) && lon < a + (lat - b) * (c - a) / (d - b)) inside = !inside;
      }
    }
    return inside;
  }

  // cos-latitude weighted mean per month over the chosen cells, counting only finite values
  function regionSeries(raw, nm, cells, lat, nx) {
    const acc = new Float64Array(nm), ws = new Float64Array(nm);
    for (const k of cells) {
      const w = Math.cos(lat[Math.floor(k / nx)] * Math.PI / 180), base = k * nm;
      for (let m = 0; m < nm; m++) { const v = raw[base + m]; if (Number.isFinite(v)) { acc[m] += w * v; ws[m] += w; } }
    }
    return Array.from(acc, (v, m) => (ws[m] ? v / ws[m] : NaN));
  }
  // subtract calendar-month means; returns the anomalies and the mean of the finite values
  function anomalies(x) {
    const sum = new Float64Array(12), cnt = new Float64Array(12);
    let tot = 0, n = 0;
    x.forEach((v, m) => { if (Number.isFinite(v)) { sum[m % 12] += v; cnt[m % 12]++; tot += v; n++; } });
    return { anom: x.map((v, m) => (Number.isFinite(v) && cnt[m % 12] ? v - sum[m % 12] / cnt[m % 12] : NaN)), mean: n ? tot / n : NaN };
  }
  function regionMean(key, name, raw, nm, cells, grid, units, y0) {
    const s = anomalies(regionSeries(raw, nm, cells, grid.lat, grid.nx));
    const years = [], annual = [];
    for (let y = 0; y < nm / 12; y++) {
      const part = s.anom.slice(y * 12, y * 12 + 12);
      years.push(y0 + y);
      annual.push(part.every(Number.isFinite) ? part.reduce((a, b) => a + b, 0) / 12 : null);
    }
    return { key, name, how: "mean", units, raw_mean: s.mean, cells: cells.length,
      monthly: s.anom.map((v) => (Number.isFinite(v) ? v : null)), monthly_start: y0 + 1 / 24,
      annual_years: years, annual };
  }

  const pool = async (n, items, fn) => {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) { const k = next++; await fn(items[k], k); }
    }));
  };
  const pause = () => new Promise((r) => setTimeout(r, 0));

  /** Download, decode and assemble a planned box into { sc, vals } (vals: anomalies, cell-major). */
  async function read(cat, pl, opt = {}) {
    const p = cat.products[pl.product], v = pl.v, [, cy, cx] = p.chunks, nt = p.nt;
    const scale = v.scale || 100, offset = v.offset === null || v.offset === undefined ? 1000 : v.offset;
    const progress = opt.onProgress || (() => {});
    const bufs = new Array(pl.chunks.length);
    let done = 0, bytes = 0;
    await pool(4, pl.chunks, async ([a, b], k) => {
      bufs[k] = await Z.fetchChunk(`${p.store}/${v.name}/0.${a}.${b}`, opt.fetchImpl);
      done++; bytes += bufs[k] ? bufs[k].length : 0;
      progress({ phase: "download", done, total: pl.chunks.length, mb: bytes / 1e6 });
    });
    progress({ phase: "decode" });
    const ncell = pl.nx * pl.ny;
    let nm = pl.nm;
    const raw = new Float32Array(ncell * nm).fill(NaN);
    for (let k = 0; k < pl.chunks.length; k++) {
      if (!bufs[k]) continue;
      const [a, b] = pl.chunks[k], arr = Z.decodeChunk(bufs[k], scale, offset, nt * cy * cx);
      bufs[k] = null;
      for (let j = 0; j < pl.ny; j++) {
        const gy = pl.iy0 + j - a * cy;
        if (gy < 0 || gy >= cy) continue;
        for (let i = 0; i < pl.nx; i++) {
          const gx = pl.ix0 + i - b * cx;
          if (gx < 0 || gx >= cx) continue;
          const base = (j * pl.nx + i) * nm;
          for (let m = 0; m < nm; m++) raw[base + m] = arr[((pl.m0 + m) * cy + gy) * cx + gx];
        }
      }
      await pause();
    }
    // keep whole years up to the last month that has any data in the box
    let lastM = -1;
    for (let m = nm - 1; m >= 0 && lastM < 0; m--) for (let c = 0; c < ncell; c++) if (Number.isFinite(raw[c * nm + m])) { lastM = m; break; }
    if (lastM < 0) throw Object.assign(new Error("no data"), { code: "nodata" });
    let y1 = pl.y1;
    const keep = Math.floor((lastM + 1) / 12) * 12;
    let rawUse = raw;
    if (keep < nm) {
      y1 = pl.y0 + keep / 12 - 1;
      if (y1 - pl.y0 + 1 < MIN_YEARS) throw Object.assign(new Error("too short"), { code: "short" });
      rawUse = new Float32Array(ncell * keep);
      for (let c = 0; c < ncell; c++) rawUse.set(raw.subarray(c * nm, c * nm + keep), c * keep);
      nm = keep;
    }
    const lat = Array.from({ length: pl.ny }, (_, j) => +(p.lat0 + (pl.iy0 + j) * p.dlat).toFixed(4));
    const lon = Array.from({ length: pl.nx }, (_, i) => +(p.lon0 + (pl.ix0 + i) * p.dlon).toFixed(4));
    const grid = { lat, lon, dlat: p.dlat, dlon: p.dlon, ny: pl.ny, nx: pl.nx, wrap: false };
    const vals = new Float32Array(ncell * nm), status = new Array(ncell).fill(0), climMean = new Array(ncell).fill(null);
    let gappy = 0, valid = 0;
    for (let c = 0; c < ncell; c++) {
      const s = anomalies(Array.from(rawUse.subarray(c * nm, (c + 1) * nm)));
      let fin = 0;
      s.anom.forEach((x, m) => { vals[c * nm + m] = x; if (Number.isFinite(x)) fin++; });
      status[c] = fin === 0 ? 0 : fin < nm ? 6 : 1;
      if (status[c] === 6) gappy++;
      if (status[c] === 1) valid++;
      climMean[c] = Number.isFinite(s.mean) ? +s.mean.toPrecision(5) : null;
    }
    if (!valid) throw Object.assign(new Error("no complete cells"), { code: "nodata" });
    const units = v.units, all = [];
    for (let c = 0; c < ncell; c++) if (status[c]) all.push(c);
    const regions = [regionMean("box", "Box mean (cos-latitude weighted)", rawUse, nm, all, grid, units, pl.y0)];
    // Mongolia's border mask, as in the precomputed scenes, when the box reaches into the country
    let focus = false;
    if (opt.focusRings && opt.focusRings.length) {
      const inBox = all.filter((c) => inRings(lon[c % pl.nx], lat[Math.floor(c / pl.nx)], opt.focusRings));
      if (inBox.length) {
        focus = true;
        const whole = countryCells(p, opt.focusRings) === inBox.length;
        regions.unshift(regionMean(whole ? "focus" : "focus_part", whole ? "Mongolia (country mask)" : "Mongolian part of the box",
          rawUse, nm, inBox, grid, units, pl.y0));
      }
    }
    const [W, S, E, N] = [lon[0] - p.dlon / 2, lat[0] - p.dlat / 2, lon[pl.nx - 1] + p.dlon / 2, lat[pl.ny - 1] + p.dlat / 2];
    const fmtLL = (x, pos, neg) => `${Math.abs(+x.toFixed(2))}°${x >= 0 ? pos : neg}`;
    const sc = {
      id: opt.id || `live-${Date.now()}`, live: true, title: v.long_name, group: "Live analysis", product: pl.product,
      product_name: p.name, kind: p.kind, var: v.name, long_name: v.long_name, units, region: "box", focus,
      region_name: `${fmtLL(W, "E", "W")}–${fmtLL(E, "E", "W")}, ${fmtLL(S, "N", "S")}–${fmtLL(N, "N", "S")}`,
      native_res: p.res, notes: [].concat(p.note ? [p.note] : [], (cat.notes || {})[`${pl.product}/${v.name}`] || []),
      transitions: (cat.transitions || {})[`${pl.product}/${v.name}`] || [], data_warnings: [],
      period: { start: `${pl.y0}-01`, end: `${y1}-12`, years: y1 - pl.y0 + 1, n_months: nm },
      grid, series: { kind: "monthly", start: pl.y0 + 1 / 24, n: nm },
      cells: { status, clim_mean: climMean }, counts: { valid, gappy, step_flagged: 0 },
      steps: [], region_means: regions, alpha_fdr: 0.1,
      live_info: { read: new Date().toISOString(), chunks: pl.chunks.length, mb: +(bytes / 1e6).toFixed(1),
        trimmed: y1 < pl.y1 ? { from: pl.y1, to: y1 } : null },
    };
    return { sc, vals };
  }

  // how many grid cells of this product fall inside the rings (cached per product)
  const countryCache = {};
  function countryCells(p, rings) {
    if (countryCache[p.store] !== undefined) return countryCache[p.store];
    let lo0 = Infinity, lo1 = -Infinity, la0 = Infinity, la1 = -Infinity;
    for (const r of rings) for (const [x, y] of r) { lo0 = Math.min(lo0, x); lo1 = Math.max(lo1, x); la0 = Math.min(la0, y); la1 = Math.max(la1, y); }
    let n = 0;
    for (let j = Math.ceil((la0 - p.lat0) / p.dlat); p.lat0 + j * p.dlat <= la1; j++) {
      for (let i = Math.ceil((lo0 - p.lon0) / p.dlon); p.lon0 + i * p.dlon <= lo1; i++) if (inRings(p.lon0 + i * p.dlon, p.lat0 + j * p.dlat, rings)) n++;
    }
    countryCache[p.store] = n;
    return n;
  }

  const api = { findVar, plan, read, inRings, lastFullYear, MAX_CELLS, MAX_CHUNKS, MIN_YEARS };
  root.TDLive = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
