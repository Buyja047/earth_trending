/* Trend Detective viewer. Loads precomputed scenes from data/ and lets the
 * reader ask, for each variable: what is changing, where, by how much, and
 * whether the change survives honest significance testing. */
(function () {
  "use strict";
  const S = window.TDStats;
  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const WATER_VARS = new Set(["PRECTOTCORR", "IMERG_PRECTOT", "GWETROOT", "GWETTOP", "SNODP", "FRSEAICE", "FRSNO"]);
  const PLACES = [
    { name: "Ulaanbaatar", lat: 47.92, lon: 106.92 },
    { name: "Tavan Tolgoi", lat: 43.6, lon: 105.5 },
    { name: "Dalanzadgad", lat: 43.57, lon: 104.42, left: true },
  ];
  const LAYERS = [
    { id: "trend", label: "Trend, FDR-tested" },
    { id: "naive", label: "Trend, naive p<0.05" },
    { id: "verdict", label: "Verdict" },
    { id: "detect", label: "Detectable trend size" },
    { id: "steps", label: "Data-source steps" },
    { id: "truth", label: "Planted truth" },
  ];

  const state = { index: null, geo: null, validation: null, screen: null, cache: {}, sc: null,
    series: null, layer: "trend", sel: null, step: 0, screenFilter: "all" };

  // ------------------------------------------------------------------ formatting
  function unitLabel(u) {
    return ({ C: "°C", "1": "fraction", Dobsons: "DU", dimensionless: "", sd: "sd" })[u] ?? u;
  }
  function fmt(v, sig = 3) {
    if (v === null || v === undefined || !Number.isFinite(v)) return "–";
    if (v === 0) return "0";
    const a = Math.abs(v);
    if (a >= 1000) return Math.round(v).toLocaleString("en-US");
    if (a < 1e-3) return v.toExponential(1);
    return Number(v.toPrecision(sig)).toString();
  }
  function signed(v, sig = 3) { return (v > 0 ? "+" : "") + fmt(v, sig); }
  function fmtP(p) {
    if (p === null || p === undefined || !Number.isFinite(p)) return "–";
    if (p < 0.001) return "<0.001";
    return p < 0.01 ? p.toFixed(3) : p.toFixed(2);
  }
  function ll(lat, lon) {
    return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`;
  }
  function perDecade(sc) { const u = unitLabel(sc.units); return `${u ? u + " " : ""}per decade`; }

  // ------------------------------------------------------------------ colour
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function hexRgb(h) {
    const m = h.replace("#", "");
    return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
  }
  const toLin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const toSrgb = (c) => { const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; return Math.round(255 * Math.min(1, Math.max(0, v))); };
  function oklab([r, g, b]) {
    r = toLin(r); g = toLin(g); b = toLin(b);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  }
  function fromOklab([L, a, b]) {
    const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
    const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
    const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
    return [toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)];
  }
  function mixLab(a, b, t) { return [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t); }
  function rampLUT(stops, n = 256) {
    const labs = stops.map((h) => oklab(hexRgb(h)));
    const out = [];
    for (let i = 0; i < n; i++) {
      const x = i / (n - 1) * (labs.length - 1);
      const k = Math.min(labs.length - 2, Math.floor(x));
      out.push(fromOklab(mixLab(labs[k], labs[k + 1], x - k)));
    }
    return out;
  }
  let palette = null;
  function buildPalette() {
    const neg = [cssVar("--div-neg-2"), cssVar("--div-neg-1"), cssVar("--div-mid")];
    const pos = [cssVar("--div-mid"), cssVar("--div-pos-1"), cssVar("--div-pos-2")];
    palette = {
      div: rampLUT([...neg, ...pos.slice(1)], 257),
      seq: rampLUT(["#cde2fb", "#6da7ec", "#256abf", "#0d366b"], 256),
      seqDark: rampLUT(["#184f95", "#3987e5", "#9ec5f4", "#e6f0fc"], 256),
      surface: hexRgb(cssVar("--surface")),
      sea: hexRgb(cssVar("--sea")),
      s1: cssVar("--s1"), s2: cssVar("--s2"), s3: cssVar("--s3"),
      muted: cssVar("--muted"), rule: cssVar("--rule"), axis: cssVar("--axis"),
      ink: cssVar("--ink"), ink2: cssVar("--ink-2"), coast: cssVar("--coast"),
      dark: document.documentElement.dataset.theme === "dark" ||
        (document.documentElement.dataset.theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches),
    };
  }
  function divColor(v, lim, invert) {
    let t = Math.max(-1, Math.min(1, v / lim));
    if (invert) t = -t;
    return palette.div[Math.round((t + 1) / 2 * 256)];
  }
  function fade(rgb, amt) {
    const s = palette.sea;
    return rgb.map((c, i) => Math.round(c + (s[i] - c) * amt));
  }
  const rgbStr = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
  const VERDICT = {
    1: { label: "Detected; parametric test agrees", color: () => palette.s1 },
    2: { label: "Detected; parametric test disagrees", color: () => palette.s3 },
    3: { label: "Naive test only (likely false alarm)", color: () => palette.s2 },
    4: { label: "Not yet detectable", color: () => palette.axis },
    5: { label: "No trend at this precision", color: () => palette.rule },
    6: { label: "Excluded: months missing", color: () => palette.muted },
  };

  // ------------------------------------------------------------------ data
  async function getJSON(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r.json();
  }
  async function loadScene(id) {
    if (state.cache[id]) return state.cache[id];
    const sc = await getJSON(`data/${id}.json`);
    const txt = await (await fetch(`data/${sc.series.file}`)).text();
    const bin = atob(txt.trim());
    const bytes = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
    const entry = { sc, series: new Int16Array(bytes.buffer) };
    state.cache[id] = entry;
    return entry;
  }
  function cellSeries(i) {
    const { n, scale } = state.sc.series;
    const raw = state.series.subarray(i * n, (i + 1) * n);
    const out = new Float64Array(n);
    for (let k = 0; k < n; k++) out[k] = raw[k] === -32768 ? NaN : raw[k] * scale;
    return out;
  }
  function seriesTimes(sc) {
    const { n, start, kind } = sc.series;
    return Array.from({ length: n }, (_, k) => kind === "monthly" ? start + k / 12 : start + 0.5 + k);
  }
  function annualFrom(t, y) {
    const by = new Map();
    t.forEach((tt, k) => {
      const yr = Math.floor(tt);
      if (!by.has(yr)) by.set(yr, []);
      by.get(yr).push(y[k]);
    });
    const years = [], vals = [];
    for (const [yr, arr] of by) {
      if (arr.length === 12 || state.sc.series.kind === "annual") {
        years.push(yr);
        vals.push(arr.reduce((a, b) => a + b, 0) / arr.length);
      }
    }
    return { years, vals };
  }

  // ------------------------------------------------------------------ map
  const map = { canvas: null, ctx: null, W: 0, H: 0, geom: null, drag: null, boxMode: false };
  function geometry(sc) {
    const g = sc.grid;
    let lon0 = g.lon[0] - g.dlon / 2, lon1 = g.lon[g.nx - 1] + g.dlon / 2;
    let lat0 = g.lat[0] - g.dlat / 2, lat1 = g.lat[g.ny - 1] + g.dlat / 2;
    if (sc.region === "global") { lon0 = -180; lon1 = 180; lat0 = -90; lat1 = 90; }
    const k = sc.region === "global" ? 1 : Math.cos((lat0 + lat1) / 2 * Math.PI / 180);
    return { lon0, lon1, lat0, lat1, aspect: (lat1 - lat0) / ((lon1 - lon0) * k) };
  }
  const X = (lon) => (lon - map.geom.lon0) / (map.geom.lon1 - map.geom.lon0) * map.W;
  const Y = (lat) => (map.geom.lat1 - lat) / (map.geom.lat1 - map.geom.lat0) * map.H;
  const LON = (x) => map.geom.lon0 + x / map.W * (map.geom.lon1 - map.geom.lon0);
  const LAT = (y) => map.geom.lat1 - y / map.H * (map.geom.lat1 - map.geom.lat0);

  function layerValue(i) {
    const c = state.sc.cells, st = c.status[i];
    switch (state.layer) {
      case "trend": return { v: c.sen[i], strong: st === 1 || st === 2 };
      case "naive": return { v: c.sen[i], strong: c.p_naive[i] !== null && c.p_naive[i] < 0.05 };
      case "detect": return { v: c.mdt[i] };
      case "steps": {
        const s = state.sc.steps[state.step];
        return s ? { v: s.step[i], strong: s.flag[i] === 1 } : { v: null };
      }
      case "truth": return { v: state.sc.truth ? state.sc.truth.slope[i] : null, strong: true };
      default: return { v: null };
    }
  }
  function layerLimit() {
    const sc = state.sc, c = sc.cells;
    let arr;
    if (state.layer === "detect") arr = c.mdt;
    else if (state.layer === "steps") arr = sc.steps[state.step] ? sc.steps[state.step].step : [];
    else if (state.layer === "truth") arr = sc.truth ? sc.truth.slope : [];
    else arr = c.sen;
    const vals = arr.filter((v, i) => v !== null && Number.isFinite(v) && c.status[i] !== 0 && c.status[i] !== 6)
      .map(Math.abs).sort((a, b) => a - b);
    if (!vals.length) return 1;
    const q = vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.98))] || vals[vals.length - 1] || 1;
    const p = Math.pow(10, Math.floor(Math.log10(q)));
    return Math.ceil(q / p * 2) / 2 * p;
  }

  function drawMap() {
    const sc = state.sc;
    if (!sc) return;
    const box = map.canvas.parentElement;
    const W = Math.max(280, box.clientWidth);
    map.geom = geometry(sc);
    const H = Math.round(W * map.geom.aspect);
    const dpr = window.devicePixelRatio || 1;
    map.canvas.width = Math.round(W * dpr);
    map.canvas.height = Math.round(H * dpr);
    map.canvas.style.height = H + "px";
    map.W = W; map.H = H;
    const ctx = map.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = rgbStr(palette.sea);
    ctx.fillRect(0, 0, W, H);
    const g = sc.grid, c = sc.cells;
    const lim = layerLimit();
    map.lim = lim;
    const invert = WATER_VARS.has(sc.var) && state.layer !== "detect";
    for (let j = 0; j < g.ny; j++) {
      const y0 = Y(g.lat[j] + g.dlat / 2), y1 = Y(g.lat[j] - g.dlat / 2);
      for (let i = 0; i < g.nx; i++) {
        const k = j * g.nx + i, st = c.status[k];
        if (st === 0) continue;
        const x0 = X(g.lon[i] - g.dlon / 2), x1 = X(g.lon[i] + g.dlon / 2);
        let col;
        if (st === 6) col = palette.muted;
        else if (state.layer === "verdict") col = VERDICT[st].color();
        else {
          const { v, strong } = layerValue(k);
          if (v === null || !Number.isFinite(v)) continue;
          if (state.layer === "detect") {
            const lut = palette.dark ? palette.seqDark : palette.seq;
            col = rgbStr(lut[Math.min(255, Math.round(Math.abs(v) / lim * 255))]);
          } else {
            const rgb = divColor(v, lim, invert);
            col = rgbStr(strong ? rgb : fade(rgb, 0.72));
          }
        }
        ctx.fillStyle = col;
        ctx.fillRect(x0, y0, x1 - x0 + 0.6, y1 - y0 + 0.6);
      }
    }
    drawLines(state.geo.land, palette.coast, 0.8);
    if (sc.region !== "global") {
      drawLines(state.geo.borders, palette.coast, 0.6, [3, 3]);
      drawLines(state.geo.focus.rings, palette.ink, 1.6);
      ctx.font = "11px " + cssVar("--font-body");
      for (const p of PLACES) {
        const x = X(p.lon), y = Y(p.lat);
        ctx.fillStyle = palette.ink;
        ctx.beginPath(); ctx.arc(x, y, 3.5, 0, 2 * Math.PI); ctx.fill();
        ctx.strokeStyle = rgbStr(palette.surface); ctx.lineWidth = 1.5; ctx.stroke();
        ctx.lineWidth = 3; ctx.strokeStyle = rgbStr(palette.surface);
        ctx.textAlign = p.left ? "right" : "left";
        const lx = p.left ? x - 6 : x + 6;
        ctx.strokeText(p.name, lx, y + 4);
        ctx.fillText(p.name, lx, y + 4);
        ctx.textAlign = "left";
      }
    }
    drawSelection();
    renderLegend(lim);
  }
  function drawLines(rings, color, width, dash) {
    const ctx = map.ctx;
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash || []);
    for (const r of rings) {
      ctx.beginPath();
      for (let k = 0; k < r.length; k++) {
        const [lo, la] = r[k];
        if (k === 0 || Math.abs(lo - r[k - 1][0]) > 180) ctx.moveTo(X(lo), Y(la)); else ctx.lineTo(X(lo), Y(la));
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  function drawSelection() {
    const ctx = map.ctx, g = state.sc.grid, sel = state.sel;
    ctx.strokeStyle = palette.ink; ctx.lineWidth = 2;
    if (sel && sel.type === "cell") {
      const j = Math.floor(sel.i / g.nx), i = sel.i % g.nx;
      const x0 = X(g.lon[i] - g.dlon / 2), x1 = X(g.lon[i] + g.dlon / 2);
      const y0 = Y(g.lat[j] + g.dlat / 2), y1 = Y(g.lat[j] - g.dlat / 2);
      ctx.strokeRect(x0 - 1, y0 - 1, x1 - x0 + 2, y1 - y0 + 2);
    }
    const b = map.drag && map.drag.moved ? map.drag : (sel && sel.type === "box" ? sel : null);
    if (b) {
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1), Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
      ctx.setLineDash([]);
    }
  }
  function cellAt(x, y) {
    const g = state.sc.grid;
    const lon = LON(x), lat = LAT(y);
    const i = Math.floor((lon - (g.lon[0] - g.dlon / 2)) / g.dlon);
    const j = Math.floor((lat - (g.lat[0] - g.dlat / 2)) / g.dlat);
    if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) return -1;
    return j * g.nx + i;
  }
  function pointer(e) {
    const r = map.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function onPointerDown(e) {
    if (e.pointerType !== "mouse" && !map.boxMode) return;
    const p = pointer(e);
    map.drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, moved: false };
    map.canvas.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e) {
    const p = pointer(e);
    if (map.drag) {
      map.drag.x1 = p.x; map.drag.y1 = p.y;
      if (Math.hypot(p.x - map.drag.x0, p.y - map.drag.y0) > 6) map.drag.moved = true;
      if (map.drag.moved) { drawMap(); hideTip(); return; }
    }
    showTip(p);
  }
  function onPointerUp(e) {
    const p = pointer(e);
    const d = map.drag;
    map.drag = null;
    if (d && d.moved) {
      selectBox(d);
    } else {
      const i = cellAt(p.x, p.y);
      if (i >= 0 && state.sc.cells.status[i] !== 0) { state.sel = { type: "cell", i }; renderSelection(); }
    }
    drawMap();
  }
  function hideTip() { $("#tip").hidden = true; }
  function showTip(p) {
    const i = cellAt(p.x, p.y), tip = $("#tip");
    const c = state.sc.cells;
    if (i < 0 || c.status[i] === 0) { tip.hidden = true; return; }
    const g = state.sc.grid;
    const lat = g.lat[Math.floor(i / g.nx)], lon = g.lon[i % g.nx];
    let html = `<div class="num">${ll(lat, lon)}</div>`;
    if (c.status[i] === 6) html += `<div>${VERDICT[6].label}</div>`;
    else if (state.layer === "detect") html += `<div>Detectable: ±${fmt(c.mdt[i])} ${esc(perDecade(state.sc))}</div>`;
    else if (state.layer === "steps" && state.sc.steps[state.step]) {
      const s = state.sc.steps[state.step];
      html += `<div>Step: ${signed(s.step[i])} ${esc(unitLabel(state.sc.units))} (p ${fmtP(s.p_step[i])})</div>`;
    } else {
      html += `<div><b>${signed(c.sen[i])}</b> ${esc(perDecade(state.sc))}</div>`;
      html += `<div class="muted">${VERDICT[c.status[i]].label}</div>`;
    }
    tip.innerHTML = html;
    tip.hidden = false;
    const bx = map.canvas.parentElement.clientWidth;
    tip.style.left = Math.min(p.x + 14, bx - 200) + "px";
    tip.style.top = (p.y + 14) + "px";
  }
  function selectBox(d) {
    const g = state.sc.grid, c = state.sc.cells;
    const lonA = LON(Math.min(d.x0, d.x1)), lonB = LON(Math.max(d.x0, d.x1));
    const latA = LAT(Math.max(d.y0, d.y1)), latB = LAT(Math.min(d.y0, d.y1));
    const cells = [];
    for (let j = 0; j < g.ny; j++) {
      if (g.lat[j] < latA || g.lat[j] > latB) continue;
      for (let i = 0; i < g.nx; i++) {
        if (g.lon[i] < lonA || g.lon[i] > lonB) continue;
        const k = j * g.nx + i;
        if (c.status[k] >= 1 && c.status[k] <= 5) cells.push(k);
      }
    }
    state.sel = { type: "box", x0: d.x0, y0: d.y0, x1: d.x1, y1: d.y1, cells, bounds: [lonA, latA, lonB, latB] };
    renderSelection();
  }

  // ------------------------------------------------------------------ legend
  function renderLegend(lim) {
    const sc = state.sc, el = $("#legend");
    const invert = WATER_VARS.has(sc.var);
    if (state.layer === "verdict") {
      el.innerHTML = Object.entries(VERDICT).map(([k, v]) =>
        `<span><i class="sw" style="background:${v.color()}"></i>${v.label} <span class="num muted">${countStatus(+k)}</span></span>`).join("");
      return;
    }
    if (state.layer === "detect") {
      const lut = palette.dark ? palette.seqDark : palette.seq;
      el.innerHTML = `<span>Smallest trend this record can detect (90% power), ${esc(perDecade(sc))}</span>
        <span><span class="ramp" style="display:block;background:linear-gradient(90deg,${rgbStr(lut[0])},${rgbStr(lut[128])},${rgbStr(lut[255])})"></span>
        <span class="ticks"><span>0</span><span>${fmt(lim / 2)}</span><span>≥${fmt(lim)}</span></span></span>`;
      return;
    }
    const left = invert ? "increase" : "decrease", right = invert ? "decrease" : "increase";
    const stops = [0, 64, 128, 192, 256].map((k) => rgbStr(palette.div[k]));
    const unit = state.layer === "steps" ? unitLabel(sc.units) : perDecade(sc);
    const what = state.layer === "steps" ? "Step at the transition" : state.layer === "truth" ? "Planted trend" : "Sen slope";
    let note = "";
    if (state.layer === "trend") note = `Full colour: significant after FDR (α<sub>FDR</sub>=${sc.alpha_fdr}). Faded: not significant.`;
    if (state.layer === "naive") note = "Full colour: p&lt;0.05 with no autocorrelation or multiple-testing correction.";
    if (state.layer === "steps") note = "Full colour: step significant after FDR.";
    el.innerHTML = `<span>${what}, ${esc(unit)}</span>
      <span><span class="ramp" style="display:block;background:linear-gradient(90deg,${stops.join(",")})"></span>
      <span class="ticks"><span>${signed(invert ? lim : -lim)}</span><span>0</span><span>${signed(invert ? -lim : lim)}</span></span></span>
      <span class="muted">${left} ← → ${right}</span><span class="muted">${note}</span>`;
  }
  function countStatus(k) { return state.sc.cells.status.filter((s) => s === k).length.toLocaleString("en-US"); }

  // ------------------------------------------------------------------ charts
  const svgNS = "http://www.w3.org/2000/svg";
  function niceTicks(lo, hi, n = 4) {
    const span = hi - lo || 1;
    const step0 = Math.pow(10, Math.floor(Math.log10(span / n)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * step0).find((s) => span / s <= n) || step0 * 10;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-12; v += step) out.push(+v.toFixed(10));
    return out;
  }
  /** Time-series chart with Sen trend, CI fan and transition markers. Hover shows values. */
  function seriesChart(host, opts) {
    const W = Math.max(260, host.clientWidth || 340), H = opts.height || 190;
    const m = { l: 44, r: 10, t: 10, b: 24 };
    const t = opts.t, y = opts.y;
    const fin = y.filter(Number.isFinite);
    if (!fin.length) { host.textContent = "No data"; return; }
    let lo = Math.min(...fin), hi = Math.max(...fin);
    const pad = (hi - lo) * 0.08 || 1;
    lo -= pad; hi += pad;
    const t0 = t[0], t1 = t[t.length - 1] + (opts.annual ? 1 : 1 / 12);
    const sx = (v) => m.l + (v - t0) / (t1 - t0) * (W - m.l - m.r);
    const sy = (v) => m.t + (hi - v) / (hi - lo) * (H - m.t - m.b);
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label || "time series")}">`;
    for (const v of niceTicks(lo, hi)) {
      s += `<line x1="${m.l}" x2="${W - m.r}" y1="${sy(v)}" y2="${sy(v)}" stroke="var(--grid)" stroke-width="1"/>`;
      s += `<text x="${m.l - 6}" y="${sy(v) + 4}" text-anchor="end">${fmt(v, 2)}</text>`;
    }
    if (lo < 0 && hi > 0) s += `<line x1="${m.l}" x2="${W - m.r}" y1="${sy(0)}" y2="${sy(0)}" stroke="var(--axis)" stroke-width="1"/>`;
    for (const yr of niceTicks(t0, t1, 5)) {
      s += `<text x="${sx(yr)}" y="${H - 6}" text-anchor="middle">${Math.round(yr)}</text>`;
    }
    for (const mk of opts.markers || []) {
      const x = sx(mk.t);
      s += `<line x1="${x}" x2="${x}" y1="${m.t}" y2="${H - m.b}" stroke="var(--s2)" stroke-dasharray="3 3" stroke-width="1.5"/>`;
      s += `<text class="lbl" x="${x + 4}" y="${m.t + 10}">${esc(mk.short)}</text>`;
    }
    const path = (ys, xs) => {
      let d = "", on = false;
      ys.forEach((v, k) => {
        if (!Number.isFinite(v)) { on = false; return; }
        d += (on ? "L" : "M") + sx(xs[k] + (opts.annual ? 0 : 1 / 24)).toFixed(1) + "," + sy(v).toFixed(1);
        on = true;
      });
      return d;
    };
    if (!opts.annual && opts.ann) {
      s += `<path d="${path(y, t)}" fill="none" stroke="var(--axis)" stroke-width="1"/>`;
      s += `<path d="${path(opts.ann.vals, opts.ann.years.map((v) => v + 0.5 - 1 / 24))}" fill="none" stroke="var(--s1)" stroke-width="2"/>`;
    } else {
      s += `<path d="${path(y, t)}" fill="none" stroke="var(--s1)" stroke-width="2"/>`;
    }
    if (opts.trend && Number.isFinite(opts.trend.sen)) {
      const tm = (t0 + t1) / 2, ym = opts.trend.intercept + opts.trend.sen * tm;
      const line = (b, dash, w) => `<line x1="${sx(t0)}" y1="${sy(ym + b * (t0 - tm))}" x2="${sx(t1)}" y2="${sy(ym + b * (t1 - tm))}" stroke="var(--ink)" stroke-width="${w}" ${dash ? 'stroke-dasharray="4 3" opacity="0.6"' : ""}/>`;
      if (Number.isFinite(opts.trend.lo)) s += line(opts.trend.lo, true, 1) + line(opts.trend.hi, true, 1);
      s += line(opts.trend.sen, false, 2);
    }
    s += `<line class="xh" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" stroke="var(--muted)" stroke-width="1" visibility="hidden"/>`;
    s += `<rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent" class="hit"/></svg>`;
    s += `<div class="tip" hidden></div>`;
    host.innerHTML = s;
    host.style.position = "relative";
    const svg = host.querySelector("svg"), xh = host.querySelector(".xh"), tip = host.querySelector(".tip");
    const src = opts.annual || !opts.ann ? { xs: t, ys: y, ann: opts.annual } : { xs: opts.ann.years.map((v) => v + 0.5 - 1 / 24), ys: opts.ann.vals, ann: true };
    host.querySelector(".hit").addEventListener("pointermove", (e) => {
      const r = svg.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width * W;
      const tv = t0 + (px - m.l) / (W - m.l - m.r) * (t1 - t0);
      let best = 0;
      src.xs.forEach((v, k) => { if (Math.abs(v - tv) < Math.abs(src.xs[best] - tv)) best = k; });
      const x = sx(src.xs[best] + (opts.annual ? 0 : 1 / 24));
      xh.setAttribute("x1", x); xh.setAttribute("x2", x); xh.setAttribute("visibility", "visible");
      const yr = Math.floor(src.xs[best]);
      tip.innerHTML = `<span class="num">${yr}${src.ann ? "" : ""}: ${signed(src.ys[best])} ${esc(opts.unit || "")}</span>`;
      tip.hidden = false;
      tip.style.left = Math.min(x / W * r.width + 10, r.width - 150) + "px";
      tip.style.top = "6px";
    });
    host.querySelector(".hit").addEventListener("pointerleave", () => { xh.setAttribute("visibility", "hidden"); tip.hidden = true; });
  }

  /** Every start/end window of 10+ years: OLS slope (colour) and Santer p<0.05 (dot). */
  function triangle(host, years, vals, unit, invert) {
    const n = years.length;
    const W = Math.max(260, host.clientWidth || 340), m = { l: 40, r: 8, t: 8, b: 30 };
    const cs = Math.max(3, Math.floor((W - m.l - m.r) / n));
    const H = m.t + m.b + cs * n;
    const cells = [];
    let lim = 0;
    for (let a = 0; a < n; a++) {
      for (let b = a + 9; b < n; b++) {
        const xs = years.slice(a, b + 1).map((v) => v + 0.5), ys = vals.slice(a, b + 1);
        if (ys.some((v) => !Number.isFinite(v))) continue;
        const o = S.olsAr1(ys, xs);
        cells.push({ a, b, slope: o.ols * 10, p: o.p });
        lim = Math.max(lim, Math.abs(o.ols * 10));
      }
    }
    if (!cells.length) { host.textContent = "Need at least 10 years."; return; }
    lim = lim || 1;
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="trend for every start and end year">`;
    for (const c of cells) {
      const x = m.l + c.a * cs, y = m.t + (n - 1 - c.b) * cs;
      const col = rgbStr(divColor(c.slope, lim, invert));
      s += `<rect x="${x}" y="${y}" width="${cs}" height="${cs}" fill="${col}" data-a="${c.a}" data-b="${c.b}" data-s="${c.slope}" data-p="${c.p}"/>`;
      if (c.p < 0.05 && cs >= 5) s += `<circle cx="${x + cs / 2}" cy="${y + cs / 2}" r="${Math.max(1, cs / 6)}" fill="var(--surface)" pointer-events="none"/>`;
    }
    const full = cells.find((c) => c.a === 0 && c.b === n - 1);
    if (full) s += `<rect x="${m.l}" y="${m.t}" width="${cs}" height="${cs}" fill="none" stroke="var(--ink)" stroke-width="2" pointer-events="none"/>`;
    for (let k = 0; k < n; k += 10) {
      s += `<text x="${m.l + k * cs + cs / 2}" y="${H - 14}" text-anchor="middle">${years[k]}</text>`;
      s += `<text x="${m.l - 4}" y="${m.t + (n - 1 - k) * cs + cs / 2 + 4}" text-anchor="end">${years[k]}</text>`;
    }
    s += `<text class="lbl" x="${m.l}" y="${H - 1}">start year →</text></svg><div class="tip" hidden></div>`;
    host.innerHTML = s;
    host.style.position = "relative";
    const tip = host.querySelector(".tip"), svg = host.querySelector("svg");
    svg.addEventListener("pointermove", (e) => {
      const r = e.target;
      if (!r.dataset || r.dataset.a === undefined) { tip.hidden = true; return; }
      const a = +r.dataset.a, b = +r.dataset.b;
      tip.innerHTML = `<span class="num">${years[a]}–${years[b]}: ${signed(+r.dataset.s)} ${esc(unit)} · p ${fmtP(+r.dataset.p)}</span>`;
      tip.hidden = false;
      const br = svg.getBoundingClientRect();
      tip.style.left = Math.min(e.clientX - br.left + 10, br.width - 190) + "px";
      tip.style.top = Math.max(0, e.clientY - br.top - 34) + "px";
    });
    svg.addEventListener("pointerleave", () => { tip.hidden = true; });
  }

  // ------------------------------------------------------------------ inspector
  function verdictPill(st) {
    const v = VERDICT[st] || { label: "No data", color: () => palette.rule };
    return `<span class="pill"><i style="background:${v.color()}"></i>${v.label}</span>`;
  }
  function statsList(st, sc, extra = "") {
    const pd = perDecade(sc);
    return `<dl class="kv">
      <dt>Sen slope, 95% CI</dt><dd>[${fmt(st.lo)}, ${fmt(st.hi)}]</dd>
      <dt>p, naive Mann-Kendall</dt><dd>${fmtP(st.pNaive)}</dd>
      <dt>p, autocorrelation-corrected MK</dt><dd>${fmtP(st.pMk)}</dd>
      <dt>p, OLS + AR(1) (Santer)</dt><dd>${fmtP(st.pOls)}</dd>
      <div class="sep"></div>
      <dt>Lag-1 autocorrelation φ</dt><dd>${fmt(st.phi, 2)}</dd>
      <dt>Noise σ (${esc(unitLabel(sc.units))})</dt><dd>${fmt(st.sigma)}</dd>
      <dt>Smallest detectable trend</dt><dd>±${fmt(st.mdt)}</dd>
      <dt>Years to detect a trend this size</dt><dd>${st.nstar === null || st.nstar === Infinity ? "∞" : fmt(st.nstar, 2)} (have ${fmt(st.years, 3)})</dd>
      ${extra}
    </dl><p class="small muted">Trends and detectable sizes in ${esc(pd)}.</p>`;
  }
  function stepRows(i) {
    const sc = state.sc;
    if (!sc.steps.length) return "";
    return `<div class="sep"></div>` + sc.steps.map((s) =>
      `<dt>${esc(s.label.split(":")[0])} step ${s.flag[i] ? '<b class="yes">flagged</b>' : ""}</dt><dd>${signed(s.step[i])} (p ${fmtP(s.p_step[i])})</dd>
       <dt>Trend if the step is allowed for</dt><dd>${signed(s.trend_with_step[i])}</dd>`).join("");
  }
  function markers(sc) {
    return sc.steps.map((s) => ({ t: s.t_break, short: s.label.split(":")[0] }));
  }
  function renderSelection() {
    const sc = state.sc, el = $("#inspector"), sel = state.sel;
    if (!sel) {
      el.innerHTML = `<p class="eyebrow">Inspector</p><p class="muted">Click a cell on the map, or drag a box to average a region.</p>`;
      renderTriangle(null);
      return;
    }
    const tt = seriesTimes(sc);
    if (sel.type === "cell") {
      const c = sc.cells, i = sel.i, g = sc.grid;
      const lat = g.lat[Math.floor(i / g.nx)], lon = g.lon[i % g.nx];
      if (c.status[i] === 6 || c.sen[i] === null) {
        el.innerHTML = `<p class="eyebrow">Cell ${ll(lat, lon)}</p>${verdictPill(c.status[i])}<p class="muted">This cell is missing some months, so it was left out rather than gap-filled.</p>`;
        renderTriangle(null);
        return;
      }
      const y = cellSeries(i);
      const st = { lo: c.sen_lo[i], hi: c.sen_hi[i], pNaive: c.p_naive[i], pMk: c.p_mk[i], pOls: c.p_ols[i], phi: c.phi[i],
        sigma: c.sigma[i], mdt: c.mdt[i], nstar: c.nstar[i], years: sc.period.years };
      const sen = c.sen[i] / 10;
      const yv = Array.from(y);
      const intercept = S.median(yv.map((v, k) => v - sen * tt[k]).filter(Number.isFinite));
      el.innerHTML = `<p class="eyebrow">Cell ${ll(lat, lon)}</p>${verdictPill(c.status[i])}
        <div><span class="big">${signed(c.sen[i])}</span> <span class="muted">${esc(perDecade(sc))}</span></div>
        <div id="cellchart"></div>
        ${statsList(st, sc, `<dt>Mean value</dt><dd>${fmt(c.clim_mean[i])} ${esc(unitLabel(sc.units))}</dd>
          <dt>p, Hamed-Rao as published</dt><dd>${fmtP(c.p_hr_empirical[i])}</dd>${stepRows(i)}`)}`;
      const ann = sc.series.kind === "monthly" ? annualFrom(tt, yv) : null;
      seriesChart($("#cellchart"), { t: tt, y: yv, ann, annual: sc.series.kind === "annual", unit: unitLabel(sc.units),
        trend: { sen, lo: c.sen_lo[i] / 10, hi: c.sen_hi[i] / 10, intercept: intercept + sen * 0 }, markers: markers(sc),
        label: "anomaly series for the selected cell" });
      const a = ann || { years: tt.map(Math.floor), vals: yv };
      renderTriangle({ years: a.years, vals: a.vals, title: `cell ${ll(lat, lon)}` });
    } else if (sel.type === "box") {
      if (!sel.cells.length) {
        el.innerHTML = `<p class="eyebrow">Selected box</p><p class="muted">No valid cells inside. Drag a larger box.</p>`;
        return;
      }
      const g = sc.grid, n = sc.series.n;
      const acc = new Float64Array(n), wsum = new Float64Array(n);
      for (const k of sel.cells) {
        const w = Math.cos(g.lat[Math.floor(k / g.nx)] * Math.PI / 180);
        const y = cellSeries(k);
        for (let q = 0; q < n; q++) if (Number.isFinite(y[q])) { acc[q] += w * y[q]; wsum[q] += w; }
      }
      const y = Array.from(acc, (v, q) => wsum[q] ? v / wsum[q] : NaN);
      const r = S.analyze(y, tt);
      const [lonA, latA, lonB, latB] = sel.bounds;
      el.innerHTML = `<p class="eyebrow">Box ${ll(latA, lonA)} to ${ll(latB, lonB)}</p>
        <p class="small muted">${sel.cells.length} cells, cos-latitude weighted, computed in your browser from ${sc.series.kind} anomalies.</p>
        <div><span class="big">${signed(r.sen * 10)}</span> <span class="muted">${esc(perDecade(sc))}</span></div>
        ${r.pMk < 0.05 ? verdictPill(r.pOls < 0.05 ? 1 : 2) : verdictPill(r.nstar > r.years ? 4 : 5)}
        <div id="cellchart"></div>
        ${statsList({ lo: r.senLo * 10, hi: r.senHi * 10, pNaive: r.pNaive, pMk: r.pMk, pOls: r.pOls, phi: r.phi,
          sigma: r.sigma, mdt: r.mdt * 10, nstar: r.nstar, years: r.years }, sc)}`;
      const ann = sc.series.kind === "monthly" ? annualFrom(tt, y) : null;
      seriesChart($("#cellchart"), { t: tt, y, ann, annual: sc.series.kind === "annual", unit: unitLabel(sc.units),
        trend: { sen: r.sen, lo: r.senLo, hi: r.senHi, intercept: r.intercept }, markers: markers(sc), label: "box-mean anomaly series" });
      const a = ann || { years: tt.map(Math.floor), vals: y };
      renderTriangle({ years: a.years, vals: a.vals, title: "selected box" });
    }
  }
  function renderTriangle(sel) {
    const host = $("#tri"), sc = state.sc;
    if (!sel) {
      const rm = sc.region_means[0];
      if (!rm) { host.textContent = ""; return; }
      sel = { years: rm.annual_years, vals: rm.annual, title: rm.name, unit: rm.units };
    }
    $("#tri-title").textContent = sel.title;
    triangle(host, sel.years, sel.vals, (sel.unit ? unitLabel(sel.unit) + " " : perDecade(sc).replace("per decade", "")) + "per decade",
      WATER_VARS.has(sc.var));
  }

  // ------------------------------------------------------------------ panels
  function renderSummary() {
    const sc = state.sc, k = sc.counts, el = $("#summary");
    const rm = sc.region_means[0];
    let head = `<b>${esc(sc.long_name)}</b> from ${esc(sc.product_name)}, ${esc(sc.region_name)}, ${sc.period.start.slice(0, 4)}–${sc.period.end.slice(0, 4)}. `;
    head += `<strong>${k.fdr.toLocaleString("en-US")}</strong> of ${k.valid.toLocaleString("en-US")} cells show a trend that survives the false discovery rate test`;
    head += k.fdr ? ` (${k.fdr_up.toLocaleString("en-US")} up, ${k.fdr_down.toLocaleString("en-US")} down)` : "";
    head += `; a naive test would have flagged <strong>${k.naive.toLocaleString("en-US")}</strong>.`;
    if (rm) {
      const s = rm.stats;
      head += ` ${esc(rm.name)}: <strong>${signed(s.sen)}</strong> ${esc(unitLabel(rm.units))} per decade (95% CI ${fmt(s.sen_lo)} to ${fmt(s.sen_hi)}, corrected p ${fmtP(s.p_mk)}).`;
    }
    const chips = [
      [k.valid, "cells tested"], [k.naive, "naive p<0.05"], [k.fdr, "significant after FDR"],
      [k.robust, "and parametric agrees"], [k.not_yet, "not yet detectable"],
    ];
    if (k.gappy) chips.push([k.gappy, "excluded, months missing"]);
    if (sc.steps.length) chips.push([k.step_flagged, "cell-steps at known transitions"]);
    const warns = [...(sc.data_warnings || []).map((w) => ({ w, sev: "critical" })),
      ...(sc.notes || []).map((w) => ({ w, sev: "" })),
      ...(sc.transitions || []).filter((tr) => !tr.verified).map((tr) => ({ w: `${tr.label}. Not tested: date unconfirmed.`, sev: "" }))];
    el.innerHTML = `<p class="headline">${head}</p>
      <div class="chips">${chips.map(([v, l]) => `<div class="chip"><b>${(+v).toLocaleString("en-US")}</b><span>${l}</span></div>`).join("")}</div>
      ${warns.length ? `<div class="warnings">${warns.map(({ w, sev }) => `<div class="warn ${sev}"><span class="icon" aria-hidden="true">!</span><p>${esc(w)}</p></div>`).join("")}</div>` : ""}`;
  }

  function renderRegionMeans() {
    const sc = state.sc, el = $("#rmeans");
    el.innerHTML = sc.region_means.map((rm, k) => {
      const s = rm.stats;
      const steps = s.steps.map((st) => `<dt>${esc(st.label.split(":")[0])} step</dt><dd>${signed(st.step)} (p ${fmtP(st.p_step)})</dd>`).join("");
      return `<div class="rm"><h3>${esc(rm.name)}</h3>
        <div><span class="big">${signed(s.sen)}</span> <span class="muted">${esc(unitLabel(rm.units))} per decade · mean ${fmt(rm.raw_mean)} ${esc(unitLabel(rm.units))}</span></div>
        <div id="rmchart${k}"></div>
        <dl class="kv"><dt>95% CI</dt><dd>[${fmt(s.sen_lo)}, ${fmt(s.sen_hi)}]</dd>
        <dt>p naive → corrected → OLS-AR(1)</dt><dd>${fmtP(s.p_naive)} → ${fmtP(s.p_mk)} → ${fmtP(s.p_ols_ar1)}</dd>
        <dt>φ · detectable trend · years needed</dt><dd>${fmt(s.phi, 2)} · ±${fmt(s.mdt)} · ${fmt(s.nstar, 2)}</dd>${steps}</dl></div>`;
    }).join("") || `<p class="muted">No region mean for this scene.</p>`;
    sc.region_means.forEach((rm, k) => {
      const t = rm.monthly.map((_, q) => rm.monthly_start + q / 12);
      const y = rm.monthly.map((v) => v === null ? NaN : v);
      const s = rm.stats;
      const tm = t.reduce((a, b) => a + b, 0) / t.length;
      const intercept = S.median(y.map((v, q) => v - s.sen / 10 * t[q]).filter(Number.isFinite));
      seriesChart($("#rmchart" + k), { t, y, ann: { years: rm.annual_years, vals: rm.annual }, unit: unitLabel(rm.units), height: 150,
        trend: { sen: s.sen / 10, lo: s.sen_lo / 10, hi: s.sen_hi / 10, intercept: intercept + 0 * tm }, markers: markers(sc),
        label: rm.name + " anomalies" });
    });
  }

  function renderCase() {
    const sc = state.sc, el = $("#case");
    const fn = CASES[sc.case];
    el.innerHTML = fn ? fn(sc) : `<p class="muted">No case notes for this scene.</p>`;
  }

  function renderCompare() {
    const el = $("#compare");
    const comps = (state.index.comparisons || []).filter((c) => c.a === state.sc.id || c.b === state.sc.id);
    if (!comps.length) { el.hidden = true; return; }
    el.hidden = false;
    const c = comps[0];
    const a = c.region_trend_a, b = c.region_trend_b;
    $("#compare-body").innerHTML = `<p class="prose">The same question asked of a model (MERRA-2) and of satellites (GPM IMERG), on the same 0.5° × 0.625° grid, 2001–2025.</p>
      <div class="cmp">
        <div class="chip"><b>${signed(a.sen)}</b><span>MERRA-2 Mongolia mean, mm/day per decade (p ${fmtP(a.p_mk)})</span></div>
        <div class="chip"><b>${signed(b.sen)}</b><span>IMERG Mongolia mean, mm/day per decade (p ${fmtP(b.p_mk)})</span></div>
        <div class="chip"><b>${fmt(c.region_anomaly_correlation, 2)}</b><span>correlation of monthly anomalies</span></div>
        <div class="chip"><b>${Math.round(100 * c.sign_agreement_all)}%</b><span>cells where the two trends share a sign</span></div>
        <div class="chip"><b>${c.cells_significant_either}</b><span>cells significant in either</span></div>
        <div class="chip"><b>${c.both_significant_same_sign} / ${c.both_significant_opposite}</b><span>significant in both: same / opposite sign</span></div>
      </div>
      <div class="seg">${[c.a, c.b].map((id) => `<button type="button" data-go="${id}" aria-pressed="${id === state.sc.id}">${esc(sceneTitle(id))}</button>`).join("")}</div>`;
  }

  function renderScreen() {
    const sec = $("#screen");
    if (!state.screen) { sec.hidden = true; return; }
    sec.hidden = false;
    const f = state.screenFilter;
    const rows = state.screen.rows.filter((r) => f === "all" || (f === "fdr" && r.fdr) || r.kind === f);
    const sceneFor = (r) => (state.index.scenes.find((s) => s.region === "mongolia" && s.var === r.var && s.product === r.product && s.period.start.slice(0, 4) === r.start) || {}).id;
    $("#screen-meta").textContent = `${state.screen.n_variables} variables averaged over Mongolia. Variables that pass a variable-level FDR at 5% come first, then all are ordered by the size of the change relative to month-to-month noise. Variables are correlated, so read the ranking as a guide to where to look. Click a highlighted row to open its map.`;
    $("#screen-body").innerHTML = rows.map((r) => {
      const s = r.stats, id = sceneFor(r);
      return `<tr class="${id ? "link" : ""}" ${id ? `data-go="${id}"` : ""}>
        <td>${esc(r.long_name)} <span class="muted num">${esc(r.var)}</span></td>
        <td>${r.kind === "model" ? "MERRA-2 model" : "CERES satellites"}</td>
        <td class="n">${r.start}–2025</td>
        <td class="n">${signed(s.sen)} <span class="muted">${esc(unitLabel(r.units))}</span></td>
        <td class="n">[${fmt(s.sen_lo, 2)}, ${fmt(s.sen_hi, 2)}]</td>
        <td class="n">${fmt(r.change_sd, 2)}</td>
        <td class="n">${r.change_pct === null ? "–" : signed(r.change_pct, 2) + "%"}</td>
        <td class="n">${fmtP(s.p_naive)}</td><td class="n">${fmtP(s.p_mk)}</td>
        <td>${r.fdr ? '<span class="yes">✓ yes</span>' : '<span class="muted">no</span>'}</td>
        <td>${spark(r.annual)}</td></tr>`;
    }).join("");
  }
  function spark(vals) {
    const v = vals.map((x) => x === null ? NaN : x), f = v.filter(Number.isFinite);
    if (!f.length) return "";
    const lo = Math.min(...f), hi = Math.max(...f), W = 90, H = 22;
    const d = v.map((x, k) => Number.isFinite(x) ? `${k ? "L" : "M"}${(k / (v.length - 1) * W).toFixed(1)},${(H - 2 - (x - lo) / ((hi - lo) || 1) * (H - 4)).toFixed(1)}` : "").join("");
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${d}" fill="none" stroke="var(--s1)" stroke-width="1.5"/></svg>`;
  }

  function renderMethod() {
    const v = state.validation, el = $("#validation");
    if (!v) return;
    const keys = Object.keys(v.tests);
    el.innerHTML = `<table><thead><tr><th>Noise memory φ</th>${keys.map((k) => `<th class="n">${esc(v.tests[k])}</th>`).join("")}<th class="n">Sen CI coverage</th></tr></thead><tbody>
      ${v.rows.map((r) => `<tr><td class="num">${r.phi}</td>${keys.map((k) => `<td class="n">${(100 * r.size[k]).toFixed(1)}% <span class="muted">/ ${(100 * r.power_at_mdt[k]).toFixed(0)}%</span></td>`).join("")}<td class="n">${(100 * r.sen_ci_coverage).toFixed(0)}%</td></tr>`).join("")}
      </tbody></table>`;
    $("#validation-note").textContent = `Each cell: false-positive rate when there is no trend (target 5%) / detection rate when the trend equals the Weatherhead minimum detectable trend (target 90%). ${v.reps} simulated 45-year monthly records per row; Monte Carlo standard error ±${(100 * v.mc_standard_error_at_5pct).toFixed(1)} points at 5%.`;
    const syn = state.cache["synthetic-truth"];
    const tr = syn && syn.sc.truth;
    if (tr) {
      $("#truth-note").innerHTML = `On the known-truth field, <b>${Math.round(100 * tr.scores.naive.fdp)}%</b> of cells flagged by the naive map are false discoveries; after FDR it is <b>${Math.round(100 * tr.scores.fdr.fdp)}%</b> (target ≤ ${Math.round(100 * syn.sc.alpha_fdr)}%). The price is power: ${Math.round(100 * tr.scores.fdr.power)}% of truly trending cells are found, versus ${Math.round(100 * tr.scores.naive.power)}% by the naive map, and most misses are cells whose planted trend is below the detectable size.`;
    }
  }

  // ------------------------------------------------------------------ case files
  function rmStat(sc, key) { const r = sc.region_means.find((x) => x.key === key); return r && r.stats; }
  function stepOf(s, date) { return (s.steps || []).find((x) => x.label.startsWith(date)); }
  const CASES = {
    truth: (sc) => `<div class="prose"><p>This field is synthetic. One region in the north was given a warming trend and one in the south a cooling trend; everything else is noise with month-to-month memory (φ = 0.5) and spatial smoothing, like real climate fields.</p>
      <p>Switch between <b>Trend, naive p&lt;0.05</b> and <b>Trend, FDR-tested</b>: the naive map scatters significance across empty ocean. Open <b>Planted truth</b> to see what is really there. The Method section scores both maps.</p></div>`,
    "sea-ice": (sc) => {
      const ar = rmStat(sc, "arctic_area"), an = rmStat(sc, "antarctic_area");
      const st = stepOf(an, "2006-04");
      return `<div class="prose"><p><b>Same variable, opposite directions.</b> Arctic sea-ice area: ${signed(ar.sen)} million km² per decade (corrected p ${fmtP(ar.p_mk)}). Antarctic: ${signed(an.sen)} (corrected p ${fmtP(an.p_mk)}, naive p ${fmtP(an.p_naive)}, OLS-AR(1) p ${fmtP(an.p_ols_ar1)}).</p>
      <p>The Antarctic series has strong memory (φ ≈ ${fmt(an.phi, 2)}), so the naive test overstates confidence by many orders of magnitude, and the two honest tests disagree about whether the gain is significant at all.</p>
      <p><b>Source conflict.</b> MERRA-2 sea ice is a boundary condition taken from other analyses; its source changed in Jan 1982 and Apr 2006 (UCAR Climate Data Guide, citing Bosilovich et al. 2015).${st ? ` The Antarctic area jumps by ${signed(st.step)} million km² at the April 2006 switch (p ${fmtP(st.p_step)}); allowing for that step turns the trend to ${signed(st.trend_with_step)} per decade.` : ""} NSIDC's Sea Ice Index, the record built for this purpose, reported that the 2023 lows turned the long-term Antarctic annual trend from slightly positive to slightly negative. NSIDC governs for sea ice, so treat the MERRA-2 Antarctic gain as unconfirmed. A real expansion around 2006–2014 could also produce part of that step. The single check that settles it: run this tool on NSIDC G02135 monthly data.</p></div>`;
    },
    ozone: (sc) => {
      const flagged = sc.steps[0] ? sc.steps[0].flagged : 0;
      return `<div class="prose"><p><b>A data trap, found automatically.</b> NASA POWER marks total ozone below 200 DU as invalid. The Antarctic ozone hole lies exactly there, so ${sc.counts.gappy.toLocaleString("en-US")} cells lose their lowest months. The tool excludes those cells instead of computing a censored trend; they are the grey area around Antarctica.</p>
      <p>For the cells that remain, the global mean is a good lesson in autocorrelation: naive p ${fmtP(rmStat(sc, "globe").p_naive)}, corrected p ${fmtP(rmStat(sc, "globe").p_mk)}.</p>
      <p>The ozone input to MERRA-2 switched from SBUV to Aura OMI + MLS in October 2004. ${flagged ? `The step test finds a significant jump at that date in ${flagged.toLocaleString("en-US")} cells; open <b>Data-source steps</b>.` : "The step test finds no significant jump in total column ozone at that date."}</p></div>`;
    },
    "wet-dry": (sc) => {
      const g = rmStat(sc, "globe");
      return `<div class="prose"><p><b>One warming, two signs.</b> A warmer atmosphere holds more water, but over land the result is not simply "wet gets wetter, dry gets drier": Greve et al. (2014, Nature Geoscience) found only about 10.8% of land follows that pattern and 9.5% does the opposite. The map shows regions of significant increase and decrease side by side.</p>
      <p>Global mean: ${signed(g.sen)} ${esc(unitLabel(sc.units))} per decade (naive p ${fmtP(g.p_naive)}, corrected p ${fmtP(g.p_mk)}).${sc.var === "GWETROOT" ? " Soil wetness has very long memory, so most cells that look significant to a naive test do not survive correction." : ""}</p>
      <p>MERRA-2 precipitation is corrected with rain gauges over land at low and middle latitudes and is model-only poleward of 62.5°; over the oceans it is the model's own. Soil wetness is a model product forced by that precipitation, and its stream changes (1992, 2001, 2011) are tested as steps. Cross-check any finding against satellites; the Mongolia 2001–2025 scenes do this for precipitation.</p></div>`;
    },
    "arctic-amplification": (sc) => {
      const nh = rmStat(sc, "nh"), sh = rmStat(sc, "sh"), g = rmStat(sc, "globe");
      const st = stepOf(g, "2006-04");
      return `<div class="prose"><p>Northern Hemisphere: ${signed(nh.sen)} °C per decade; Southern Hemisphere: ${signed(sh.sen)} °C per decade. The strongest warming sits in the high Arctic, which Rantanen et al. (2022) found has warmed nearly four times faster than the globe since 1979. Around Antarctica a region of significant cooling stands out.</p>
      <p>Over the oceans MERRA-2 air temperature follows its prescribed sea-surface temperature, whose source changed in 1982 and 2006. ${st ? `${(sc.steps.find((x) => x.label.startsWith("2006-04")) || { flagged: 0 }).flagged.toLocaleString("en-US")} cells show a significant step at the April 2006 switch, and allowing for a step there moves the global trend from ${signed(g.sen)} to ${signed(st.trend_with_step)} °C per decade (step ${signed(st.step)} °C, p ${fmtP(st.p_step)}). A step test cannot tell an artificial jump from natural variability that happens to shift near that date, so treat this as a flag to check against an independent record.` : ""}</p></div>`;
    },
    mongolia: (sc) => {
      const m = sc.region_means[0].stats;
      const flagged = sc.steps.filter((s) => s.flagged).map((s) => `${s.label.slice(0, 4)} (${s.flagged} cells)`);
      return `<div class="prose"><p>Country mean: ${signed(m.sen)} ${esc(unitLabel(sc.units))} per decade (95% CI ${fmt(m.sen_lo)} to ${fmt(m.sen_hi)}; corrected p ${fmtP(m.p_mk)}). The map marks Ulaanbaatar, Dalanzadgad and the Tavan Tolgoi coal field.</p>
      ${flagged.length ? `<p><b>Homogeneity flag.</b> Significant steps appear at the MERRA-2 production-stream boundaries ${flagged.join(", ")}, where Reichle et al. (2017) document land spin-up effects. Trends in this variable over Mongolia should not be cited without an independent product.</p>` : ""}
      <p>MERRA-2 is a 50 km reanalysis. It cannot see local sources such as a mine or a road; it shows the regional climate in which they sit. The variable screen below ranks every MERRA-2 and CERES variable over Mongolia.</p></div>`;
    },
    dust: (sc) => {
      const m = sc.region_means[0].stats;
      return `<div class="prose"><p>Aerosol optical depth at 550 nm from CERES SYN1deg (1° grid, 2001–2025). Country mean: ${signed(m.sen)} per decade (95% CI ${fmt(m.sen_lo)} to ${fmt(m.sen_hi)}, corrected p ${fmtP(m.p_mk)}), against a mean of ${fmt(sc.region_means[0].raw_mean)}. Dust is one aerosol among several; AOD alone cannot separate dust from smoke or pollution.</p>
      <p>Compare the drivers in the other Mongolia scenes: wind speed and soil wetness. At 1°, a cell spans roughly 80 × 110 km, so this is the regional background around the Gobi, not the footprint of any one mine.</p></div>`;
    },
    crosscheck: (sc) => {
      const c = (state.index.comparisons || [])[0];
      const ratio = c ? c.region_trend_a.sen / c.region_trend_b.sen : NaN;
      return `<div class="prose"><p>Precipitation from a model (MERRA-2, gauge-corrected with a taper above 42.5°N) and from satellites (GPM IMERG), on the same grid, 2001–2025.</p>
      ${c ? `<p>They agree on direction: ${Math.round(100 * c.sign_agreement_significant)}% of cells significant in either share a sign, no cell is significant in both with opposite signs, and monthly anomalies correlate at ${fmt(c.region_anomaly_correlation, 2)}. They disagree on size: MERRA-2's country-mean trend is ${fmt(ratio, 2)} times IMERG's. "Wetter" is supported; "how much wetter" depends on the product.</p>` : ""}
      <p>IMERG switched its calibration from TRMM to the GPM Core Observatory in June 2014; the step test on the IMERG scene checks for a jump there.</p></div>`;
    },
  };

  // ------------------------------------------------------------------ scene switching
  function sceneTitle(id) {
    const s = state.index.scenes.find((x) => x.id === id);
    return s ? `${s.title} · ${s.region_name} ${s.period.start.slice(0, 4)}–${s.period.end.slice(0, 4)}` : id;
  }
  function buildPicker() {
    const groups = new Map();
    for (const s of state.index.scenes) {
      if (!groups.has(s.group)) groups.set(s.group, []);
      groups.get(s.group).push(s);
    }
    $("#scene").innerHTML = [...groups].map(([g, list]) => `<optgroup label="${esc(g)}">${list.map((s) =>
      `<option value="${s.id}">${esc(s.title)}${s.kind === "mission" ? " · satellite" : s.kind === "model" ? " · model" : ""}</option>`).join("")}</optgroup>`).join("");
  }
  function buildLayers() {
    const sc = state.sc;
    const avail = LAYERS.filter((l) => (l.id !== "steps" || sc.steps.length) && (l.id !== "truth" || sc.truth));
    if (!avail.find((l) => l.id === state.layer)) state.layer = "trend";
    $("#layers").innerHTML = avail.map((l) => `<button type="button" data-layer="${l.id}" aria-pressed="${l.id === state.layer}">${l.label}</button>`).join("");
    const st = $("#stepsel");
    if (state.layer === "steps" && sc.steps.length > 1) {
      st.hidden = false;
      st.innerHTML = sc.steps.map((s, k) => `<button type="button" data-step="${k}" aria-pressed="${k === state.step}">${esc(s.label.split(":")[0])}</button>`).join("");
    } else st.hidden = true;
  }
  async function showScene(id) {
    const entry = await loadScene(id);
    state.sc = entry.sc; state.series = entry.series; state.sel = null; state.step = 0;
    $("#scene").value = id;
    if (location.hash.slice(1) !== id) history.replaceState(null, "", "#" + id);
    buildLayers();
    renderSummary();
    drawMap();
    renderSelection();
    renderRegionMeans();
    renderCase();
    renderCompare();
    $("#scene-meta").textContent = `${state.sc.product_name}: ${state.sc.source}. ${state.sc.grid_note}. Native resolution ${state.sc.native_res}.`;
  }

  // ------------------------------------------------------------------ boot
  async function boot() {
    map.canvas = $("#map");
    map.ctx = map.canvas.getContext("2d");
    buildPalette();
    try {
      const [index, geo] = await Promise.all([getJSON("data/index.json"), getJSON("data/geo.json")]);
      state.index = index; state.geo = geo;
      state.validation = await getJSON("data/validation.json").catch(() => null);
      state.screen = index.has_screen ? await getJSON("data/screen-mongolia.json").catch(() => null) : null;
    } catch (err) {
      $("#summary").innerHTML = `<p class="warn critical"><span class="icon">!</span>Could not load the precomputed data (${esc(err.message)}). Serve the web/ folder over HTTP, for example with <code>python -m http.server</code>.</p>`;
      return;
    }
    buildPicker();
    const first = location.hash.slice(1);
    const start = state.index.scenes.find((s) => s.id === first) ? first : "mn-t2m";
    await loadScene("synthetic-truth").catch(() => null);
    await showScene(state.index.scenes.find((s) => s.id === start) ? start : state.index.scenes[0].id);
    renderScreen();
    renderMethod();
    $("#gen").textContent = `Data generated ${state.index.generated_utc} UTC from ${state.index.data_source}.`;

    $("#scene").addEventListener("change", (e) => showScene(e.target.value));
    window.addEventListener("hashchange", () => {
      const id = location.hash.slice(1);
      if (id && id !== state.sc.id && state.index.scenes.find((s) => s.id === id)) showScene(id);
    });
    $("#layers").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-layer]");
      if (!b) return;
      state.layer = b.dataset.layer;
      buildLayers();
      drawMap();
    });
    $("#stepsel").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-step]");
      if (!b) return;
      state.step = +b.dataset.step;
      buildLayers();
      drawMap();
    });
    $("#boxmode").addEventListener("click", (e) => {
      map.boxMode = !map.boxMode;
      e.currentTarget.setAttribute("aria-pressed", map.boxMode);
      map.canvas.parentElement.classList.toggle("box-mode", map.boxMode);
    });
    document.addEventListener("click", (e) => {
      const g = e.target.closest("[data-go]");
      if (g) { showScene(g.dataset.go); window.scrollTo({ top: 0, behavior: "smooth" }); }
      const f = e.target.closest("button[data-filter]");
      if (f) {
        state.screenFilter = f.dataset.filter;
        document.querySelectorAll("button[data-filter]").forEach((b) => b.setAttribute("aria-pressed", b === f));
        renderScreen();
      }
    });
    map.canvas.addEventListener("pointerdown", onPointerDown);
    map.canvas.addEventListener("pointermove", onPointerMove);
    map.canvas.addEventListener("pointerup", onPointerUp);
    map.canvas.addEventListener("pointerleave", () => { if (!map.drag) hideTip(); });
    let rz;
    window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { drawMap(); renderSelection(); renderRegionMeans(); }, 150); });
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const retheme = () => { buildPalette(); drawMap(); renderSelection(); renderRegionMeans(); };
    mq.addEventListener("change", retheme);
    new MutationObserver(retheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }
  boot();
})();
