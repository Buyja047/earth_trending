/* Trend Detective workbench. Loads precomputed scenes from data/ and lets the
 * reader ask, for each variable: what is changing, where, by how much, and
 * whether the change survives honest significance testing. Works opened from
 * disk (file://) or served over HTTP. */
(function () {
  "use strict";
  const S = window.TDStats, I = window.TDI18N, SEA = window.TDSeason;
  const t = (k, v) => I.t(k, v);
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const store = {
    get(k) { try { return localStorage.getItem("td." + k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem("td." + k, v); } catch (e) { /* storage blocked */ } },
  };

  const WATER_VARS = new Set(["PRECTOTCORR", "IMERG_PRECTOT", "GWETROOT", "GWETTOP", "SNODP", "FRSEAICE", "FRSNO",
    "WETDAYS", "SNOWDAYS", "R10MM", "RX1DAY"]);
  const REPO = "https://github.com/Buyja047/earth_trending";
  const LAYERS = ["trend", "naive", "verdict", "detect", "emerge", "zone", "anom", "steps", "truth"];
  const CAP_YEAR = 2100;
  const ICONS = {
    trend: '<path d="M2 12 L6 8 L9 10 L14 4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M11 4h3v3" fill="none" stroke="currentColor" stroke-width="1.8"/>',
    naive: '<path d="M2 12 L6 8 L9 10 L14 4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="2 2"/>',
    verdict: '<rect x="2" y="2" width="5" height="5" fill="currentColor"/><rect x="9" y="2" width="5" height="5" fill="none" stroke="currentColor"/><rect x="2" y="9" width="5" height="5" fill="none" stroke="currentColor"/><rect x="9" y="9" width="5" height="5" fill="currentColor" opacity=".5"/>',
    detect: '<circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="2" fill="currentColor"/>',
    emerge: '<path d="M4 15V1.5" stroke="currentColor" stroke-width="1.6"/><path d="M4.8 2h8.4l-2.2 3 2.2 3H4.8z" fill="currentColor"/>',
    anom: '<rect x="2" y="9" width="2.5" height="5" fill="currentColor"/><rect x="6.7" y="4" width="2.5" height="10" fill="currentColor"/><rect x="11.4" y="7" width="2.5" height="7" fill="currentColor"/>',
    steps: '<path d="M2 12h4V7h4V3h4" fill="none" stroke="currentColor" stroke-width="1.8"/>',
    truth: '<path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="2"/>',
    zone: '<rect x="2" y="9" width="4" height="5" fill="currentColor" opacity=".35"/><rect x="6" y="6" width="4" height="8" fill="currentColor" opacity=".65"/><rect x="10" y="2" width="4" height="12" fill="currentColor"/>',
  };
  const LAYER_KEY = { trend: "L_trend", naive: "L_naive", verdict: "L_verdict", detect: "L_detect", emerge: "L_emerge", zone: "L_zone", anom: "L_anom", steps: "L_steps", truth: "L_truth" };
  const REGION_MN = { globe: "Дэлхий (талбайгаар жигнэсэн)", nh: "Хойд хагас бөмбөрцөг", sh: "Өмнөд хагас бөмбөрцөг",
    arctic_area: "Арктикийн далайн мөсний талбай (ойролцоо)", antarctic_area: "Антарктидын далайн мөсний талбай (ойролцоо)",
    focus: "Монгол (улсын хилээр)", focus_part: "Хайрцаг доторх Монголын хэсэг",
    box: "Хайрцгийн дундаж (өргөргийн косинусаар жигнэсэн)" };
  const SCENE_REGION_MN = { Globe: "Дэлхий", Mongolia: "Монгол", "Synthetic globe": "Синтетик бөмбөрцөг" };
  const NOTE_MN = {
    "Observation-corrected": "Ажиглалтаар засварласан хур тунадас: бага ба дунд өргөрөгт борооны хэмжүүрээр (CPCU), Африкт CMAP-аар засварладаг; 42.5–62.5° өргөрөгт загварын хур тунадас руу аажмаар шилжиж, 62.5°-аас хойш зөвхөн загварынх (Reichle нар 2017). Монгол (41–52°N) энэ шилжилтийн бүсэд оршдог тул энд гарах чиг хэсэгчлэн загвараас хамаарна.",
    "CERES SYN1deg merges": "CERES SYN1deg хэд хэдэн хиймэл дагуулыг нэгтгэдэг бөгөөд тэдгээрийн бүрэлдэхүүн цаг хугацааны явцад өөрчлөгддөг; эдгээр өөрчлөлтийн огноог энд шалгаагүй.",
    "MLS retrieval": "2015 онд MLS-ийн хувилбар 2.2 → 4.2 болсон (сар нь батлагдаагүй). Огноо батлагдаагүй тул шалгаагүй.",
    "NCEP sea-ice": "NCEP-ийн далайн мөсний алгоритм 1997, 2004, 2006, 2009, 2011 онд өөрчлөгдсөн (сар нь батлагдаагүй). Огноо батлагдаагүй тул шалгаагүй.",
  };

  const state = {
    index: null, geo: null, places: [], validation: null, screen: null, cache: {},
    entry: null, sc: null, res: null, layer: "trend", step: 0, view: "map", tab: "map",
    y0: null, y1: null, alpha: 0.05, season: "all", sel: null, year: null, playing: null, unit: "decade",
    theme: "system", screenFilter: "all", searched: null, busy: false,
    // background imagery (NASA GIBS); "none" keeps the viewer fully offline
    base: "none", baseDate: new Date(Date.now() - 864e5).toISOString().slice(0, 10), baseGrey: true, baseAlpha: 0.75,
    ov: { coast: true, borders: true, places: true, stipple: false },
  };

  // ------------------------------------------------------------ formatting
  function unitLabel(u) {
    const base = ({ C: "°C", "1": "fraction", Dobsons: "DU", dimensionless: "", sd: "sd" })[u] ?? u;
    return I.unit(base);
  }
  function fmt(v, sig = 3) {
    if (v === null || v === undefined || !Number.isFinite(v)) return "–";
    if (v === 0) return "0";
    const a = Math.abs(v);
    if (a >= 1000) return Math.round(v).toLocaleString("en-US");
    if (a < 1e-3) return v.toExponential(1);
    return Number(v.toPrecision(sig)).toString();
  }
  const signed = (v, sig = 3) => (v > 0 ? "+" : "") + fmt(v, sig);
  function fmtP(p) {
    if (p === null || p === undefined || !Number.isFinite(p)) return "–";
    if (p < 0.001) return "<0.001";
    return p < 0.01 ? p.toFixed(3) : p.toFixed(2);
  }
  function ll(lat, lon) {
    return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`;
  }
  const nf = (v) => (+v).toLocaleString("en-US");
  const L = () => I.lang();
  const mn = () => L() === "mn";
  function sceneTitle(s) { return I.sceneTitle(s.id, s.title); }
  function regionName(rm) { return mn() ? (REGION_MN[rm.key] || rm.name) : rm.name; }
  function sceneRegion(sc) { return mn() ? (SCENE_REGION_MN[sc.region_name] || sc.region_name) : sc.region_name; }
  function noteText(s) {
    if (!mn()) return s;
    const k = Object.keys(NOTE_MN).find((p) => s.includes(p));
    return k ? NOTE_MN[k] : s;
  }
  // values are stored per decade; convert to the unit chosen in the legend
  function unitFactor() {
    if (state.unit === "year") return 0.1;
    if (state.unit === "total") return (state.y1 - state.y0 + 1) / 10;
    return 1;
  }
  function unitText(sc) {
    const u = unitLabel(sc.units);
    const key = state.unit === "year" ? "unit_year" : state.unit === "total" ? "unit_total" : "unit_decade";
    return `${u ? u + " " : ""}${t(key, { y0: state.y0, y1: state.y1 })}`;
  }

  // ------------------------------------------------------------ colour
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const hexRgb = (h) => { const m = h.replace("#", ""); return [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16)); };
  const toLin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const toSrgb = (c) => Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)));
  function oklab([r, g, b]) {
    r = toLin(r); g = toLin(g); b = toLin(b);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  }
  function fromOklab([Lx, a, b]) {
    const l = Math.pow(Lx + 0.3963377774 * a + 0.2158037573 * b, 3), m = Math.pow(Lx - 0.1055613458 * a - 0.0638541728 * b, 3);
    const s = Math.pow(Lx - 0.0894841775 * a - 1.291485548 * b, 3);
    return [toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)];
  }
  function rampLUT(stops, n = 256) {
    const labs = stops.map((h) => oklab(hexRgb(h)));
    return Array.from({ length: n }, (_, i) => {
      const x = i / (n - 1) * (labs.length - 1), k = Math.min(labs.length - 2, Math.floor(x)), f = x - k;
      return fromOklab([0, 1, 2].map((q) => labs[k][q] + (labs[k + 1][q] - labs[k][q]) * f));
    });
  }
  let pal = null;
  function buildPalette() {
    const dark = document.documentElement.dataset.theme === "dark" ||
      (document.documentElement.dataset.theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
    const muted = cssVar("--muted");
    pal = {
      dark,
      div: rampLUT([cssVar("--div-neg-2"), cssVar("--div-neg-1"), cssVar("--div-mid"), cssVar("--div-pos-1"), cssVar("--div-pos-2")], 257),
      seq: dark ? rampLUT(["#184f95", "#3987e5", "#9ec5f4", "#e6f0fc"]) : rampLUT(["#cde2fb", "#6da7ec", "#256abf", "#0d366b"]),
      bg: hexRgb(cssVar("--map-bg")), ink: cssVar("--ink"), coast: cssVar("--coast"), line: cssVar("--line"),
      s1: hexRgb(cssVar("--s1")), s2: hexRgb(cssVar("--s2")), s3: hexRgb(cssVar("--s3")),
      axis: hexRgb(cssVar("--axis")), grid: hexRgb(cssVar("--grid")), muted: hexRgb(muted.length === 7 ? muted : "#888888"),
    };
  }
  const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
  function divColor(v, lim, invert) {
    let x = Math.max(-1, Math.min(1, v / lim));
    if (invert) x = -x;
    return pal.div[Math.round((x + 1) / 2 * 256)];
  }
  const fade = (c, a) => c.map((v, i) => Math.round(v + (pal.bg[i] - v) * a));
  const verdictColors = () => ({ 1: pal.s1, 2: pal.s3, 3: pal.s2, 4: pal.axis, 5: pal.grid, 6: pal.muted });

  // ------------------------------------------------------------ data loading
  const pending = {};
  window.TD_DATA = (key, obj) => { (pending[key] || []).forEach((r) => r(obj)); delete pending[key]; };
  function loadPayload(key) {
    if (location.protocol === "file:") {
      return new Promise((resolve, reject) => {
        (pending[key] = pending[key] || []).push(resolve);
        const s = document.createElement("script");
        s.src = `data/${key}.js`;
        s.onerror = () => reject(new Error(`data/${key}.js`));
        document.head.appendChild(s);
      });
    }
    return fetch(`data/${key}.js`).then((r) => {
      if (!r.ok) throw new Error(`data/${key}.js: HTTP ${r.status}`);
      return r.text();
    }).then((txt) => JSON.parse(txt.slice(txt.indexOf(",") + 1, txt.lastIndexOf(")"))));
  }
  async function loadScene(id) {
    if (state.cache[id]) return state.cache[id];
    const sc = await loadPayload(id);
    const bin = atob(sc.series.b64);
    const vals = new Float32Array(bin.length / 2), raw = new Int16Array(bin.length / 2);
    for (let k = 0, q = 0; k < vals.length; k++, q += 2) {
      raw[k] = ((bin.charCodeAt(q) | (bin.charCodeAt(q + 1) << 8)) << 16) >> 16;
      vals[k] = raw[k] === -32768 ? NaN : raw[k] * sc.series.scale;
    }
    delete sc.series.b64;
    const entry = { sc, vals, raw };
    state.cache[id] = entry;
    return entry;
  }
  function seriesTimes(sc) {
    const { n, start, kind } = sc.series;
    return Array.from({ length: n }, (_, k) => kind === "monthly" ? start + k / 12 : start + 0.5 + k);
  }
  function cellSeries(i) {
    const n = state.sc.series.n;
    return state.entry.vals.subarray(i * n, (i + 1) * n);
  }
  // the months filter in force for a scene: only scenes that keep monthly values per cell can be cut by season
  function seasonOf(sc) {
    const p = SEA.byId(state.season);
    return p.id !== "all" && sc && sc.series.kind === "monthly" ? p : null;
  }
  // per-cell calendar-year means (or season means when a season is chosen), computed once per scene and season
  function annualCube(entry) {
    const se = seasonOf(entry.sc), key = se ? se.id : "year";
    entry.cubes = entry.cubes || {};
    if (entry.cubes[key]) return entry.cubes[key];
    const sc = entry.sc, n = sc.series.n, ncell = sc.grid.nx * sc.grid.ny;
    let years, data, ny, off = 0.5;
    if (se) {
      const pl = SEA.plan(n, sc.series.start, se.m0, se.m1);
      years = pl.years; ny = years.length; off = pl.off;
      // in double precision from the stored integers (live scenes: from the values read), so rounding
      // never makes or breaks a tie between two years and Mann-Kendall's S is the exact one
      data = new Float64Array(ncell * ny);
      for (let c = 0; c < ncell; c++) data.set(entry.raw ? SEA.apply(entry.raw, pl, c * n, sc.series.scale) : SEA.apply(entry.vals, pl, c * n), c * ny);
    } else if (sc.series.kind === "annual") {
      ny = n; years = Array.from({ length: n }, (_, k) => sc.series.start + k);
      data = entry.vals;
    } else {
      ny = Math.floor(n / 12);
      const y0 = Math.floor(sc.series.start);
      years = Array.from({ length: ny }, (_, k) => y0 + k);
      data = new Float32Array(ncell * ny);
      for (let c = 0; c < ncell; c++) {
        for (let y = 0; y < ny; y++) {
          let s = 0;
          for (let m = 0; m < 12; m++) s += entry.vals[c * n + y * 12 + m];
          data[c * ny + y] = s / 12;
        }
      }
    }
    const abs = [];
    for (let k = 0; k < data.length; k += 7) if (Number.isFinite(data[k])) abs.push(Math.abs(data[k]));
    abs.sort((a, b) => a - b);
    entry.cubes[key] = { years, data, ny, off, lim: niceLim(abs[Math.floor(abs.length * 0.98)] || 1) };
    return entry.cubes[key];
  }
  function niceLim(q) {
    const p = Math.pow(10, Math.floor(Math.log10(q || 1)));
    return Math.ceil(q / p * 2) / 2 * p;
  }

  // ------------------------------------------------------------ statistics for the chosen years
  function bhThreshold(ps, a) {
    const v = ps.filter(Number.isFinite).sort((x, y) => x - y), m = v.length;
    let best = 0;
    for (let i = 0; i < m; i++) if (v[i] <= a * (i + 1) / m) best = v[i];
    return best;
  }
  function fullRange() { const sc = state.sc; return [+sc.period.start.slice(0, 4), +sc.period.end.slice(0, 4)]; }
  function isFull() { const [a, b] = fullRange(); return state.y0 === a && state.y1 === b; }

  // verdict per cell from stored p-values; `base` marks valid (1-5), excluded (6), no data (0)
  function classify(cells, base, alpha, years) {
    const ncell = base.length, status = new Int8Array(ncell);
    const valid = (k) => base[k] >= 1 && base[k] <= 5;
    const ps = [];
    for (let k = 0; k < ncell; k++) if (valid(k) && cells.p_mk[k] !== null) ps.push(cells.p_mk[k]);
    const pstar = bhThreshold(ps, 2 * alpha);
    const c = { valid: 0, naive: 0, fdr: 0, robust: 0, fdr_up: 0, fdr_down: 0, not_yet: 0, gappy: 0 };
    for (let k = 0; k < ncell; k++) {
      if (!valid(k)) { status[k] = base[k]; if (base[k] === 6) c.gappy++; continue; }
      c.valid++;
      const p = cells.p_mk[k], sen = cells.sen[k];
      const fdr = p !== null && pstar > 0 && p <= pstar;
      // precomputed cells keep no OLS slope; when both tests are significant their signs agree in practice
      const sameSign = cells.ols ? Math.sign(cells.ols[k]) === Math.sign(sen) : true;
      const agree = cells.p_ols[k] !== null && cells.p_ols[k] < alpha && sameSign;
      const naive = cells.p_naive[k] !== null && cells.p_naive[k] < alpha;
      const ns = cells.nstar[k];
      let st = ns !== null && Number.isFinite(ns) && ns <= years ? 5 : 4;
      if (naive && !fdr) st = 3;
      if (fdr) st = agree ? 1 : 2;
      status[k] = st;
      if (naive) c.naive++;
      if (fdr) { c.fdr++; if (agree) c.robust++; if (sen > 0) c.fdr_up++; else if (sen < 0) c.fdr_down++; }
      if (st === 4) c.not_yet++;
    }
    return { status, counts: c, pstar };
  }
  function statsFromJS(r) {
    if (!r) return null;
    return { sen: r.sen * 10, sen_lo: r.senLo * 10, sen_hi: r.senHi * 10, p_naive: r.pNaive, p_mk: r.pMk, p_ols_ar1: r.pOls,
      phi: r.phi, sigma: r.sigma, mdt: r.mdt * 10, nstar: Number.isFinite(r.nstar) ? r.nstar : null, years: r.years, n: r.n, steps: [] };
  }
  // monthly values inside [y0, y1], with the calendar-month means of that window removed
  function monthlyWindow(vals, start, y0, y1) {
    const t0 = Math.floor(start), x = [], tt = [];
    for (let k = 0; k < vals.length; k++) {
      const y = t0 + Math.floor(k / 12);
      if (y < y0 || y > y1) continue;
      x.push(vals[k] === null ? NaN : vals[k]);
      tt.push(start + k / 12);
    }
    const sum = new Float64Array(12), cnt = new Float64Array(12);
    x.forEach((v, k) => { if (Number.isFinite(v)) { sum[k % 12] += v; cnt[k % 12]++; } });
    for (let k = 0; k < x.length; k++) x[k] -= cnt[k % 12] ? sum[k % 12] / cnt[k % 12] : 0;
    return { x, t: tt };
  }
  // values of years y0..y1, timed at the middle of the year (or of the season: `off`)
  function subsetAnnual(years, vals, y0, y1, off = 0.5) {
    const ys = [], vs = [];
    years.forEach((y, k) => { if (y >= y0 && y <= y1) { ys.push(y + off); vs.push(vals[k] === null ? NaN : vals[k]); } });
    return { ys, vs };
  }
  // an area mean's yearly values: calendar-year means, or the chosen season's means from its monthly series
  function regionYears(rm, sc = state.sc) {
    const se = seasonOf(sc);
    if (se) return SEA.series(rm.monthly, rm.monthly_start, se.m0, se.m1);
    return { years: rm.annual_years, vals: rm.annual.map((v) => (v === null ? NaN : v)), off: 0.5 };
  }

  async function computeResults() { state.res = await computeFor(state.sc, state.entry, state.y0, state.y1, state.alpha); }
  // every per-cell statistic for one scene and window; precomputed values when the window is the full record
  async function computeFor(sc, entry, y0, y1, alpha) {
    const se = seasonOf(sc), full = y0 === +sc.period.start.slice(0, 4) && y1 === +sc.period.end.slice(0, 4);
    if (full && !sc.live && !se) {
      const cells = sc.cells;
      const exact = Math.abs(alpha - 0.05) < 1e-9;
      const cl = exact ? { status: Int8Array.from(cells.status), counts: Object.assign({}, sc.counts), pstar: sc.p_star }
        : classify(cells, cells.status, alpha, sc.period.years);
      cl.counts.step_flagged = sc.counts.step_flagged;
      return { custom: false, cells, status: cl.status, counts: cl.counts, pstar: cl.pstar, years: sc.period.years,
        regionStats: sc.region_means.map((rm) => rm.stats) };
    }
    // yearly values (calendar years or seasons) inside the window; a season over New Year can start a year late
    const cube = annualCube(entry), i0 = cube.years.findIndex((y) => y >= y0);
    const ny = i0 < 0 ? 0 : cube.years.filter((y) => y >= y0 && y <= y1).length;
    const tt = cube.years.slice(i0, i0 + ny).map((y) => y + cube.off);
    const ncell = sc.grid.nx * sc.grid.ny, monthly = sc.series.kind === "monthly" && !se, n = sc.series.n;
    const years = monthly ? y1 - y0 + 1 : ny;
    const cells = {};
    ["sen", "sen_lo", "sen_hi", "p_naive", "p_mk", "p_ols", "phi", "sigma", "mdt", "nstar", "ols", "p_hr_empirical"].forEach((k) => { cells[k] = new Array(ncell).fill(null); });
    cells.clim_mean = sc.cells.clim_mean;
    // a cell whose values never change in these years (no snow at all in July) has no trend to test: left out
    const base = Int8Array.from(sc.cells.status), flat = new Set(), busy = $("#busy");
    busy.hidden = false;
    state.busy = true;
    let tick = performance.now();
    for (let c = 0; c < ncell; c++) {
      if (base[c] >= 1 && base[c] <= 5) {
        let r;
        if (monthly) {
          const w = monthlyWindow(entry.vals.subarray(c * n, (c + 1) * n), sc.series.start, y0, y1);
          r = S.analyze(w.x, w.t);
        } else r = S.analyze(Array.from(cube.data.subarray(c * cube.ny + i0, c * cube.ny + i0 + ny)), tt);
        if (r && !(r.varS > 0)) { flat.add(c); base[c] = 0; r = null; }
        if (r) {
          cells.sen[c] = r.sen * 10; cells.sen_lo[c] = r.senLo * 10; cells.sen_hi[c] = r.senHi * 10;
          cells.p_naive[c] = r.pNaive; cells.p_mk[c] = r.pMk; cells.p_ols[c] = r.pOls; cells.phi[c] = r.phi;
          cells.sigma[c] = r.sigma; cells.mdt[c] = r.mdt * 10; cells.nstar[c] = Number.isFinite(r.nstar) ? r.nstar : null; cells.ols[c] = r.ols;
        }
      }
      if (performance.now() - tick > 60) {
        busy.textContent = t("computing", { p: Math.round(100 * c / ncell) });
        await new Promise((res) => setTimeout(res, 0));
        tick = performance.now();
      }
    }
    busy.hidden = true;
    state.busy = false;
    const cl = classify(cells, base, alpha, years);
    cl.counts.step_flagged = sc.counts.step_flagged;
    const regionStats = sc.region_means.map((rm) => {
      // area means keep monthly series for every scene, so they use them unless a season is chosen
      if (!se) { const w = monthlyWindow(rm.monthly, rm.monthly_start, y0, y1); return statsFromJS(S.analyze(w.x, w.t)); }
      const ry = regionYears(rm, sc), sub = subsetAnnual(ry.years, ry.vals, y0, y1, ry.off);
      return statsFromJS(S.analyze(sub.vs, sub.ys));
    });
    cl.counts.flat = flat.size;
    return { custom: true, cells, status: cl.status, counts: cl.counts, pstar: cl.pstar, years, regionStats, monthly, flat,
      season: se ? se.id : null, y0eff: monthly ? y0 : cube.years[i0] };
  }

  // ------------------------------------------------------------ split-view compare
  // the right half of the map shows another dataset (same region) or the same one for other years
  const cmp = { on: false, id: null, y0: null, y1: null, entry: null, res: null, x: 0.5, busy: false };
  const cmpReady = () => cmp.on && cmp.res && state.view === "map";
  // run fn with the compare side in place of the main one (single-threaded, restored afterwards)
  function withSide(fn) {
    const keep = { sc: state.sc, entry: state.entry, res: state.res, y0: state.y0, y1: state.y1, layer: state.layer, step: state.step };
    Object.assign(state, { sc: cmp.entry.sc, entry: cmp.entry, res: cmp.res, y0: cmp.y0, y1: cmp.y1 });
    if (!availLayers().includes(state.layer)) state.layer = "trend";
    if (!state.sc.steps[state.step]) state.step = 0;
    try { return fn(); } finally { Object.assign(state, keep); }
  }
  const sameUnits = () => cmp.entry && cmp.entry.sc.units === state.sc.units;
  // datasets that can go on the right: same region (a live box only with itself)
  function cmpChoices() {
    const sc = state.sc;
    return state.index.scenes.filter((s) => (sc.live ? s.id === sc.id : !s.live && s.region === sc.region));
  }
  function cmpDefault() {
    const sc = state.sc, pair = (state.index.comparisons || []).find((c) => c.a === sc.id || c.b === sc.id);
    if (pair) {
      const id = pair.a === sc.id ? pair.b : pair.a, e = state.index.scenes.find((s) => s.id === id);
      return { id, y0: +e.period.start.slice(0, 4), y1: +e.period.end.slice(0, 4) };
    }
    // otherwise the same dataset: the first and second half of the chosen years
    const mid = state.y0 + Math.floor((state.y1 - state.y0 + 1) / 2);
    return { id: sc.id, y0: Math.max(mid, state.y1 - 29), y1: state.y1, left: [state.y0, mid - 1] };
  }
  async function cmpLoad(id, y0, y1) {
    const entry = await loadScene(id), sc = entry.sc, a = +sc.period.start.slice(0, 4), b = +sc.period.end.slice(0, 4);
    y0 = Math.max(a, Math.min(y0, b - 9)); y1 = Math.min(b, Math.max(y1, y0 + 9));
    cmp.busy = true;
    const res = await computeFor(sc, entry, y0, y1, state.alpha);
    Object.assign(cmp, { id, y0, y1, entry, res, busy: false });
  }
  async function setCompare(on) {
    if (!on) {
      cmp.on = false; cmp.res = null;
      // give the left half back the years it had before the split
      if (cmp.prev && cmp.prev.id === state.sc.id) { [state.y0, state.y1] = cmp.prev.years; cmp.prev = null; await computeResults(); }
      renderAll();
      return;
    }
    const d = cmpDefault();
    cmp.on = true;
    cmp.prev = null;
    if (d.left && (state.y0 !== d.left[0] || state.y1 !== d.left[1]) && d.left[1] - d.left[0] >= 9) {
      cmp.prev = { id: state.sc.id, years: [state.y0, state.y1] };
      state.y0 = d.left[0]; state.y1 = d.left[1];
      await computeResults();
    }
    await cmpLoad(d.id, d.y0, d.y1);
    renderAll();
  }
  async function cmpApply() {
    let y0 = +$("#cmp-y0").value, y1 = +$("#cmp-y1").value;
    if (y1 < y0) [y0, y1] = [y1, y0];
    await cmpLoad($("#cmp-scene").value, y0, y1);
    renderAll();
  }
  function renderCmpBar() {
    const bar = $("#cmpbar"), on = cmp.on && state.view === "map";
    bar.hidden = !on;
    $("#cmphandle").hidden = !cmpReady();
    $("#cmplabels").hidden = !cmpReady();
    $$("[data-cmp]").forEach((b) => { b.setAttribute("aria-pressed", cmp.on); b.classList.toggle("primary", cmp.on); });
    if (!on || !cmp.entry) return;
    const sc = cmp.entry.sc, a = +sc.period.start.slice(0, 4), b = +sc.period.end.slice(0, 4);
    const opts = (sel) => Array.from({ length: b - a + 1 }, (_, k) => a + k).map((y) => `<option${y === sel ? " selected" : ""}>${y}</option>`).join("");
    $("#cmp-scene").innerHTML = cmpChoices().map((s) => `<option value="${s.id}"${s.id === cmp.id ? " selected" : ""}>${esc(sceneTitle(s))}</option>`).join("");
    $("#cmp-y0").innerHTML = opts(cmp.y0); $("#cmp-y1").innerHTML = opts(cmp.y1);
    $("#cmp-note").textContent = sameUnits() ? t("cmp_shared") : t("cmp_own");
  }
  // side labels and the drag handle follow the divider
  function placeCmp() {
    if (!cmpReady()) return;
    const x = Math.round(map.W * cmp.x), lbl = (sc, y0, y1) => `${sceneTitle(sc)} · ${yrsText(sc, y0, y1)}`;
    const h = $("#cmphandle");
    h.style.left = x + "px";
    h.setAttribute("aria-valuenow", Math.round(100 * cmp.x));
    $("#cmp-l").textContent = lbl(state.sc, state.y0, state.y1);
    $("#cmp-r").textContent = lbl(cmp.entry.sc, cmp.y0, cmp.y1);
    $("#cmp-r").style.left = x + 8 + "px";
    $("#cmp-l").style.maxWidth = Math.max(60, x - 16) + "px";
    $("#cmp-r").style.maxWidth = Math.max(60, map.W - x - 56) + "px";
  }
  // the same location in the compare dataset's grid
  function cmpCellAt(lon, lat) {
    const g = cmp.entry.sc.grid;
    const i = Math.round((lon - g.lon[0]) / g.dlon), j = Math.round((lat - g.lat[0]) / g.dlat);
    return i < 0 || j < 0 || i >= g.nx || j >= g.ny ? -1 : j * g.nx + i;
  }

  // ------------------------------------------------------------ year detectable
  // samples behind sigma_N and phi: precomputed full-record statistics come from monthly data
  function cellSamples() {
    const r = state.res;
    return !r.custom || r.monthly ? Math.round(r.years * 12) : Math.round(r.years);
  }
  // year by which a trend of the measured size is detected with 90 % probability (Weatherhead n*),
  // assuming it continues; range from the Sen 95 % CI widened by e^B for the noise estimates
  function detectYear(nstar, sen, lo, hi, phi, m) {
    if (nstar === null || nstar === undefined || !Number.isFinite(nstar) || !sen || !m) return null;
    const r = S.detectionRange(nstar, sen, lo, hi, phi, m);
    const first = (state.res && state.res.y0eff) || state.y0;
    const yr = (n) => (Number.isFinite(n) ? first + Math.max(1, Math.ceil(n)) - 1 : Infinity);
    return { n: nstar, y: yr(nstar), lo: yr(r.lo), hi: yr(r.hi) };
  }
  function detectArr() {
    const r = state.res;
    if (r.det) return r.det;
    const c = r.cells, m = cellSamples();
    r.det = Array.from(r.status, (st, k) => (st >= 1 && st <= 5 ? detectYear(c.nstar[k], c.sen[k], c.sen_lo[k], c.sen_hi[k], c.phi[k], m) : null));
    return r.det;
  }
  const yearText = (y) => (y === Infinity ? t("ey_never") : y > CAP_YEAR ? t("ey_after", { y: CAP_YEAR }) : String(y));

  // ------------------------------------------------------------ risk zones
  // For the daily hazard indices: how high the index is in the chosen months (its month-of-year
  // means over the whole record, in thirds across the map) and whether it is rising (an upward
  // trend that survives the FDR test for the chosen years). 4 high and rising, 3 high, 2 rising,
  // 1 middle third, 0 lowest third. The thirds are relative to this map, not an absolute standard.
  function zoneInfo() {
    const r = state.res, sc = state.sc, key = `${state.season}`;
    if (r.zone && r.zone.key === key) return r.zone;
    const cl = sc.clim12, st = r.status, ncell = st.length, se = seasonOf(sc);
    const ms = se ? SEA.months(se.m0, se.m1) : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const level = new Float64Array(ncell).fill(NaN);
    for (let k = 0; k < ncell; k++) {
      if (st[k] < 1 || st[k] > 5) continue;
      let s = 0, n = 0;
      for (const m of ms) { const v = cl[k * 12 + m - 1]; if (v !== null && Number.isFinite(v)) { s += v; n++; } }
      if (n === ms.length) level[k] = s / n;
    }
    const v = Array.from(level).filter(Number.isFinite).sort((a, b) => a - b);
    const q = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
    const q1 = q(1 / 3), q2 = q(2 / 3), cls = new Int8Array(ncell).fill(-1), counts = [0, 0, 0, 0, 0];
    for (let k = 0; k < ncell; k++) {
      if (!Number.isFinite(level[k])) continue;
      const up = (st[k] === 1 || st[k] === 2) && r.cells.sen[k] > 0, top = level[k] >= q2 && q2 > q1;
      cls[k] = top && up ? 4 : top ? 3 : up ? 2 : level[k] >= q1 && q2 > q1 ? 1 : 0;
      counts[cls[k]]++;
    }
    r.zone = { key, cls, level, q1, q2, counts };
    return r.zone;
  }
  const ZONE_SHADE = [36, 90, 150, 205, 255];
  function detectShort(d) {
    if (!d) return t("ey_none");
    if (d.y > CAP_YEAR) return t("ey_after", { y: CAP_YEAR });
    return `${d.y} (${d.lo}–${yearText(d.hi)})`;
  }
  function detectSentence(d) {
    if (!d) return "";
    if (d.y > CAP_YEAR) return t("ey_sent_late", { y: CAP_YEAR });
    return t("ey_sent", { n: fmt(d.n, 2), y: d.y, lo: d.lo, hi: yearText(d.hi) });
  }

  // ------------------------------------------------------------ 2D map
  // view = zoom factor and the lon/lat at the canvas centre; ptrs = active pointers (two of them pinch);
  // zmax lets one grid cell grow to about 160 px
  const map = { canvas: null, ctx: null, W: 0, H: 0, g: null, drag: null, pan: null, pinch: null, gesture: false,
    ptrs: new Map(), raf: 0, boxMode: false, lim: 1, zmax: 8, view: { z: 1, lon: null, lat: null } };
  let surface = null;
  function baseGeom(sc) {
    const g = sc.grid;
    let lon0 = g.lon[0] - g.dlon / 2, lon1 = g.lon[g.nx - 1] + g.dlon / 2, lat0 = g.lat[0] - g.dlat / 2, lat1 = g.lat[g.ny - 1] + g.dlat / 2;
    if (sc.region === "global") { lon0 = -180; lon1 = 180; lat0 = -90; lat1 = 90; }
    const k = sc.region === "global" ? 1 : Math.cos((lat0 + lat1) / 2 * Math.PI / 180);
    return { lon0, lon1, lat0, lat1, aspect: (lat1 - lat0) / ((lon1 - lon0) * k) };
  }
  const X = (lon) => map.g.ox + (lon - map.g.lon0) / (map.g.lon1 - map.g.lon0) * map.g.w;
  const Y = (lat) => map.g.oy + (map.g.lat1 - lat) / (map.g.lat1 - map.g.lat0) * map.g.h;
  const LON = (x) => map.g.lon0 + (x - map.g.ox) / map.g.w * (map.g.lon1 - map.g.lon0);
  const LAT = (y) => map.g.lat1 - (y - map.g.oy) / map.g.h * (map.g.lat1 - map.g.lat0);

  function layerLimit() {
    const sc = state.sc, c = state.res.cells, st = state.res.status;
    if (state.layer === "anom") return annualCube(state.entry).lim;
    if (state.layer === "emerge" || state.layer === "zone") return 1;
    let arr;
    if (state.layer === "detect") arr = c.mdt;
    else if (state.layer === "steps") arr = sc.steps[state.step] ? sc.steps[state.step].step : [];
    else if (state.layer === "truth") arr = sc.truth ? sc.truth.slope : [];
    else arr = c.sen;
    const vals = [];
    for (let k = 0; k < arr.length; k++) if (arr[k] !== null && Number.isFinite(arr[k]) && st[k] >= 1 && st[k] <= 5) vals.push(Math.abs(arr[k]));
    vals.sort((a, b) => a - b);
    const f = state.layer === "steps" ? 1 : unitFactor();
    return niceLim((vals[Math.floor(vals.length * 0.98)] || vals[vals.length - 1] || 1) * f);
  }
  // colour and signed height (in units of the colour limit) for one cell in the current layer
  function cellLook(k, lim) {
    const st = state.res.status[k], c = state.res.cells, sc = state.sc;
    if (st === 0) return null;
    if (st === 6) return { col: pal.muted, h: NaN };
    const invert = WATER_VARS.has(sc.var), f = unitFactor();
    switch (state.layer) {
      case "verdict": return { col: verdictColors()[st], h: c.sen[k] !== null ? c.sen[k] * f / lim : 0 };
      case "detect": {
        const v = c.mdt[k] === null ? NaN : c.mdt[k] * f;
        return Number.isFinite(v) ? { col: pal.seq[Math.min(255, Math.round(Math.abs(v) / lim * 255))], h: Math.min(1.5, v / lim) } : null;
      }
      case "anom": {
        const cube = annualCube(state.entry), v = cube.data[k * cube.ny + cube.years.indexOf(state.year)];
        return Number.isFinite(v) ? { col: divColor(v, lim, invert), h: v / lim } : null;
      }
      case "emerge": {
        // early years strong, CAP_YEAR faint; trends not yet detected are faded
        const d = detectArr()[k];
        if (!d || d.y > CAP_YEAR) return { col: pal.grid, h: 0 };
        const y0 = map.emergeY0 || state.y0, f = Math.max(0, Math.min(1, (CAP_YEAR - d.y) / (CAP_YEAR - y0))), col = pal.seq[Math.round(f * 255)];
        return { col: st === 1 || st === 2 ? col : fade(col, 0.45), h: f };
      }
      case "zone": {
        const z = zoneInfo(), c5 = z.cls[k];
        return c5 < 0 ? null : { col: pal.seq[ZONE_SHADE[c5]], h: c5 / 4 };
      }
      case "steps": {
        const s = sc.steps[state.step];
        if (!s || s.step[k] === null) return null;
        const col = divColor(s.step[k], lim, invert);
        return { col: s.flag[k] ? col : fade(col, 0.72), h: s.step[k] / lim };
      }
      case "truth": {
        const v = sc.truth ? sc.truth.slope[k] * f : null;
        return v === null ? null : { col: divColor(v, lim, invert), h: v / lim };
      }
      default: {
        if (c.sen[k] === null) return null;
        const v = c.sen[k] * f;
        const strong = state.layer === "naive" ? (c.p_naive[k] !== null && c.p_naive[k] < state.alpha) : (st === 1 || st === 2);
        const col = divColor(v, lim, invert);
        return { col: strong ? col : fade(col, 0.72), h: v / lim };
      }
    }
  }

  function drawMap() {
    const sc = state.sc;
    if (!sc || !state.res || !pal) return;
    // the year-detectable colours count from the earlier start year of the two halves
    map.emergeY0 = cmpReady() ? Math.min(state.y0, cmp.y0) : state.y0;
    let lim = layerLimit();
    // with the same units on both sides, one colour scale makes the halves comparable
    if (cmpReady()) { map.limR = withSide(layerLimit); if (sameUnits()) lim = map.limR = Math.max(lim, map.limR); }
    map.lim = lim;
    renderLegend(lim);
    if (state.view === "surf") { drawSurface(lim); return; }
    paint();
  }
  // fit the whole extent into the canvas, then apply the zoom and centre held in map.view
  function layout() {
    const gb = baseGeom(state.sc), W = map.W, H = map.H, pad = 10, v = map.view;
    let w = W - 2 * pad, h = w * gb.aspect;
    if (h > H - 2 * pad) { h = H - 2 * pad; w = h / gb.aspect; }
    const dlon = gb.lon1 - gb.lon0, dlat = gb.lat1 - gb.lat0;
    map.zmax = Math.max(4, Math.min(64, 160 / (w * state.sc.grid.dlon / dlon)));
    v.z = Math.min(v.z, map.zmax);
    w *= v.z; h *= v.z;
    if (v.lon === null) { v.lon = gb.lon0 + dlon / 2; v.lat = gb.lat0 + dlat / 2; }
    let ox = W / 2 - (v.lon - gb.lon0) / dlon * w, oy = H / 2 - (gb.lat1 - v.lat) / dlat * h;
    // centre the data while it fits; once larger than the canvas, stop its edges at the padding
    ox = w <= W - 2 * pad + 1e-6 ? (W - w) / 2 : Math.min(pad, Math.max(W - pad - w, ox));
    oy = h <= H - 2 * pad + 1e-6 ? (H - h) / 2 : Math.min(pad, Math.max(H - pad - h, oy));
    v.lon = gb.lon0 + (W / 2 - ox) / w * dlon;
    v.lat = gb.lat1 - (H / 2 - oy) / h * dlat;
    map.g = Object.assign(gb, { w, h, ox, oy });
    $("#zin").disabled = v.z >= map.zmax - 1e-9;
    $("#zout").disabled = $("#zreset").disabled = v.z <= 1 + 1e-9;
  }
  const inkOn = (c) => (0.2126 * toLin(c[0]) + 0.7152 * toLin(c[1]) + 0.0722 * toLin(c[2]) > 0.18 ? "#000" : "#fff");
  function paint() {
    const sc = state.sc, wrap = $("#mapwrap"), gb0 = baseGeom(sc);
    // on phones the map gets the height its shape needs instead of filling the pane
    const narrow = matchMedia("(max-width: 760px)").matches;
    const want = narrow ? `${Math.round(wrap.clientWidth * gb0.aspect + 20)}px` : "";
    if (wrap.style.height !== want) wrap.style.height = want;
    const W = wrap.clientWidth, H = wrap.clientHeight;
    if (!W || !H) return;
    const dpr = window.devicePixelRatio || 1, cwPx = Math.round(W * dpr), chPx = Math.round(H * dpr);
    if (map.canvas.width !== cwPx || map.canvas.height !== chPx) { map.canvas.width = cwPx; map.canvas.height = chPx; }
    map.W = W; map.H = H;
    layout();
    const ctx = map.ctx, G = map.g, lim = map.lim;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = rgb(pal.bg);
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = pal.line;
    ctx.lineWidth = 1;
    ctx.strokeRect(G.ox - 0.5, G.oy - 0.5, G.w + 1, G.h + 1);
    const imagery = state.base !== "none" && window.TDBasemap;
    if (imagery) {
      TDBasemap.draw(ctx, state.base, { X, Y, lon0: LON(0), lon1: LON(W), lat0: LAT(H), lat1: LAT(0),
        sx: G.w / (G.lon1 - G.lon0), sy: G.h / (G.lat1 - G.lat0), dpr }, { grey: state.baseGrey, date: state.baseDate, onload: schedulePaint });
    }
    const pl = placeLayout(), divX = cmpReady() ? Math.round(W * cmp.x) : W;
    drawField(0, divX, lim, pl, imagery, dpr, cwPx, chPx);
    if (divX < W) withSide(() => drawField(divX, W, map.limR, pl, imagery, dpr, cwPx, chPx));
    if (state.ov.coast) drawLines(state.geo.land, pal.coast, 0.8);
    if (sc.region !== "global") {
      if (state.ov.borders) drawLines(state.geo.borders, pal.coast, 0.6, [3, 3]);
      if (sc.region === "mongolia" || sc.focus) drawLines(state.geo.focus.rings, pal.ink, 1.6);
    }
    drawMines();
    drawPlaces(pl);
    drawSelection();
    if (divX < W) {
      ctx.fillStyle = pal.ink;
      ctx.fillRect(divX - 1, 0, 2, H);
      placeCmp();
    }
    if (imagery) drawCredit();
  }
  // cells, values and dots of the current dataset (state.sc) inside the strip x0..x1 of the canvas
  function drawField(x0, x1, lim, pl, imagery, dpr, cwPx, chPx) {
    const ctx = map.ctx, G = map.g, H = map.H, sc = state.sc, g = sc.grid;
    const cw = G.w / (G.lon1 - G.lon0) * g.dlon, ch = G.h / (G.lat1 - G.lat0) * g.dlat;
    ctx.save();
    ctx.beginPath(); ctx.rect(x0, 0, x1 - x0, H); ctx.clip();
    // over imagery the cells go to an offscreen layer first, so one opacity applies to the whole
    // field and the slight overlap between neighbouring cells does not show as a darker grid
    let cctx = ctx;
    if (imagery) {
      if (!map.layer) map.layer = document.createElement("canvas");
      if (map.layer.width !== cwPx || map.layer.height !== chPx) { map.layer.width = cwPx; map.layer.height = chPx; }
      cctx = map.layer.getContext("2d");
      cctx.setTransform(1, 0, 0, 1, 0, 0);
      cctx.clearRect(0, 0, cwPx, chPx);
      cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    // zoomed in far enough, each cell also shows its value, except where a place is labelled
    const labels = cw >= 40 && ch >= 18 && state.layer !== "verdict", marks = [];
    ctx.font = `10px ${cssVar("--font-data")}`;
    for (let j = 0; j < g.ny; j++) {
      const ya = Y(g.lat[j] + g.dlat / 2), yb = Y(g.lat[j] - g.dlat / 2);
      if (yb < 0 || ya > H) continue;
      for (let i = 0; i < g.nx; i++) {
        const xa = X(g.lon[i] - g.dlon / 2), xb = X(g.lon[i] + g.dlon / 2);
        if (xb < x0 || xa > x1) continue;
        const k = j * g.nx + i, look = cellLook(k, lim);
        if (!look) continue;
        cctx.fillStyle = rgb(look.col);
        cctx.fillRect(xa, ya, xb - xa + 0.6, yb - ya + 0.6);
        if (!labels) continue;
        const v = cellNumber(k);
        if (v === null || !Number.isFinite(v)) continue;
        const txt = state.layer === "emerge" ? String(v) : state.layer === "detect" ? fmt(v, 2) : signed(v, 2), tx = (xa + xb) / 2, ty = (ya + yb) / 2, hw = ctx.measureText(txt).width / 2 + 2;
        if (hits({ x0: tx - hw, x1: tx + hw, y0: ty - 7, y1: ty + 7 }, pl.taken)) continue;
        marks.push([txt, tx, ty, inkOn(look.col)]);
      }
    }
    if (imagery) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = state.baseAlpha;
      ctx.drawImage(map.layer, 0, 0);
      ctx.restore();
    }
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const [txt, tx, ty, ink] of marks) {
      if (imagery) { ctx.lineWidth = 2.5; ctx.strokeStyle = ink === "#000" ? "#fff" : "#000"; ctx.strokeText(txt, tx, ty); }
      ctx.fillStyle = ink;
      ctx.fillText(txt, tx, ty);
    }
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    if (state.ov.stipple && cw >= 3) {
      ctx.fillStyle = pal.ink;
      const r = Math.min(3, Math.max(0.8, cw / 7));
      for (let k = 0; k < state.res.status.length; k++) {
        const s = state.res.status[k];
        if (s !== 1 && s !== 2) continue;
        let x = X(g.lon[k % g.nx]), y = Y(g.lat[Math.floor(k / g.nx)]);
        if (labels) { x -= cw / 2 - 5; y -= ch / 2 - 5; }
        if (x < x0 - 4 || y < -4 || x > x1 + 4 || y > H + 4) continue;
        ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill();
      }
    }
    ctx.restore();
  }
  // short credit on the map; the full GIBS acknowledgement is in About and the Method tab
  function drawCredit() {
    const L = TDBasemap.LAYERS[state.base], st = TDBasemap.status(), ctx = map.ctx;
    const txt = `${t("base_credit")}: NASA GIBS · ${L.credit}${L.dated ? " · " + state.baseDate : ""}`;
    ctx.font = `10px ${cssVar("--font-ui")}`;
    const w = ctx.measureText(txt).width;
    ctx.fillStyle = rgb(pal.bg);
    ctx.globalAlpha = 0.85;
    ctx.fillRect(0, map.H - 18, w + 14, 18);
    ctx.globalAlpha = 1;
    ctx.fillStyle = pal.ink;
    ctx.fillText(txt, 7, map.H - 5);
    if (st.failures && !st.loads && !map.baseWarned) {
      map.baseWarned = true;
      const note = $("#mapnote");
      note.textContent = t("base_fail");
      note.hidden = false;
      setTimeout(() => { note.hidden = true; }, 5000);
    }
  }
  function schedulePaint() {
    if (map.raf) return;
    map.raf = requestAnimationFrame(() => { map.raf = 0; if (state.view === "map" && state.res) paint(); });
  }
  function resetView() { map.view = { z: 1, lon: null, lat: null }; }
  function viewChanged() { schedulePaint(); hideTip(); status(); }
  // zoom by factor f keeping the point under (px, py) fixed
  function zoomAt(px, py, f) {
    const v = map.view, G = map.g;
    if (!G) return;
    const z = Math.max(1, Math.min(map.zmax, v.z * f)), r = z / v.z;
    if (r === 1) return;
    const w = G.w * r, h = G.h * r, ox = px - (px - G.ox) * r, oy = py - (py - G.oy) * r;
    v.z = z;
    v.lon = G.lon0 + (map.W / 2 - ox) / w * (G.lon1 - G.lon0);
    v.lat = G.lat1 - (map.H / 2 - oy) / h * (G.lat1 - G.lat0);
    layout();
    viewChanged();
  }
  function panBy(dx, dy) {
    const v = map.view, G = map.g;
    if (!G || (!dx && !dy)) return;
    v.lon -= dx / G.w * (G.lon1 - G.lon0);
    v.lat += dy / G.h * (G.lat1 - G.lat0);
    layout();
    viewChanged();
  }
  function drawLines(rings, color, width, dash) {
    const ctx = map.ctx;
    ctx.save();
    ctx.beginPath(); ctx.rect(map.g.ox, map.g.oy, map.g.w, map.g.h); ctx.clip();
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash || []);
    for (const r of rings) {
      ctx.beginPath();
      for (let k = 0; k < r.length; k++) {
        const [lo, la] = r[k];
        if (k === 0 || Math.abs(lo - r[k - 1][0]) > 180) ctx.moveTo(X(lo), Y(la)); else ctx.lineTo(X(lo), Y(la));
      }
      ctx.stroke();
    }
    ctx.restore();
  }
  const placeName = (p) => (mn() ? p.mn : p.en);
  const inMap = (lat, lon) => lon >= map.g.lon0 && lon <= map.g.lon1 && lat >= map.g.lat0 && lat <= map.g.lat1;
  const hits = (r, list) => list.some((q) => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0);
  // where each place marker and label goes; a label that would overlap one already placed is dropped
  function placeLayout() {
    const ctx = map.ctx, sc = state.sc, z = map.view.z, list = [];
    if (state.ov.places) {
      if (sc.region === "mongolia") list.push(...state.places.filter((p) => p.cc === "MN"));
      else if (sc.region === "box") list.push(...state.places.filter((p) => p.cc === "MN" || p.kind === "capital"));
      else if (z >= 2) list.push(...state.places.filter((p) => p.kind === "capital"));
    }
    if (state.searched && !list.includes(state.searched)) list.push(state.searched);
    const rank = (p) => (p === state.searched ? 0 : ["capital", "mine", "airfield"].includes(p.kind) ? 1 : 2);
    list.sort((a, b) => rank(a) - rank(b));
    ctx.font = `11px ${cssVar("--font-ui")}`;
    const items = [], taken = [];
    for (const p of list) {
      if (!inMap(p.lat, p.lon)) continue;
      const x = X(p.lon), y = Y(p.lat);
      if (x < -8 || y < -8 || x > map.W + 8 || y > map.H + 8) continue;
      const it = { p, x, y, lx: null };
      items.push(it);
      taken.push({ x0: x - 5, x1: x + 5, y0: y - 5, y1: y + 5 });
      if (rank(p) === 2 && z < 2) continue;
      const tw = ctx.measureText(placeName(p)).width;
      // Ulaanbaatar reads best on its left, the southern sites on their right; fall back to the other side
      const sides = p.kind === "capital" && p.cc === "MN" ? [-1, 1] : [1, -1];
      for (const sd of sides) {
        const lx = sd > 0 ? x + 7 : x - 7 - tw, r = { x0: lx - 1, x1: lx + tw + 1, y0: y - 6, y1: y + 7 };
        if (r.x0 < 2 || r.x1 > map.W - 2 || hits(r, taken.slice(0, -1))) continue;
        it.lx = lx;
        taken.push(r);
        break;
      }
    }
    return { items, taken };
  }
  function drawPlaces(pl) {
    const ctx = map.ctx;
    ctx.font = `11px ${cssVar("--font-ui")}`;
    for (const { p, x, y, lx } of pl.items) {
      ctx.fillStyle = pal.ink;
      ctx.strokeStyle = rgb(pal.bg);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (p.kind === "mine" || p.kind === "airfield") ctx.rect(x - 3.5, y - 3.5, 7, 7); else ctx.arc(x, y, p === state.searched ? 5 : 2.6, 0, 2 * Math.PI);
      ctx.fill(); ctx.stroke();
      if (lx === null) continue;
      ctx.lineWidth = 3;
      ctx.strokeText(placeName(p), lx, y + 4);
      ctx.fillText(placeName(p), lx, y + 4);
    }
  }
  function drawSelection() {
    const ctx = map.ctx, g = state.sc.grid, sel = state.sel;
    ctx.strokeStyle = pal.ink; ctx.lineWidth = 2;
    if (sel && sel.type === "cell") {
      const j = Math.floor(sel.i / g.nx), i = sel.i % g.nx;
      const xa = X(g.lon[i] - g.dlon / 2), xb = X(g.lon[i] + g.dlon / 2), ya = Y(g.lat[j] + g.dlat / 2), yb = Y(g.lat[j] - g.dlat / 2);
      ctx.strokeRect(xa - 1.5, ya - 1.5, xb - xa + 3, yb - ya + 3);
    }
    const b = map.drag && map.drag.moved ? map.drag
      : (sel && sel.type === "box" ? { x0: X(sel.bounds[0]), x1: X(sel.bounds[2]), y0: Y(sel.bounds[3]), y1: Y(sel.bounds[1]) } : null);
    if (b) {
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1), Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
      ctx.setLineDash([]);
    }
  }
  function cellAt(x, y) {
    const g = state.sc.grid, lon = LON(x), lat = LAT(y);
    const i = Math.floor((lon - (g.lon[0] - g.dlon / 2)) / g.dlon), j = Math.floor((lat - (g.lat[0] - g.dlat / 2)) / g.dlat);
    return (i < 0 || j < 0 || i >= g.nx || j >= g.ny) ? -1 : j * g.nx + i;
  }
  function pointer(e) { const r = map.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  function drawSurface(lim) {
    const sc = state.sc, g = sc.grid, ncell = g.nx * g.ny;
    const h = new Float32Array(ncell).fill(NaN), color = new Array(ncell).fill(null);
    for (let k = 0; k < ncell; k++) {
      const look = cellLook(k, lim);
      if (!look) continue;
      color[k] = look.col;
      h[k] = Number.isFinite(look.h) ? Math.max(-1.6, Math.min(1.6, look.h)) : 0;
    }
    surface.setData({ nx: g.nx, ny: g.ny, lon0: g.lon[0] - g.dlon / 2, lon1: g.lon[g.nx - 1] + g.dlon / 2,
      lat0: g.lat[0] - g.dlat / 2, lat1: g.lat[g.ny - 1] + g.dlat / 2, aspect: baseGeom(sc).aspect, h, color,
      lines: state.ov.coast ? state.geo.land.concat(sc.region !== "global" ? state.geo.focus.rings : []) : [],
      bg: rgb(pal.bg), frame: pal.line, coast: pal.coast });
  }

  // ------------------------------------------------------------ hover, click, box
  function hideTip() { $("#tip").hidden = true; }
  function cellText(i) {
    const sc = state.sc, c = state.res.cells, st = state.res.status[i];
    if (st === 6) return t("v6");
    if (state.layer === "detect") return `±${fmt(c.mdt[i] * unitFactor())} ${unitText(sc)}`;
    if (state.layer === "emerge") return `${t("ey_by")} ${detectShort(detectArr()[i])}`;
    if (state.layer === "zone") {
      const z = zoneInfo();
      return z.cls[i] < 0 ? "–" : `${t("z" + z.cls[i])} · ${fmt(z.level[i])} ${unitLabel(sc.units)} ${t("per_month")} · ${c.sen[i] === null ? "–" : signed(c.sen[i] * unitFactor()) + " " + unitText(sc)}`;
    }
    if (state.layer === "anom") {
      const cube = annualCube(state.entry);
      return `${state.year}: ${signed(cube.data[i * cube.ny + cube.years.indexOf(state.year)])} ${unitLabel(sc.units)}`;
    }
    if (state.layer === "steps" && sc.steps[state.step]) {
      const s = sc.steps[state.step];
      return `${t("lg_step")}: ${signed(s.step[i])} ${unitLabel(sc.units)} (p ${fmtP(s.p_step[i])})`;
    }
    return c.sen[i] === null ? "–" : `${signed(c.sen[i] * unitFactor())} ${unitText(sc)}`;
  }
  function cellNumber(k) {
    const c = state.res.cells, sc = state.sc;
    switch (state.layer) {
      case "verdict": return null;
      case "detect": return c.mdt[k] === null ? null : c.mdt[k] * unitFactor();
      case "emerge": { const d = detectArr()[k]; return d && d.y <= CAP_YEAR ? d.y : null; }
      case "zone": { const z = zoneInfo(); return Number.isFinite(z.level[k]) ? z.level[k] : null; }
      case "anom": { const cube = annualCube(state.entry); return cube.data[k * cube.ny + cube.years.indexOf(state.year)]; }
      case "steps": { const st = sc.steps[state.step]; return st && st.step[k] !== null ? st.step[k] : null; }
      case "truth": return sc.truth ? sc.truth.slope[k] * unitFactor() : null;
      default: return c.sen[k] === null ? null : c.sen[k] * unitFactor();
    }
  }
  // mouse: drag pans, Shift-drag (or Box select) draws a box, wheel zooms; touch: one finger pans, two pinch
  function onMove(e) {
    if (state.view !== "map" || !state.res) return;
    const p = pointer(e);
    if (map.ptrs.has(e.pointerId)) map.ptrs.set(e.pointerId, p);
    if (map.pinch) {
      if (map.ptrs.size < 2) return;
      const [a, b] = [...map.ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      panBy(mx - map.pinch.mx, my - map.pinch.my);
      zoomAt(mx, my, d / map.pinch.d);
      map.pinch = { d, mx, my };
      return;
    }
    if (map.pan) {
      if (!map.pan.moved && Math.hypot(p.x - map.pan.x0, p.y - map.pan.y0) > 5) { map.pan.moved = true; map.canvas.classList.add("panning"); }
      if (map.pan.moved) { panBy(p.x - map.pan.x, p.y - map.pan.y); map.pan.x = p.x; map.pan.y = p.y; return; }
    }
    if (map.drag) {
      map.drag.x1 = p.x; map.drag.y1 = p.y;
      if (Math.hypot(p.x - map.drag.x0, p.y - map.drag.y0) > 6) map.drag.moved = true;
      if (map.drag.moved) { schedulePaint(); hideTip(); return; }
    }
    if (e.pointerType === "touch") return;
    if (cmpReady() && p.x > map.W * cmp.x) { withSide(() => hover(p)); return; }
    hover(p);
  }
  function hover(p) {
    const i = cellAt(p.x, p.y), tip = $("#tip"), st = i >= 0 ? state.res.status[i] : 0;
    if (i < 0 || st === 0) { tip.hidden = true; status({ cursor: null }); return; }
    const g = state.sc.grid, lat = g.lat[Math.floor(i / g.nx)], lon = g.lon[i % g.nx], txt = cellText(i);
    tip.innerHTML = `<div class="num">${ll(lat, lon)}</div><div><b>${esc(txt)}</b></div>${st >= 1 && st <= 5 ? `<div class="muted">${esc(t("v" + st))}</div>` : ""}`;
    tip.hidden = false;
    tip.style.left = Math.max(4, Math.min(p.x + 14, map.W - 220)) + "px";
    tip.style.top = Math.max(4, Math.min(p.y + 14, map.H - 76)) + "px";
    status({ cursor: ll(LAT(p.y), LON(p.x)), value: txt });
  }
  function onDown(e) {
    if (state.view !== "map" || !state.res || (e.pointerType === "mouse" && e.button !== 0)) return;
    const p = pointer(e);
    map.ptrs.set(e.pointerId, p);
    try { map.canvas.setPointerCapture(e.pointerId); } catch (err) { /* pointer already released */ }
    if (map.ptrs.size === 2) {
      const [a, b] = [...map.ptrs.values()];
      map.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      map.gesture = true; map.pan = null; map.drag = null;
      hideTip();
      return;
    }
    if (map.ptrs.size > 2) return;
    if (map.boxMode || e.shiftKey) map.drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, moved: false };
    else map.pan = { x0: p.x, y0: p.y, x: p.x, y: p.y, moved: false };
  }
  function releasePointer(e) {
    const had = map.ptrs.delete(e.pointerId);
    if (map.ptrs.size < 2) map.pinch = null;
    map.canvas.classList.remove("panning");
    return had;
  }
  function onUp(e) {
    if (!releasePointer(e) || state.view !== "map" || !state.res) return;
    // after a pinch, wait until every finger is up before a tap can select again
    if (map.gesture) { if (!map.ptrs.size) map.gesture = false; map.pan = null; map.drag = null; return; }
    const p = pointer(e), d = map.drag, pan = map.pan;
    map.drag = null; map.pan = null;
    if (d && d.moved) selectBox(d);
    else if (!(pan && pan.moved)) {
      const i = cellAt(p.x, p.y);
      if (i >= 0 && state.res.status[i] !== 0) { state.sel = { type: "cell", i }; renderInspector(); renderAnalysis(); }
    }
    paint();
  }
  function onCancel(e) {
    releasePointer(e);
    if (!map.ptrs.size) { map.gesture = false; map.pan = null; map.drag = null; schedulePaint(); }
  }
  function selectBox(d) {
    const g = state.sc.grid, st = state.res.status;
    const lonA = LON(Math.min(d.x0, d.x1)), lonB = LON(Math.max(d.x0, d.x1)), latA = LAT(Math.max(d.y0, d.y1)), latB = LAT(Math.min(d.y0, d.y1));
    const cells = [];
    for (let j = 0; j < g.ny; j++) {
      if (g.lat[j] < latA || g.lat[j] > latB) continue;
      for (let i = 0; i < g.nx; i++) {
        if (g.lon[i] < lonA || g.lon[i] > lonB) continue;
        const k = j * g.nx + i;
        if (st[k] >= 1 && st[k] <= 5) cells.push(k);
      }
    }
    state.sel = { type: "box", cells, bounds: [lonA, latA, lonB, latB] };
    renderInspector();
    renderAnalysis();
  }

  // ------------------------------------------------------------ layer picker, legend, timeline, status bar
  function availLayers() {
    const sc = state.sc;
    return LAYERS.filter((l) => (l !== "steps" || sc.steps.length) && (l !== "truth" || sc.truth) && (l !== "zone" || sc.clim12));
  }
  const layerIcon = (l) => `<svg viewBox="0 0 16 16" aria-hidden="true">${ICONS[l]}</svg>`;
  function renderPicker() {
    const avail = availLayers();
    if (!avail.includes(state.layer)) state.layer = "trend";
    $("#layerbtn").innerHTML = `${layerIcon(state.layer)}<span><span class="muted">${esc(t("layer_btn"))}:</span> <b>${esc(t(LAYER_KEY[state.layer]))}</b></span><span class="caret" aria-hidden="true">▾</span>`;
    $("#picker").innerHTML = avail.map((l) => `<button type="button" role="menuitemradio" data-layer="${l}" aria-checked="${l === state.layer}">${layerIcon(l)}<span><b>${esc(t(LAYER_KEY[l]))}</b><small>${esc(t(LAYER_KEY[l] + "_d"))}</small></span></button>`).join("")
      + (avail.includes("zone") ? "" : `<button type="button" role="menuitem" data-risk>${layerIcon("zone")}<span><b>${esc(t("L_zone"))}</b><small>${esc(t("L_zone_go"))}</small></span></button>`);
    $$("[data-risk]").forEach((b) => { if (b.closest(".toolbar")) { b.setAttribute("aria-pressed", state.layer === "zone"); b.classList.toggle("primary", state.layer === "zone"); } });
  }
  function setLayerMenu(open, focus) {
    const menu = $("#picker");
    menu.hidden = !open;
    $("#layerbtn").setAttribute("aria-expanded", open);
    if (open && focus) (menu.querySelector('[aria-checked="true"]') || menu.querySelector("button")).focus();
  }
  function countStatus(k) { let n = 0; for (const s of state.res.status) if (s === k) n++; return n; }
  function renderLegend(lim) {
    const sc = state.sc, el = $("#legend");
    const unitBtn = `<button type="button" class="unitbtn" id="unitbtn" title="${esc(t("lg_unit_hint"))}">${esc(unitText(sc))}</button>`;
    if (state.layer === "verdict") {
      const cols = verdictColors();
      el.innerHTML = [1, 2, 3, 4, 5, 6].map((k) => `<span><i class="sw" style="background:${rgb(cols[k])}"></i>${esc(t("v" + k))} <span class="num muted">${nf(countStatus(k))}</span></span>`).join("") + csvBtn("cells");
      return;
    }
    if (state.layer === "emerge") {
      const e0 = map.emergeY0 || state.y0, det = detectArr(), span = CAP_YEAR - e0, pos = (y) => (100 * (y - e0) / span).toFixed(1);
      const pNow = +pos(state.y1), tick = (y, at) => `<span style="left:${at}%">${y}</span>`;
      let a = 0, b = 0, c = 0;
      det.forEach((d, k) => { const s = state.res.status[k]; if (s < 1 || s > 5) return; if (!d || d.y > CAP_YEAR) c++; else if (d.y <= state.y1) a++; else b++; });
      el.innerHTML = `<span><b>${esc(t("lg_emerge"))}</b></span>
        <span><span class="ramp" style="display:block;background:linear-gradient(90deg,${rgb(pal.seq[255])},${rgb(pal.seq[128])},${rgb(pal.seq[0])})"><i class="now" style="left:${pos(state.y1)}%"></i></span>
        <span class="ticks pos">${pNow > 24 ? tick(e0, 0) : "<span></span>"}${tick(state.y1, pNow)}${pNow < 76 ? tick(CAP_YEAR, 100) : "<span></span>"}</span></span>
        <span><i class="sw" style="background:${rgb(pal.grid)}"></i>${esc(t("ey_after", { y: CAP_YEAR }))} / ${esc(t("ey_none"))}</span>
        <span class="num muted">${esc(t("ey_counts", { a: nf(a), b: nf(b), c: nf(c), y1: state.y1, cap: CAP_YEAR }))}</span>
        <span class="muted">${esc(t("lg_emergenote"))}</span>${csvBtn("cells")}`;
      return;
    }
    if (state.layer === "zone") {
      const z = zoneInfo(), se = seasonOf(sc), u = `${unitLabel(sc.units)} ${t("per_month")}`;
      el.innerHTML = [4, 3, 2, 1, 0].map((k) => `<span><i class="sw" style="background:${rgb(pal.seq[ZONE_SHADE[k]])}"></i>${esc(t("z" + k))} <span class="num muted">${nf(z.counts[k])}</span></span>`).join("")
        + `<span class="muted">${esc(t("lg_zone", { s: se ? seasonText(se) : t("se_all"), a: fmt(z.q1), b: fmt(z.q2), u, fdr: fmt(2 * state.alpha) }))}</span>${csvBtn("cells")}`;
      return;
    }
    if (state.layer === "detect") {
      el.innerHTML = `<span><b>${esc(t("lg_detect"))}</b></span><span><span class="ramp" style="display:block;background:linear-gradient(90deg,${rgb(pal.seq[0])},${rgb(pal.seq[128])},${rgb(pal.seq[255])})"></span>
        <span class="ticks"><span>0</span><span>${fmt(lim / 2)}</span><span>≥${fmt(lim)}</span></span></span>${unitBtn}${csvBtn("cells")}`;
      return;
    }
    const invert = WATER_VARS.has(sc.var);
    const stops = [0, 64, 128, 192, 256].map((k) => rgb(pal.div[k])).join(",");
    let what = t("lg_sen"), note = "", unit = unitBtn;
    if (state.layer === "trend") note = t("lg_full", { a: fmt(2 * state.alpha) });
    if (state.layer === "naive") note = t("lg_naive", { a: state.alpha });
    let dates = "";
    if (state.layer === "steps") {
      what = t("lg_step"); note = t("lg_stepnote"); unit = esc(unitLabel(sc.units));
      if (sc.steps.length > 1) dates = `<span class="seg" role="group">${sc.steps.map((s, k) => `<button type="button" data-step="${k}" aria-pressed="${k === state.step}">${esc(s.label.slice(0, 7))}</button>`).join("")}</span>`;
    }
    if (state.layer === "truth") what = t("lg_truth");
    if (state.layer === "anom") {
      const cube = annualCube(state.entry);
      what = t("lg_anom", { y: state.year }); unit = esc(unitLabel(sc.units));
      note = t("lg_anomnote", { y0: cube.years[0], y1: cube.years[cube.years.length - 1] });
    }
    el.innerHTML = `<span><b>${esc(what)}</b></span>${dates}
      <span><span class="ramp" style="display:block;background:linear-gradient(90deg,${stops})"></span>
      <span class="ticks"><span>${signed(invert ? lim : -lim)}</span><span>0</span><span>${signed(invert ? -lim : lim)}</span></span></span>
      ${unit}<span class="muted">${esc(invert ? t("lg_inc") : t("lg_dec"))} ← → ${esc(invert ? t("lg_dec") : t("lg_inc"))}</span>${csvBtn("cells")}
      <span class="muted">${note}</span>`;
  }
  function renderTimeline() {
    const cube = annualCube(state.entry), sl = $("#yearslider");
    sl.min = 0; sl.max = cube.years.length - 1;
    if (state.year === null || !cube.years.includes(state.year)) state.year = cube.years[cube.years.length - 1];
    sl.value = cube.years.indexOf(state.year);
    $("#yearlbl").textContent = state.year;
    const pb = $("#play"), key = state.playing ? "tl_pause" : "tl_play";
    pb.textContent = state.playing ? "❚❚" : "▶";
    pb.setAttribute("aria-label", t(key));
    pb.title = t(key);
  }
  function stopPlay() { if (state.playing) { clearInterval(state.playing); state.playing = null; } }
  function togglePlay() {
    if (state.playing) { stopPlay(); renderTimeline(); return; }
    state.layer = "anom";
    renderPicker();
    state.playing = setInterval(() => {
      const cube = annualCube(state.entry);
      state.year = cube.years[(cube.years.indexOf(state.year) + 1) % cube.years.length];
      renderTimeline();
      drawMap();
    }, 450);
    renderTimeline();
    drawMap();
  }
  function status(extra) {
    const sc = state.sc, r = state.res;
    if (!sc || !r) { $("#status").innerHTML = `<span>${esc(t("st_ready"))}</span>`; return; }
    state.statusExtra = Object.assign(state.statusExtra || {}, extra || {});
    const x = state.statusExtra;
    $("#status").innerHTML = [
      `<span>${esc(t("st_cursor"))}: <b>${x.cursor ? esc(x.cursor) : "–"}</b></span>`,
      `<span>${esc(t("st_value"))}: <b>${x.cursor && x.value ? esc(x.value) : "–"}</b></span>`,
      `<span>${esc(sceneTitle(sc))}</span>`,
      `<span>${esc(t("st_period"))}: <b>${esc(yrsText())}</b></span>`,
      `<span>α = <b>${state.alpha}</b> · FDR p* = <b>${fmt(r.pstar, 2)}</b></span>`,
      `<span>${esc(t("st_cells"))}: <b>${nf(r.counts.valid)}</b></span>`,
      `<span>${esc(t("st_zoom"))}: <b>×${fmt(map.view.z, 2)}</b></span>`,
    ].join("");
  }

  // ------------------------------------------------------------ charts
  function niceTicks(lo, hi, n = 4) {
    const span = hi - lo || 1, step0 = Math.pow(10, Math.floor(Math.log10(span / n)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * step0).find((s) => span / s <= n) || step0 * 10;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-12; v += step) out.push(+v.toFixed(10));
    return out;
  }
  /** Time series with an annual-mean line, Sen trend and CI over the chosen window, transition markers, hover. */
  function seriesChart(host, o) {
    const W = Math.max(240, host.clientWidth || 320), H = o.height || 170, m = { l: 40, r: 8, t: 10, b: 22 };
    const tt = o.t, y = o.y, fin = y.filter(Number.isFinite);
    if (!fin.length) { host.textContent = "–"; return; }
    let lo = Math.min(...fin), hi = Math.max(...fin);
    const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
    const t0 = tt[0] - (o.annual ? 0.5 : 0), t1 = tt[tt.length - 1] + (o.annual ? 0.5 : 1 / 12);
    const sx = (v) => m.l + (v - t0) / (t1 - t0) * (W - m.l - m.r), sy = (v) => m.t + (hi - v) / (hi - lo) * (H - m.t - m.b);
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label || "")}">`;
    if (o.window) {
      const [a, b] = o.window;
      if (a > t0) s += `<rect x="${sx(t0)}" y="${m.t}" width="${Math.max(0, sx(a) - sx(t0))}" height="${H - m.t - m.b}" fill="var(--panel-2)" opacity="0.85"/>`;
      if (b < t1) s += `<rect x="${sx(b)}" y="${m.t}" width="${Math.max(0, sx(t1) - sx(b))}" height="${H - m.t - m.b}" fill="var(--panel-2)" opacity="0.85"/>`;
    }
    for (const v of niceTicks(lo, hi)) {
      s += `<line x1="${m.l}" x2="${W - m.r}" y1="${sy(v)}" y2="${sy(v)}" stroke="var(--grid)"/><text x="${m.l - 5}" y="${sy(v) + 3}" text-anchor="end">${fmt(v, 2)}</text>`;
    }
    if (lo < 0 && hi > 0) s += `<line x1="${m.l}" x2="${W - m.r}" y1="${sy(0)}" y2="${sy(0)}" stroke="var(--axis)"/>`;
    for (const yr of niceTicks(t0, t1, 5)) s += `<text x="${sx(yr)}" y="${H - 6}" text-anchor="middle">${Math.round(yr)}</text>`;
    (o.markers || []).forEach((mk, k) => {
      const x = sx(mk.t);
      s += `<line x1="${x}" x2="${x}" y1="${m.t}" y2="${H - m.b}" stroke="var(--s2)" stroke-dasharray="3 3" stroke-width="1.4"/><text class="lbl" x="${x + 3}" y="${m.t + 9 + (k % 2) * 11}">${esc(mk.short)}</text>`;
    });
    const path = (ys, xs, off) => {
      let d = "", on = false;
      ys.forEach((v, k) => { if (!Number.isFinite(v)) { on = false; return; } d += (on ? "L" : "M") + sx(xs[k] + off).toFixed(1) + "," + sy(v).toFixed(1); on = true; });
      return d;
    };
    if (!o.annual && o.ann) {
      s += `<path d="${path(y, tt, 1 / 24)}" fill="none" stroke="var(--axis)" stroke-width="1"/>`;
      s += `<path d="${path(o.ann.vals, o.ann.years, 0.5)}" fill="none" stroke="var(--s1)" stroke-width="2"/>`;
    } else s += `<path d="${path(y, tt, 0)}" fill="none" stroke="var(--s1)" stroke-width="2"/>`;
    if (o.trend && Number.isFinite(o.trend.sen)) {
      const a = o.window ? Math.max(o.window[0], t0) : t0, b = o.window ? Math.min(o.window[1], t1) : t1;
      const tm = (a + b) / 2, ym = o.trend.intercept + o.trend.sen * tm;
      const line = (sl, dash, wdt) => `<line x1="${sx(a)}" y1="${sy(ym + sl * (a - tm))}" x2="${sx(b)}" y2="${sy(ym + sl * (b - tm))}" stroke="var(--ink)" stroke-width="${wdt}" ${dash ? 'stroke-dasharray="4 3" opacity="0.6"' : ""}/>`;
      if (Number.isFinite(o.trend.lo)) s += line(o.trend.lo, true, 1) + line(o.trend.hi, true, 1);
      s += line(o.trend.sen, false, 2);
    }
    s += `<line class="xh" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" stroke="var(--muted)" visibility="hidden"/><rect class="hit" x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent"/></svg><div class="tip" hidden></div>`;
    host.innerHTML = s;
    host.style.position = "relative";
    const svg = host.querySelector("svg"), xh = host.querySelector(".xh"), tip = host.querySelector(".tip");
    const src = o.annual || !o.ann ? { xs: tt, ys: y, off: o.annual ? 0 : 1 / 24 } : { xs: o.ann.years, ys: o.ann.vals, off: 0.5 };
    host.querySelector(".hit").addEventListener("pointermove", (e) => {
      const r = svg.getBoundingClientRect(), tv = t0 + ((e.clientX - r.left) / r.width * W - m.l) / (W - m.l - m.r) * (t1 - t0);
      let best = 0;
      src.xs.forEach((v, k) => { if (Math.abs(v + src.off - tv) < Math.abs(src.xs[best] + src.off - tv)) best = k; });
      const x = sx(src.xs[best] + src.off);
      xh.setAttribute("x1", x); xh.setAttribute("x2", x); xh.setAttribute("visibility", "visible");
      tip.innerHTML = `<span class="num">${Math.floor(src.xs[best] + src.off)}: ${signed(src.ys[best])} ${esc(o.unit || "")}</span>`;
      tip.hidden = false;
      tip.style.left = Math.min(x / W * r.width + 8, r.width - 140) + "px";
      tip.style.top = "4px";
    });
    host.querySelector(".hit").addEventListener("pointerleave", () => { xh.setAttribute("visibility", "hidden"); tip.hidden = true; });
  }

  /** Every start/end window of 10+ years: OLS slope (colour) and Santer p<0.05 (dot). */
  function triangle(host, years, vals, unit, invert) {
    const n = years.length, W = Math.max(240, host.clientWidth || 320), m = { l: 38, r: 6, t: 6, b: 28 };
    const cs = Math.max(3, Math.floor((W - m.l - m.r) / n)), H = m.t + m.b + cs * n;
    const cells = [];
    let lim = 0;
    for (let a = 0; a < n; a++) {
      for (let b = a + 9; b < n; b++) {
        const xs = years.slice(a, b + 1).map((v) => v + 0.5), ys = vals.slice(a, b + 1).map((v) => (v === null ? NaN : v));
        if (ys.some((v) => !Number.isFinite(v))) continue;
        const o = S.olsAr1(ys, xs);
        cells.push({ a, b, slope: o.ols * 10, p: o.p });
        lim = Math.max(lim, Math.abs(o.ols * 10));
      }
    }
    if (!cells.length) { host.textContent = t("tri_need"); return; }
    lim = lim || 1;
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="trend for every start and end year">`;
    for (const c of cells) {
      const x = m.l + c.a * cs, y = m.t + (n - 1 - c.b) * cs;
      s += `<rect x="${x}" y="${y}" width="${cs}" height="${cs}" fill="${rgb(divColor(c.slope, lim, invert))}" data-a="${c.a}" data-b="${c.b}" data-s="${c.slope}" data-p="${c.p}"/>`;
      if (c.p < 0.05 && cs >= 5) s += `<circle cx="${x + cs / 2}" cy="${y + cs / 2}" r="${Math.max(1, cs / 6)}" fill="var(--bg)" pointer-events="none"/>`;
    }
    const a0 = years.indexOf(Math.max(state.y0, years[0])), b0 = years.indexOf(state.y1);
    if (a0 >= 0 && b0 >= 0) s += `<rect x="${m.l + a0 * cs}" y="${m.t + (n - 1 - b0) * cs}" width="${cs}" height="${cs}" fill="none" stroke="var(--ink)" stroke-width="2" pointer-events="none"/>`;
    for (let k = 0; k < n; k += 10) {
      s += `<text x="${m.l + k * cs + cs / 2}" y="${H - 14}" text-anchor="middle">${years[k]}</text><text x="${m.l - 4}" y="${m.t + (n - 1 - k) * cs + cs / 2 + 4}" text-anchor="end">${years[k]}</text>`;
    }
    s += `<text class="lbl" x="${m.l}" y="${H - 1}">${esc(t("start_year"))}</text></svg><div class="tip" hidden></div>`;
    host.innerHTML = s;
    host.style.position = "relative";
    const tip = host.querySelector(".tip"), svg = host.querySelector("svg");
    svg.addEventListener("pointermove", (e) => {
      const r = e.target;
      if (!r.dataset || r.dataset.a === undefined) { tip.hidden = true; return; }
      tip.innerHTML = `<span class="num">${years[+r.dataset.a]}–${years[+r.dataset.b]}: ${signed(+r.dataset.s)} ${esc(unit)} · p ${fmtP(+r.dataset.p)}</span>`;
      tip.hidden = false;
      const br = svg.getBoundingClientRect();
      tip.style.left = Math.min(e.clientX - br.left + 10, br.width - 190) + "px";
      tip.style.top = Math.max(0, e.clientY - br.top - 34) + "px";
    });
    svg.addEventListener("pointerleave", () => { tip.hidden = true; });
  }

  // ------------------------------------------------------------ details pane
  function pill(st) {
    const cols = verdictColors();
    return `<span class="pill"><i style="background:${cols[st] ? rgb(cols[st]) : "transparent"}"></i>${esc(t("v" + (st || 0)))}</span>`;
  }
  // "Mar–May", "March"; long adds the season's name: "Mar–May (spring)"
  function seasonText(p, long) {
    if (!p || p.id === "all") return t("se_all");
    const named = long && ["djf", "mam", "jja", "son"].includes(p.id) ? ` (${t("se_" + p.id)})` : "";
    if (mn()) return (p.m0 === p.m1 ? `${p.m0}-р сар` : `${p.m0}–${p.m1}-р сар`) + named;
    const M = t("months").split(" ");
    return (p.m0 === p.m1 ? M[p.m0 - 1] : `${M[p.m0 - 1].slice(0, 3)}–${M[p.m1 - 1].slice(0, 3)}`) + named;
  }
  // "1981–2025" or "1981–2025, Mar–May"
  const yrsText = (sc = state.sc, y0 = state.y0, y1 = state.y1) => { const se = seasonOf(sc); return `${y0}–${y1}${se ? ", " + seasonText(se) : ""}`; };
  const periodText = () => {
    const se = seasonOf(state.sc);
    return t(state.sc.live && !se ? "period_live" : isFull() && !se ? "period_full" : "period_custom",
      { y0: state.y0, y1: state.y1, kind: se ? t("kind_season", { s: seasonText(se) }) : t(state.sc.series.kind === "monthly" ? "kind_monthly" : "kind_annual") });
  };
  function renderSummary() {
    const sc = state.sc, r = state.res, k = r.counts, el = $("#summary");
    const rm = sc.region_means[0], rs = r.regionStats[0], title = sceneTitle(sc), yrs = yrsText();
    let head;
    if (mn()) {
      head = `<b>${esc(title)}</b>, ${esc(sceneRegion(sc))}, ${yrs}. ${nf(k.valid)} нүдний <strong>${nf(k.fdr)}</strong> нь FDR тестийг давсан чигтэй (${nf(k.fdr_up)} өсөлт, ${nf(k.fdr_down)} бууралт); энгийн тест <strong>${nf(k.naive)}</strong> нүдийг тэмдэглэх байсан.`;
      if (rm && rs) head += ` ${esc(regionName(rm))}: <strong>${signed(rs.sen)}</strong> ${esc(unitLabel(rm.units))} арван жилд (95% завсар ${fmt(rs.sen_lo)}–${fmt(rs.sen_hi)}, засварласан p ${fmtP(rs.p_mk)}).`;
      if (rm && rs) head += " " + esc(detectSentence(detectYear(rs.nstar, rs.sen, rs.sen_lo, rs.sen_hi, rs.phi, rs.n)));
    } else {
      head = `<b>${esc(title)}</b>, ${esc(sceneRegion(sc))}, ${yrs}. <strong>${nf(k.fdr)}</strong> of ${nf(k.valid)} cells show a trend that survives the false discovery rate test (${nf(k.fdr_up)} up, ${nf(k.fdr_down)} down); a naive test would flag <strong>${nf(k.naive)}</strong>.`;
      if (rm && rs) head += ` ${esc(regionName(rm))}: <strong>${signed(rs.sen)}</strong> ${esc(unitLabel(rm.units))} per decade (95% CI ${fmt(rs.sen_lo)} to ${fmt(rs.sen_hi)}, corrected p ${fmtP(rs.p_mk)}).`;
      if (rm && rs) head += " " + esc(detectSentence(detectYear(rs.nstar, rs.sen, rs.sen_lo, rs.sen_hi, rs.phi, rs.n)));
    }
    const chips = [[k.valid, "c_tested"], [k.naive, "c_naive"], [k.fdr, "c_fdr"], [k.robust, "c_robust"], [k.not_yet, "c_notyet"]];
    if (k.gappy) chips.push([k.gappy, "c_gappy"]);
    if (sc.steps.length) chips.push([k.step_flagged, "c_steps"]);
    const warns = [];
    if (sc.live) {
      const li = sc.live_info;
      warns.push({ sev: "", w: t("live_read", { mb: li.mb, n: li.chunks, when: li.read.slice(0, 16).replace("T", " ") }) });
      if (li.trimmed) warns.push({ sev: "", w: t("live_trim", { a: li.trimmed.from, b: li.trimmed.to }) });
      if (sc.counts.gappy) warns.push({ sev: "critical", w: t("live_gappy", { n: nf(sc.counts.gappy) }) });
      sc.transitions.forEach((tr) => warns.push({ sev: "", w: t("live_tr", { d: tr.date || "?", l: tr.label }) }));
    } else if (sc.counts.gappy) {
      warns.push({ sev: "critical", w: mn()
        ? `${nf(sc.counts.gappy)} нүдэнд зарим сар дутуу тул нөхөж тооцолгүй хассан. Нийлүүлэгч [${sc.valid_min}, ${sc.valid_max}] мужаас гадуурх утгыг хасдаг тул дутуу сарууд нь бодит туйлын утга байж болно; тэдгээрийг хасаад тооцсон чиг цензурдсан болно.`
        : (sc.data_warnings || [])[0] || "" });
    }
    const se = seasonOf(sc);
    if (se) {
      warns.push({ sev: "", w: t("season_warn", { s: seasonText(se) }) });
      if (r.y0eff > state.y0) warns.push({ sev: "", w: t("season_first", { s: seasonText(se), y: r.y0eff, p: state.y0 - 1 }) });
    } else if (state.season !== "all") warns.push({ sev: "", w: t("season_na") });
    if (k.flat) warns.push({ sev: "", w: t("flat_cells", { n: nf(k.flat) }) });
    (sc.notes || []).forEach((w) => warns.push({ sev: "", w: noteText(w) }));
    (sc.live ? [] : sc.transitions || []).filter((tr) => !tr.verified).forEach((tr) => warns.push({ sev: "", w: mn() ? noteText(tr.label) : `${tr.label}. Not tested: date unconfirmed.` }));
    el.innerHTML = `<p class="eyebrow">${esc(t("d_dataset"))}</p><h3>${esc(title)}</h3>
      <p class="small muted">${esc(sc.product_name)} · ${esc(periodText())}</p>
      <p class="headline">${head}</p>
      <div class="chips">${chips.map(([v, l]) => `<div class="chip"><b>${nf(v)}</b><span>${esc(t(l))}</span></div>`).join("")}</div>
      ${warns.map(({ w, sev }) => `<div class="warn ${sev}"><span class="icon" aria-hidden="true">!</span><p>${esc(w)}</p></div>`).join("")}
      ${cmpSummary()}`;
  }
  function statsList(st, sc, extra = "") {
    const f = unitFactor();
    return `<dl class="kv">
      <dt>${esc(t("s_ci"))}</dt><dd>[${fmt(st.lo * f)}, ${fmt(st.hi * f)}]</dd>
      <dt>${esc(t("s_pnaive"))}</dt><dd>${fmtP(st.pNaive)}</dd>
      <dt>${esc(t("s_pmk"))}</dt><dd>${fmtP(st.pMk)}</dd>
      <dt>${esc(t("s_pols"))}</dt><dd>${fmtP(st.pOls)}</dd>
      <div class="sep"></div>
      <dt>${esc(t("s_phi"))}</dt><dd>${fmt(st.phi, 2)}</dd>
      <dt>${esc(t("s_sigma"))} (${esc(unitLabel(sc.units))})</dt><dd>${fmt(st.sigma)}</dd>
      <dt>${esc(t("s_mdt"))}</dt><dd>±${fmt(st.mdt * f)}</dd>
      <dt>${esc(t("s_nstar"))}</dt><dd>${st.nstar === null || st.nstar === Infinity ? "∞" : fmt(st.nstar, 2)} (${esc(t("s_have", { n: fmt(st.years, 3) }))})</dd>
      <dt>${esc(t("s_detect_year"))}</dt><dd>${esc(detectShort(detectYear(st.nstar, st.sen, st.lo, st.hi, st.phi, st.m)))}</dd>
      ${extra}</dl><p class="small muted">${esc(t("s_units", { u: unitText(sc) }))}</p>`;
  }
  function stepRows(i) {
    const sc = state.sc;
    if (!sc.steps.length) return "";
    return `<div class="sep"></div>` + sc.steps.map((s) => `<dt>${esc(t("s_step", { d: s.label.slice(0, 7) }))} ${s.flag[i] ? `<b class="yes">${esc(t("s_flag"))}</b>` : ""} <span class="muted">(${esc(t("full_only"))})</span></dt><dd>${signed(s.step[i])} (p ${fmtP(s.p_step[i])})</dd>
      <dt>${esc(t("s_tws"))}</dt><dd>${signed(s.trend_with_step[i])}</dd>`).join("");
  }
  const markers = (sc) => sc.steps.map((s) => ({ t: s.t_break, short: s.label.slice(0, 7) }));
  const chartWindow = () => [state.y0, state.y1 + 1];

  function renderInspector() {
    const sc = state.sc, el = $("#inspector"), sel = state.sel;
    state.exportSeries = null;
    if (!sel) { el.innerHTML = `<p class="eyebrow">${esc(t("d_selection"))}</p><p class="muted">${esc(t("sel_hint"))}</p>`; return; }
    const tt = seriesTimes(sc), cube = annualCube(state.entry);
    if (sel.type === "cell") {
      const c = state.res.cells, i = sel.i, g = sc.grid, st = state.res.status[i];
      const lat = g.lat[Math.floor(i / g.nx)], lon = g.lon[i % g.nx];
      if (st === 6 || c.sen[i] === null) {
        el.innerHTML = `<p class="eyebrow">${esc(t("d_cell"))} ${ll(lat, lon)}</p>${pill(st)}<p class="muted">${esc(t(state.res.flat && state.res.flat.has(i) ? "flat_cell" : "gappy_cell"))}</p>`;
        return;
      }
      const y = Array.from(cellSeries(i)), sen = c.sen[i] / 10;
      const ann = { years: cube.years, vals: Array.from(cube.data.subarray(i * cube.ny, (i + 1) * cube.ny)) }, se = seasonOf(sc);
      const sub = subsetAnnual(ann.years, ann.vals, state.y0, state.y1, cube.off);
      const intercept = S.median(sub.vs.map((v, k) => v - sen * sub.ys[k]).filter(Number.isFinite));
      el.innerHTML = `<p class="eyebrow eyebtn">${esc(t("d_cell"))} ${ll(lat, lon)} ${csvBtn("series")}</p>${pill(st)}
        <div><span class="big">${signed(c.sen[i] * unitFactor())}</span> <span class="muted">${esc(unitText(sc))}</span></div>
        <div id="cellchart"></div>
        ${statsList({ sen: c.sen[i], lo: c.sen_lo[i], hi: c.sen_hi[i], pNaive: c.p_naive[i], pMk: c.p_mk[i], pOls: c.p_ols[i], phi: c.phi[i], sigma: c.sigma[i],
          mdt: c.mdt[i], nstar: c.nstar[i], years: state.res.years, m: cellSamples() }, sc,
          `<dt>${esc(t(se ? "s_mean_all" : "s_mean"))}</dt><dd>${fmt(sc.cells.clim_mean[i])} ${esc(unitLabel(sc.units))}</dd>` +
          (state.res.custom ? "" : `<dt>${esc(t("s_hr"))}</dt><dd>${fmtP(c.p_hr_empirical[i])}</dd>`) + stepRows(i))}`;
      const chart = se ? { t: cube.years.map((v) => v + cube.off), y: ann.vals, annual: true }
        : { t: tt, y, ann: sc.series.kind === "monthly" ? ann : null, annual: sc.series.kind === "annual" };
      seriesChart($("#cellchart"), Object.assign(chart, { unit: unitLabel(sc.units),
        trend: { sen, lo: c.sen_lo[i] / 10, hi: c.sen_hi[i] / 10, intercept }, markers: markers(sc), window: chartWindow(), label: "cell series" }));
      const used = sc.series.kind === "monthly" && !se ? monthlyWindow(y, sc.series.start, state.y0, state.y1) : { x: sub.vs, t: sub.ys };
      state.exportSeries = { what: `cell_${llTag(lat, lon)}`, where: [["cell_lat", lat], ["cell_lon", lon]], x: used.x, t: used.t, pre: !state.res.custom,
        stats: { sen: c.sen[i], sen_lo: c.sen_lo[i], sen_hi: c.sen_hi[i], p_naive: c.p_naive[i], p_mk: c.p_mk[i], p_ols: c.p_ols[i], phi: c.phi[i],
          sigma: c.sigma[i], mdt: c.mdt[i], nstar: c.nstar[i], detect: detectArr()[i], verdict: st } };
      if (cmpReady()) el.insertAdjacentHTML("beforeend", cmpCellBlock(lon, lat));
      return;
    }
    if (!sel.cells.length) { el.innerHTML = `<p class="eyebrow">${esc(t("d_selection"))}</p><p class="muted">${esc(t("box_empty"))}</p>`; return; }
    const g = sc.grid, acc = new Float64Array(cube.ny), ws = new Float64Array(cube.ny);
    for (const k of sel.cells) {
      const w = Math.cos(g.lat[Math.floor(k / g.nx)] * Math.PI / 180);
      for (let q = 0; q < cube.ny; q++) { const v = cube.data[k * cube.ny + q]; if (Number.isFinite(v)) { acc[q] += w * v; ws[q] += w; } }
    }
    const annVals = Array.from(acc, (v, q) => (ws[q] ? v / ws[q] : NaN));
    let r, kind;
    const se = seasonOf(sc);
    if (sc.series.kind === "monthly" && !se) {
      const n = sc.series.n, mAcc = new Float64Array(n), mW = new Float64Array(n);
      for (const k of sel.cells) {
        const w = Math.cos(g.lat[Math.floor(k / g.nx)] * Math.PI / 180), y = cellSeries(k);
        for (let q = 0; q < n; q++) if (Number.isFinite(y[q])) { mAcc[q] += w * y[q]; mW[q] += w; }
      }
      const win = monthlyWindow(Array.from(mAcc, (v, q) => (mW[q] ? v / mW[q] : NaN)), sc.series.start, state.y0, state.y1);
      r = S.analyze(win.x, win.t);
      if (r) r.used = win;
      kind = t("kind_monthly");
    } else {
      const sub = subsetAnnual(cube.years, annVals, state.y0, state.y1, cube.off);
      r = S.analyze(sub.vs, sub.ys);
      kind = se ? t("kind_season", { s: seasonText(se) }) : t("kind_annual");
    }
    if (!r || !(r.varS > 0)) { el.innerHTML = `<p class="muted">${esc(t(r ? "flat_cell" : "tri_need"))}</p>`; return; }
    const [lonA, latA, lonB, latB] = sel.bounds;
    const st = r.pMk < state.alpha ? (r.pOls < state.alpha ? 1 : 2) : (r.nstar > r.years ? 4 : 5);
    const used = sc.series.kind === "monthly" && !se ? r.used : (() => { const a = subsetAnnual(cube.years, annVals, state.y0, state.y1, cube.off); return { x: a.vs, t: a.ys }; })();
    state.exportSeries = { what: "box", where: [["box_west", lonA], ["box_south", latA], ["box_east", lonB], ["box_north", latB], ["box_cells", sel.cells.length]],
      x: used.x, t: used.t, stats: { sen: r.sen * 10, sen_lo: r.senLo * 10, sen_hi: r.senHi * 10, p_naive: r.pNaive, p_mk: r.pMk, p_ols: r.pOls,
        phi: r.phi, sigma: r.sigma, mdt: r.mdt * 10, nstar: r.nstar, detect: detectYear(r.nstar, r.sen * 10, r.senLo * 10, r.senHi * 10, r.phi, r.n), verdict: st } };
    el.innerHTML = `<p class="eyebrow eyebtn">${esc(t("d_box", { a: ll(latA, lonA), b: ll(latB, lonB) }))} ${csvBtn("series")}</p>
      <p class="small muted">${esc(t("box_note", { n: nf(sel.cells.length), kind }))}</p>${pill(st)}
      <div><span class="big">${signed(r.sen * 10 * unitFactor())}</span> <span class="muted">${esc(unitText(sc))}</span></div>
      <div id="cellchart"></div>
      ${statsList({ sen: r.sen * 10, lo: r.senLo * 10, hi: r.senHi * 10, pNaive: r.pNaive, pMk: r.pMk, pOls: r.pOls, phi: r.phi, sigma: r.sigma, mdt: r.mdt * 10, nstar: r.nstar, years: r.years, m: r.n }, sc)}`;
    seriesChart($("#cellchart"), { t: cube.years.map((v) => v + cube.off), y: annVals, annual: true, unit: unitLabel(sc.units),
      trend: { sen: r.sen, lo: r.senLo, hi: r.senHi, intercept: r.intercept }, markers: markers(sc), window: chartWindow(), label: "box mean" });
  }

  // the right half's cell at the same place, for the details pane
  function cmpCellBlock(lon, lat) {
    const k = cmpCellAt(lon, lat);
    return withSide(() => {
      const sc = state.sc, c = state.res.cells, st = k < 0 ? 0 : state.res.status[k];
      const head = `<div class="section cmpcell"><p class="eyebrow">${esc(t("cmp_right"))} · ${esc(sceneTitle(sc))} · ${esc(yrsText())}</p>`;
      if (k < 0 || !st || st === 6 || c.sen[k] === null) return head + `${pill(st)}</div>`;
      return head + `${pill(st)}<div><span class="big">${signed(c.sen[k] * unitFactor())}</span> <span class="muted">${esc(unitText(sc))}</span></div>
        <dl class="kv"><dt>${esc(t("s_ci"))}</dt><dd>[${fmt(c.sen_lo[k] * unitFactor())}, ${fmt(c.sen_hi[k] * unitFactor())}]</dd>
        <dt>${esc(t("s_pmk"))}</dt><dd>${fmtP(c.p_mk[k])}</dd>
        <dt>${esc(t("s_detect_year"))}</dt><dd>${esc(detectShort(detectArr()[k]))}</dd></dl></div>`;
    });
  }
  // left against right: area means and, on a shared grid, cell by cell
  function cmpSummary() {
    if (!cmpReady()) return "";
    const L = { sc: state.sc, res: state.res, y0: state.y0, y1: state.y1 };
    const R = { sc: cmp.entry.sc, res: cmp.res, y0: cmp.y0, y1: cmp.y1 };
    const col = (o) => {
      const rm = o.sc.region_means[0], rs = o.res.regionStats[0], k = o.res.counts;
      const d = rs ? (o === L ? detectYear(rs.nstar, rs.sen, rs.sen_lo, rs.sen_hi, rs.phi, rs.n) : withSide(() => detectYear(rs.nstar, rs.sen, rs.sen_lo, rs.sen_hi, rs.phi, rs.n))) : null;
      return { head: `${esc(sceneTitle(o.sc))} <span class="muted">${o.y0}–${o.y1}</span>`, area: rm ? regionName(rm) : "",
        vals: [rm && rs ? `<b>${signed(rs.sen)}</b><br>[${fmt(rs.sen_lo)}, ${fmt(rs.sen_hi)}]` : "–",
          rs ? fmtP(rs.p_mk) : "–", `${nf(k.fdr)} / ${nf(k.valid)}`, esc(detectShort(d))] };
    };
    const ca = col(L), cb = col(R), rows = ["cmp_row_trend", "cmp_row_p", "cmp_row_fdr", "s_detect_year"];
    const area = ca.area === cb.area ? ca.area : `${ca.area} / ${cb.area}`;
    let cells = "";
    const gl = L.sc.grid, gr = R.sc.grid;
    const same = gl.nx === gr.nx && gl.ny === gr.ny && gl.lat.every((v, j) => Math.abs(v - gr.lat[j]) < 1e-6) && gl.lon.every((v, i) => Math.abs(v - gr.lon[i]) < 1e-6);
    if (same) {
      let n = 0, sign = 0, both = 0, opp = 0;
      for (let k = 0; k < L.res.status.length; k++) {
        const sl = L.res.status[k], sr = R.res.status[k];
        if (sl < 1 || sl > 5 || sr < 1 || sr > 5 || L.res.cells.sen[k] === null || R.res.cells.sen[k] === null) continue;
        n++;
        const agree = Math.sign(L.res.cells.sen[k]) === Math.sign(R.res.cells.sen[k]);
        if (agree) sign++;
        if ((sl === 1 || sl === 2) && (sr === 1 || sr === 2)) { if (agree) both++; else opp++; }
      }
      cells = `<div class="cmp"><div class="chip"><b>${n ? Math.round(100 * sign / n) : 0}%</b><span>${esc(t("cmp_sign"))}</span></div>
        <div class="chip"><b>${nf(both)} / ${nf(opp)}</b><span>${esc(t("cmp_both"))}</span></div></div>`;
    }
    return `<div class="section"><p class="eyebrow">${esc(t("cmp_title"))}</p>
      <table class="cmptable"><thead><tr><th></th><th>${esc(t("cmp_left"))}<br>${ca.head}</th><th>${esc(t("cmp_right"))}<br>${cb.head}</th></tr></thead><tbody>
      ${rows.map((r, q) => `<tr><th>${esc(t(r))}${q === 0 && area ? `<br><span class="muted">${esc(area)}</span>` : ""}</th><td class="num">${ca.vals[q]}</td><td class="num">${cb.vals[q]}</td></tr>`).join("")}</tbody></table>
      ${cells}<p class="small muted">${esc(t("cmp_nodiff"))}</p></div>`;
  }

  // ------------------------------------------------------------ CSV export
  // Column names and verdicts are in English whatever the interface language, so files read the same
  // everywhere; "# key: value" lines on top carry the context (pandas: read_csv(path, comment="#")).
  const csvBtn = (what, k) => `<button type="button" class="csvbtn" data-csv="${what}"${k ? ` data-k="${k}"` : ""} title="${esc(t("csv_title"))}">⤓ ${esc(t("csv"))}</button>`;
  const llTag = (lat, lon) => `${Math.abs(lat).toFixed(2)}${lat >= 0 ? "N" : "S"}_${Math.abs(lon).toFixed(3)}${lon >= 0 ? "E" : "W"}`;
  function csvCell(v) {
    if (v === null || v === undefined || (typeof v === "number" && Number.isNaN(v))) return "";
    if (v === Infinity) return "never";
    const s = typeof v === "number" ? String(+v.toPrecision(10)) : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  // "# key: value" lines are read whole, so no quoting there
  const metaVal = (v) => (typeof v === "number" ? csvCell(v) : String(v ?? "").replace(/[\r\n]+/g, " "));
  // decimal time (mid-month or mid-year) back to YYYY-MM or YYYY
  const tLabel = (tv, monthly) => (monthly ? `${Math.floor(tv)}-${String(Math.floor((tv - Math.floor(tv)) * 12 + 1e-6) + 1).padStart(2, "0")}` : String(Math.floor(tv)));
  function csvMeta(extra) {
    const sc = state.sc, r = state.res;
    const meta = [["tool", "Trend Detective"], ["generated_utc", new Date().toISOString().slice(0, 19) + "Z"],
      ["page", `${location.href.split("#")[0]}#${sc.id}`], ["dataset", `${sc.id}: ${sc.title}`], ["product", sc.product_name],
      ["variable", `${sc.var} (${sc.long_name || sc.title})`], ["units", sc.units], ["region", sc.region_name],
      ["years", `${state.y0}-${state.y1}`], ["months", seasonCsv(sc)], ["alpha", state.alpha], ["alpha_fdr", 2 * state.alpha], ["fdr_p_threshold", r.pstar],
      ["trend_method", "Theil-Sen slope per decade; CI 95 %; p_corrected = Mann-Kendall with the Hamed-Rao correction (AR(1)); p_ols_ar1 = OLS with AR(1) effective n (Santer 2000)"],
      ["detectable_by_method", "start year + ceil(n*) - 1, n* = years for 90 % detection at 5 % (Weatherhead et al. 1998), if the trend continues; low/high from the Sen CI and e^+-B"]];
    if (sc.live) meta.push(["read_live", `${sc.live_info.read} from NASA POWER on AWS`]);
    return meta.concat(extra || []).map(([k, v]) => `# ${k}: ${metaVal(v)}`);
  }
  const VERDICT_EN = (code) => I.en("v" + code);
  function seasonCsv(sc) {
    const se = seasonOf(sc);
    if (!se) return sc.series.kind === "monthly" ? "all (monthly values)" : "all (annual means)";
    const M = I.en("months").split(" "), name = SEA.months(se.m0, se.m1).map((m) => M[m - 1].slice(0, 3)).join("-");
    return `${name}: one mean per year${se.m0 > se.m1 ? ", counted in the year of its last month" : ""}; a year with any of these months missing is left out`;
  }
  function csvCells() {
    const sc = state.sc, g = sc.grid, c = state.res.cells, st = state.res.status, det = detectArr(), z = sc.clim12 ? zoneInfo() : null;
    const rows = [["lat", "lon", "verdict_code", "verdict", "trend_per_decade", "trend_ci_low", "trend_ci_high", "p_naive", "p_corrected", "p_ols_ar1",
      "significant_fdr", "phi", "noise_sd", "min_detectable_trend_per_decade", "years_to_detect", "detectable_by", "detectable_by_low", "detectable_by_high", "mean_value"]
      .concat(z ? ["level_per_month_in_months", "risk_zone"] : [])];
    for (let k = 0; k < st.length; k++) {
      const s = st[k], ok = s >= 1 && s <= 5, d = det[k];
      rows.push([g.lat[Math.floor(k / g.nx)], g.lon[k % g.nx], s, VERDICT_EN(s), ok ? c.sen[k] : null, ok ? c.sen_lo[k] : null, ok ? c.sen_hi[k] : null,
        ok ? c.p_naive[k] : null, ok ? c.p_mk[k] : null, ok ? c.p_ols[k] : null, ok ? (s === 1 || s === 2 ? 1 : 0) : null, ok ? c.phi[k] : null,
        ok ? c.sigma[k] : null, ok ? c.mdt[k] : null, ok ? c.nstar[k] : null, d ? d.y : null, d ? d.lo : null, d ? d.hi : null, c.clim_mean[k]]
        .concat(z ? [Number.isFinite(z.level[k]) ? z.level[k] : null, z.cls[k] >= 0 ? I.en("z" + z.cls[k]) : ""] : []));
    }
    const k = state.res.counts;
    return { name: `cells`, meta: [["rows", "one per grid cell (centre lat/lon); verdict_code 0 = no data, 6 = months missing; mean_value = mean of all months of the record"
      + (z ? `; level_per_month_in_months = whole-record mean per month in the chosen months; risk_zone = level in thirds across the map (cut at ${+z.q1.toPrecision(4)} and ${+z.q2.toPrecision(4)}) and FDR-significant upward trend` : "")],
      ["cells_tested", k.valid], ["cells_significant_fdr", k.fdr]], rows };
  }
  function csvSeries(x, tt, stats, where, what, pre) {
    const sc = state.sc, monthly = sc.series.kind === "monthly" && tt.length > 1 && tt[1] - tt[0] < 0.5;
    const s = stats || {}, d = s.detect;
    const meta = where.concat([
      ["values", monthly ? "monthly anomalies, calendar-month means of the chosen years removed (the input to the statistics)"
        : seasonOf(sc) ? "season means of the monthly anomalies (departures from the whole record's calendar-month means), one per year (the input to the statistics)"
          : "annual means as anomalies (the input to the statistics)"],
      ["statistics_from", pre ? "full-precision data when the dataset was built; the values below are the page's rounded copy, so a recomputation from them can differ in the 3rd-4th significant digit"
        : "exactly the values in this file, computed in the browser"],
      ["trend_per_decade", s.sen], ["trend_ci_low", s.sen_lo], ["trend_ci_high", s.sen_hi], ["p_naive", s.p_naive], ["p_corrected", s.p_mk],
      ["p_ols_ar1", s.p_ols], ["phi", s.phi], ["noise_sd", s.sigma], ["min_detectable_trend_per_decade", s.mdt], ["years_to_detect", s.nstar],
      ["detectable_by", d ? `${csvCell(d.y)} (range ${csvCell(d.lo)} to ${csvCell(d.hi)})` : ""]].concat(s.verdict !== undefined ? [["verdict", VERDICT_EN(s.verdict)]] : []));
    const rows = [[monthly ? "month" : "year", "anomaly"]];
    tt.forEach((tv, q) => rows.push([tLabel(tv, monthly), Number.isFinite(x[q]) ? x[q] : null]));
    return { name: what, meta, rows };
  }
  function csvRegion(k) {
    const sc = state.sc, rm = sc.region_means[k], s = state.res.regionStats[k];
    const ry = seasonOf(sc) && regionYears(rm), sub = ry && subsetAnnual(ry.years, ry.vals, state.y0, state.y1, ry.off);
    const w = ry ? { x: sub.vs, t: sub.ys } : monthlyWindow(rm.monthly, rm.monthly_start, state.y0, state.y1);
    const d = s ? detectYear(s.nstar, s.sen, s.sen_lo, s.sen_hi, s.phi, s.n) : null;
    return csvSeries(w.x, w.t, s && { sen: s.sen, sen_lo: s.sen_lo, sen_hi: s.sen_hi, p_naive: s.p_naive, p_mk: s.p_mk, p_ols: s.p_ols_ar1,
      phi: s.phi, sigma: s.sigma, mdt: s.mdt, nstar: s.nstar, detect: d }, [["area", `${rm.name}; ${rm.how === "area_sum" ? "area sum" : "cos-latitude weighted mean"}`]], rm.key, !state.res.custom);
  }
  function csvScreen() {
    const rows = [["variable", "long_name", "units", "source", "start_year", "end_year", "trend_per_decade", "trend_ci_low", "trend_ci_high",
      "change_in_noise_sd", "change_percent_of_mean", "p_naive", "p_corrected", "significant_fdr"]];
    for (const r of screenRows()) {
      const s = r.stats || {};
      rows.push([r.var, r.long_name, r.units, r.product, r.start, state.y1, s.sen, s.sen_lo, s.sen_hi, r.change_sd, r.change_pct, s.p_naive, s.p_mk, r.fdr ? 1 : 0]);
    }
    return { name: "screen", meta: [["rows", "every screened variable, area mean over Mongolia; significant_fdr from a variable-level FDR (variables are correlated: a guide, not a test)"]], rows };
  }
  async function exportCsv(what, k) {
    const sc = state.sc;
    let out;
    if (what === "cells") out = csvCells();
    else if (what === "series") {
      const e = state.exportSeries;
      if (!e) { modal(`<p>${esc(t("csv_none"))}</p>`); return; }
      out = csvSeries(e.x, e.t, e.stats, e.where, e.what, e.pre);
    } else if (what === "region") out = csvRegion(k);
    else if (what === "screen") out = csvScreen();
    else return;
    const head = what === "screen" ? csvMeta().filter((l) => /^# (tool|generated_utc|page|years|alpha)/.test(l)) : csvMeta();
    const text = head.concat(out.meta.map(([a, v]) => `# ${a}: ${metaVal(v)}`), out.rows.map((r) => r.map(csvCell).join(","))).join("\r\n") + "\r\n";
    const se = seasonOf(sc), base = what === "screen" ? "trend-detective_screen-mongolia" : `trend-detective_${sc.id}_${state.y0}-${state.y1}${se ? "_" + SEA.letters(se.m0, se.m1) : ""}_${out.name}`;
    await saveFile(`${base}.csv`, text);
  }
  // the claude.ai page saves through its downloads capability (the viewer confirms); elsewhere a link download.
  // Asked for at start-up so the answer is in by the first click; null (no runtime, or not granted) means a link.
  const dlWhen = window.claude && typeof window.claude.use === "function"
    ? Promise.race([Promise.resolve(window.claude.use("downloads")).catch(() => null), new Promise((r) => setTimeout(() => r(null), 10000))])
    : Promise.resolve(null);
  async function saveFile(filename, text) {
    const dlCap = await dlWhen;
    const data = "\ufeff" + text;               // byte-order mark so spreadsheet programs read UTF-8
    if (dlCap) {
      try { await dlCap.save({ filename, data }); return; } catch (e) { if (e && (e.code === "declined" || e.code === "rate_limited")) return; }
    }
    const url = URL.createObjectURL(new Blob([data], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: filename });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // ------------------------------------------------------------ analysis document
  function renderAnalysis() {
    if (state.tab !== "analysis" || !state.res) return;
    const sc = state.sc, el = $("#rmeans");
    el.innerHTML = sc.region_means.map((rm, k) => {
      const s = state.res.regionStats[k];
      if (!s) return `<div class="rm"><h3>${esc(regionName(rm))}</h3><p class="muted">${esc(t("tri_need"))}</p></div>`;
      const steps = state.res.custom ? "" : (s.steps || []).map((st) => `<dt>${esc(t("s_step", { d: st.label.slice(0, 7) }))}</dt><dd>${signed(st.step)} (p ${fmtP(st.p_step)})</dd>`).join("");
      return `<div class="rm"><h3 class="eyebtn">${esc(regionName(rm))} ${csvBtn("region", k)}</h3>
        <div><span class="big">${signed(s.sen)}</span> <span class="muted">${esc(unitLabel(rm.units))} ${esc(t("unit_decade"))} · ${esc(t(seasonOf(sc) ? "rm_mean_all" : "rm_mean"))} ${fmt(rm.raw_mean)} ${esc(unitLabel(rm.units))}</span></div>
        <div id="rmchart${k}"></div>
        <dl class="kv"><dt>${esc(t("rm_ci"))}</dt><dd>[${fmt(s.sen_lo)}, ${fmt(s.sen_hi)}]</dd>
        <dt>${esc(t("rm_p"))}</dt><dd>${fmtP(s.p_naive)} → ${fmtP(s.p_mk)} → ${fmtP(s.p_ols_ar1)}</dd>
        <dt>${esc(t("rm_misc"))}</dt><dd>${fmt(s.phi, 2)} · ±${fmt(s.mdt)} · ${s.nstar === null ? "∞" : fmt(s.nstar, 2)}</dd>
        <dt>${esc(t("s_detect_year"))}</dt><dd>${esc(detectShort(detectYear(s.nstar, s.sen, s.sen_lo, s.sen_hi, s.phi, s.n)))}</dd>${steps}</dl></div>`;
    }).join("") || `<p class="muted">${esc(t("no_rm"))}</p>`;
    sc.region_means.forEach((rm, k) => {
      const s = state.res.regionStats[k], host = $("#rmchart" + k);
      if (!s || !host) return;
      const tm = rm.monthly.map((_, q) => rm.monthly_start + q / 12), y = rm.monthly.map((v) => (v === null ? NaN : v));
      const ry = regionYears(rm), sub = subsetAnnual(ry.years, ry.vals, state.y0, state.y1, ry.off);
      const intercept = S.median(sub.vs.map((v, q) => v - s.sen / 10 * sub.ys[q]).filter(Number.isFinite));
      const chart = seasonOf(sc) ? { t: ry.years.map((v) => v + ry.off), y: ry.vals, annual: true } : { t: tm, y, ann: { years: ry.years, vals: ry.vals } };
      seriesChart(host, { ...chart, unit: unitLabel(rm.units), height: 140,
        trend: { sen: s.sen / 10, lo: s.sen_lo / 10, hi: s.sen_hi / 10, intercept }, markers: markers(sc), window: chartWindow(), label: regionName(rm) });
    });
    let tri = null;
    const cube = annualCube(state.entry), sel = state.sel;
    if (sel && sel.type === "cell" && state.res.cells.sen[sel.i] !== null) {
      const g = sc.grid;
      tri = { years: cube.years, vals: Array.from(cube.data.subarray(sel.i * cube.ny, (sel.i + 1) * cube.ny)),
        title: `${t("d_cell")} ${ll(g.lat[Math.floor(sel.i / g.nx)], g.lon[sel.i % g.nx])}`, unit: sc.units };
    } else if (sc.region_means[0]) {
      const rm = sc.region_means[0];
      const ry = regionYears(rm);
      tri = { years: ry.years, vals: ry.vals, title: regionName(rm), unit: rm.units };
    }
    if (tri) {
      $("#tri-title").textContent = tri.title;
      triangle($("#tri"), tri.years, tri.vals, `${unitLabel(tri.unit)} ${t("unit_decade")}`, WATER_VARS.has(sc.var));
    }
    const fn = CASES[sc.case];
    $("#case").innerHTML = fn ? fn(sc) : `<p class="muted">${esc(t("no_case"))}</p>`;
    renderCompare();
  }

  function renderCompare() {
    const el = $("#compare"), sc = state.sc;
    if (sc.reference) {
      el.hidden = false;
      const ref = sc.reference;
      $("#compare-eyebrow").textContent = `${t("cmp_eyebrow_ref")} · ${t("full_only")}`;
      $("#compare-title").textContent = t("cmp_nsidc", { name: ref.name });
      $("#compare-body").innerHTML = `<p class="prose">${esc(t("ref_intro"))}</p>` + ref.hemispheres.map((h, k) => {
        const d = h.difference, hn = mn() ? (h.key === "S" ? "Антарктид" : "Арктик") : h.name;
        return `<div class="rm"><h3>${esc(t("ref_head", { h: hn }))}</h3><div class="cmp">
          <div class="chip"><b>${signed(h.nsidc_area.sen)}</b><span>${esc(t("ref_nsidc", { p: fmtP(h.nsidc_area.p_mk), e: signed(h.nsidc_extent.sen) }))}</span></div>
          <div class="chip"><b>${signed(h.merra2_area.sen)}</b><span>${esc(t("ref_m2", { p: fmtP(h.merra2_area.p_mk) }))}</span></div>
          <div class="chip"><b>${signed(d.sen)}</b><span>${esc(t("ref_diff", { p: fmtP(d.p_mk) }))}</span></div>
          <div class="chip"><b>${fmt(h.anomaly_correlation, 2)}</b><span>${esc(t("cmp_corr"))}</span></div></div>
          <div id="refchart${k}"></div>
          <dl class="kv">${d.steps.map((st) => `<dt>${esc(t("ref_step", { d: st.label.slice(0, 7) }))}</dt><dd>${signed(st.step)} (p ${fmtP(st.p_step)}), ${esc(t("ref_after"))} ${signed(st.trend_with_step)}</dd>`).join("")}</dl></div>`;
      }).join("") + `<p class="small muted">${esc(t("ref_foot"))} <a href="${esc(ref.url)}" target="_blank" rel="noopener">${esc(ref.url)}</a></p>`;
      ref.hemispheres.forEach((h, k) => {
        const tt = h.difference_monthly.map((_, q) => h.monthly_start + q / 12), y = h.difference_monthly.map((v) => (v === null ? NaN : v)), d = h.difference;
        const intercept = S.median(y.map((v, q) => v - d.sen / 10 * tt[q]).filter(Number.isFinite));
        seriesChart($("#refchart" + k), { t: tt, y, ann: { years: h.annual_years, vals: h.difference_annual.map((v) => (v === null ? NaN : v)) }, unit: "million km²", height: 140,
          trend: { sen: d.sen / 10, lo: d.sen_lo / 10, hi: d.sen_hi / 10, intercept }, markers: d.steps.map((st) => ({ t: st.t_break, short: st.label.slice(0, 7) })), label: h.name });
      });
      return;
    }
    const c = (state.index.comparisons || []).find((x) => x.a === sc.id || x.b === sc.id);
    if (!c) { el.hidden = true; return; }
    el.hidden = false;
    $("#compare-eyebrow").textContent = `${t("cmp_eyebrow_model")} · ${t("full_only")}`;
    $("#compare-title").textContent = t("cmp_m2_imerg");
    const a = c.region_trend_a, b = c.region_trend_b;
    $("#compare-body").innerHTML = `<p class="prose">${esc(t("cmp_imerg_intro"))}</p><div class="cmp">
      <div class="chip"><b>${signed(a.sen)}</b><span>${esc(t("cmp_a", { p: fmtP(a.p_mk) }))}</span></div>
      <div class="chip"><b>${signed(b.sen)}</b><span>${esc(t("cmp_b", { p: fmtP(b.p_mk) }))}</span></div>
      <div class="chip"><b>${fmt(c.region_anomaly_correlation, 2)}</b><span>${esc(t("cmp_corr"))}</span></div>
      <div class="chip"><b>${Math.round(100 * c.sign_agreement_all)}%</b><span>${esc(t("cmp_sign"))}</span></div>
      <div class="chip"><b>${c.cells_significant_either}</b><span>${esc(t("cmp_either"))}</span></div>
      <div class="chip"><b>${c.both_significant_same_sign} / ${c.both_significant_opposite}</b><span>${esc(t("cmp_both"))}</span></div></div>
      <div class="seg">${[c.a, c.b].map((id) => `<button type="button" data-go="${id}" aria-pressed="${id === sc.id}">${esc(sceneTitle(state.index.scenes.find((s) => s.id === id) || { id, title: id }))}</button>`).join("")}</div>`;
  }

  // ------------------------------------------------------------ case notes (numbers are for the full record)
  const rmStat = (sc, key) => { const r = sc.region_means.find((x) => x.key === key); return r && r.stats; };
  const stepOf = (s, date) => (s.steps || []).find((x) => x.label.startsWith(date));
  // ------------------------------------------------------------ mines: where dust-prone winds blow
  // Precomputed from the mine's MERRA-2 cell (data/mines.js): for every month choice and season year,
  // the dust-prone days and the direction the daily mean 10 m wind blew toward on each of them.
  const COMPASS16 = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const compass = (deg) => COMPASS16[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
  function mineWindow(m) {
    const pre = m.seasons[state.season] || m.seasons.all;
    const keep = pre.years.map((y, q) => [y, q]).filter(([y]) => y >= state.y0 && y <= state.y1);
    const sectors = new Array(m.n_sectors).fill(0);
    for (const [, q] of keep) pre.sectors_per_year[q].forEach((v, i) => { sectors[i] += v; });
    return { years: keep.map(([y]) => y), dust: keep.map(([, q]) => pre.dust_days_per_year[q]), sectors,
      places: m.settlements.map((p, i) => Object.assign({}, p, { per_year: keep.map(([, q]) => pre.places[i].per_year[q]) })) };
  }
  // Sen slope per decade and corrected p of a yearly count, or null when too short
  function yearTrend(years, vals) {
    const r = years.length >= 10 ? S.analyze(vals, years.map((y) => y + 0.5)) : null;
    return r && Number.isFinite(r.sen) ? { sen: r.sen * 10, p: r.pMk } : null;
  }
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  function roseSvg(sectors, size) {
    const n = sectors.length, max = Math.max(1, ...sectors), c = size / 2, R = c - 14, w = Math.PI / n;
    let s = `<svg class="rose" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${esc(t("rose_aria"))}">`;
    for (const r of [0.5, 1]) s += `<circle cx="${c}" cy="${c}" r="${R * r}" fill="none" stroke="var(--line)"/>`;
    sectors.forEach((v, i) => {
      if (!v) return;
      const r = R * Math.sqrt(v / max), a = (i * 2 * Math.PI) / n - Math.PI / 2;
      const p = (ang) => `${(c + r * Math.cos(ang)).toFixed(1)},${(c + r * Math.sin(ang)).toFixed(1)}`;
      s += `<path d="M${c},${c} L${p(a - w)} A${r.toFixed(1)},${r.toFixed(1)} 0 0 1 ${p(a + w)} Z" fill="var(--ink)" fill-opacity=".7" stroke="var(--bg)"/>`;
    });
    [["N", c, 10], ["E", size - 6, c + 4], ["S", c, size - 2], ["W", 6, c + 4]].forEach(([l, x, y]) => { s += `<text x="${x}" y="${y}" text-anchor="middle">${l}</text>`; });
    return s + "</svg>";
  }
  function mineCards() {
    const M = state.mines;
    if (!M) return `<p class="muted">${esc(t("mines_none"))}</p>`;
    return M.mines.map((m) => {
      const w = mineWindow(m), tot = w.dust.reduce((a, b) => a + b, 0), tr = yearTrend(w.years, w.dust);
      const top = w.sectors.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).slice(0, 3).filter(([v]) => v > 0)
        .map(([v, i]) => `${COMPASS16[i]} ${Math.round(100 * v / Math.max(tot, 1))}%`).join(", ");
      const rows = w.places.map((p) => {
        const days = p.per_year.reduce((a, b) => a + b, 0), pt = yearTrend(w.years, p.per_year);
        return `<tr><td>${esc(mn() ? p.mn : p.name)}</td><td class="n">${fmt(p.km, 3)} km ${compass(p.bearing)}</td><td class="n">${fmt(mean(p.per_year), 2)}</td>
          <td class="n">${Math.round(100 * days / Math.max(tot, 1))}%</td><td class="n">${pt ? `${signed(pt.sen, 2)} <span class="muted">p ${fmtP(pt.p)}</span>` : "–"}</td></tr>`;
      }).join("");
      return `<div class="minecard"><h3>${esc(mn() ? m.mine.mn : m.mine.name)}</h3>
        <div class="minerow">${roseSvg(w.sectors, 132)}<p class="small">${esc(t("mine_sum", { d: fmt(mean(w.dust), 3), y0: w.years[0], y1: w.years[w.years.length - 1], top: top || "–" }))}
          ${tr ? `<br>${esc(t("mine_trend", { s: signed(tr.sen, 2), p: fmtP(tr.p) }))}` : ""}</p></div>
        <div class="tablewrap"><table class="minetable"><thead><tr><th>${esc(t("mt_place"))}</th><th class="n">${esc(t("mt_where"))}</th><th class="n">${esc(t("mt_days"))}</th><th class="n">${esc(t("mt_share"))}</th><th class="n">${esc(t("mt_trend"))}</th></tr></thead><tbody>${rows}</tbody></table></div>
        <p class="small muted">${esc(t("mine_src", { src: m.mine.source, lat: fmt(m.cell.lat, 3), lon: fmt(m.cell.lon, 4) }))}</p></div>`;
    }).join("");
  }
  // rose glyphs on the map: wedges point where the wind carried dust on dust-prone days (area = share)
  function drawMines() {
    const M = state.mines, ctx = map.ctx;
    if (!M || state.sc.case !== "hazard") return;
    for (const m of M.mines) {
      const { lat, lon } = m.mine;
      if (!inMap(lat, lon)) continue;
      const x = X(lon), y = Y(lat), w = mineWindow(m), max = Math.max(1, ...w.sectors), n = w.sectors.length, R = 30;
      ctx.save();
      ctx.fillStyle = pal.ink; ctx.strokeStyle = rgb(pal.bg); ctx.lineWidth = 1;
      ctx.globalAlpha = 0.6;
      w.sectors.forEach((v, i) => {
        if (!v) return;
        const r = R * Math.sqrt(v / max), a = (i * 2 * Math.PI) / n - Math.PI / 2;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, r, a - Math.PI / n, a + Math.PI / n); ctx.closePath(); ctx.fill(); ctx.stroke();
      });
      ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.rect(x - 3.5, y - 3.5, 7, 7); ctx.fill(); ctx.lineWidth = 1.5; ctx.stroke();
      ctx.restore();
    }
  }

  const CASES = {
    hazard: (sc) => `<div class="prose"><p>${esc(t("hz_case"))}</p><p>${esc(t("hz_s5p"))}</p></div><h3>${esc(t("mines_title"))}</h3><p class="small muted">${esc(t("mines_note"))}</p>${mineCards()}`,
    truth: () => mn()
      ? `<div class="prose"><p>Энэ талбар хиймэл. Хойд хэсэгт нэг бүсэд дулаарах, өмнөд хэсэгт нэг бүсэд хөрөх чиг суулгасан; бусад нь сар хоорондын санах ойтой (φ = 0.5), орон зайд гөлгөр шуугиан бөгөөд бодит уур амьсгалын талбартай төстэй.</p><p><b>Чиг, энгийн p&lt;α</b> ба <b>Чиг, FDR тест</b> давхаргыг сольж хараарай: энгийн газрын зураг хоосон далай дээр ач холбогдлыг тараана. <b>Суулгасан үнэн</b> давхарга жинхэнэ чигийг харуулна. Арга зүй хуудас хоёр газрын зургийг үнэлдэг.</p></div>`
      : `<div class="prose"><p>This field is synthetic. One northern region was given a warming trend and one southern region a cooling trend; everything else is noise with month-to-month memory (φ = 0.5) and spatial smoothing, like real climate fields.</p><p>Switch between <b>Trend, naive p&lt;α</b> and <b>Trend, FDR-tested</b>: the naive map scatters significance across empty ocean. <b>Planted truth</b> shows what is really there. The Method tab scores both maps.</p></div>`,
    "sea-ice": (sc) => {
      const ar = rmStat(sc, "arctic_area"), an = rmStat(sc, "antarctic_area");
      const ref = sc.reference && sc.reference.hemispheres.find((h) => h.key === "S"), st = ref && stepOf(ref.difference, "2005-01");
      if (mn()) {
        return `<div class="prose"><p>MERRA-2-оор Арктикийн далайн мөсний талбай арван жилд ${signed(ar.sen)} сая км² (засварласан p ${fmtP(ar.p_mk)}), Антарктидынх ${signed(an.sen)} (засварласан p ${fmtP(an.p_mk)}, энгийн p ${fmtP(an.p_naive)}) өөрчлөгдсөн.</p>
        ${ref ? `<p><b>Антарктидын өсөлт хөндлөн шалгалтыг давахгүй.</b> NSIDC Sea Ice Index ${signed(ref.nsidc_area.sen)} (p ${fmtP(ref.nsidc_area.p_mk)}) гэж үзүүлж байна: илрэх чиг алга. MERRA-2 хасах NSIDC зөрүү арван жилд ${signed(ref.difference.sen)} (p ${fmtP(ref.difference.p_mk)}).${st ? ` Зөрүү 2005 оны 1-р сард ${signed(st.step)} сая км²-ээр үсэрсэн (p ${fmtP(st.p_step)}); яг тэр үед MERRA-2-ын ашигладаг Reynolds OISST доторх мөсний эх сурвалж NASA GSFC-ээс NCEP рүү солигдсон. Энэ нэг алхамыг тооцоход илүүдэл чиг ${signed(st.trend_with_step)} болж буурна.` : ""} NSIDC-д давуу эрх: Антарктидад 1981–2025 онд ач холбогдолтой чиг алга, MERRA-2-ын өсөлт бол өгөгдлийн артефакт.</p>` : ""}
        <p>Арктикийн бууралт хоёр бүртгэлд хоёуланд нь бодит. 2005 оны үсрэлтийг хэрэгсэл эхлээд өгөгдлөөс олж, дараа нь баримттай тулгасан.</p></div>`;
      }
      return `<div class="prose"><p>In MERRA-2, Arctic sea-ice area changes by ${signed(ar.sen)} million km² per decade (corrected p ${fmtP(ar.p_mk)}) and Antarctic area by ${signed(an.sen)} (corrected p ${fmtP(an.p_mk)}, naive p ${fmtP(an.p_naive)}).</p>
      ${ref ? `<p><b>The Antarctic gain does not survive the cross-check.</b> NSIDC's Sea Ice Index gives ${signed(ref.nsidc_area.sen)} (p ${fmtP(ref.nsidc_area.p_mk)}): no detectable trend. MERRA-2 minus NSIDC trends by ${signed(ref.difference.sen)} per decade (p ${fmtP(ref.difference.p_mk)}).${st ? ` The difference jumps by ${signed(st.step)} million km² in January 2005 (p ${fmtP(st.p_step)}), when the sea-ice input inside Reynolds OISST, which MERRA-2 uses, switched from NASA GSFC to NCEP. With that one step allowed for, the excess trend drops to ${signed(st.trend_with_step)} per decade.` : ""} NSIDC governs: the Antarctic shows no significant 1981–2025 trend, and the MERRA-2 gain is a data artifact.</p>` : ""}
      <p>The Arctic decline is real in both records. The tool found the January 2005 jump in the data first and then matched it to the documentation.</p></div>`;
    },
    ozone: (sc) => {
      const g = rmStat(sc, "globe"), fl = sc.steps[0] ? sc.steps[0].flagged : 0;
      return mn()
        ? `<div class="prose"><p><b>Автоматаар илэрсэн өгөгдлийн занга.</b> NASA POWER 200 DU-ээс бага нийт озоныг хүчингүй гэж тэмдэглэдэг. Антарктидын озоны цоорхой яг тэнд оршдог тул ${nf(sc.counts.gappy)} нүд хамгийн бага саруудаа алдсан. Хэрэгсэл цензурдсан чиг тооцохын оронд эдгээр нүдийг хасдаг; Антарктидын орчмын саарал хэсэг нь тэд.</p><p>Үлдсэн нүднүүдийн дэлхийн дундаж автокорреляцын сайн жишээ: энгийн p ${fmtP(g.p_naive)}, засварласан p ${fmtP(g.p_mk)}.</p><p>MERRA-2-ын озоны оролт 2004 оны 10-р сард SBUV-ээс Aura OMI + MLS рүү шилжсэн. ${fl ? `Тэр огноонд ${nf(fl)} нүдэнд ач холбогдолтой үсрэлт илэрсэн.` : "Нийт озонд тэр огноонд ач холбогдолтой үсрэлт илрээгүй."}</p></div>`
        : `<div class="prose"><p><b>A data trap, found automatically.</b> NASA POWER marks total ozone below 200 DU as invalid. The Antarctic ozone hole lies exactly there, so ${nf(sc.counts.gappy)} cells lose their lowest months. The tool excludes those cells instead of computing a censored trend; they are the grey area around Antarctica.</p><p>For the cells that remain, the global mean is a lesson in autocorrelation: naive p ${fmtP(g.p_naive)}, corrected p ${fmtP(g.p_mk)}.</p><p>The ozone input to MERRA-2 switched from SBUV to Aura OMI + MLS in October 2004. ${fl ? `The step test finds a significant jump at that date in ${nf(fl)} cells.` : "The step test finds no significant jump in total column ozone at that date."}</p></div>`;
    },
    "wet-dry": (sc) => {
      const g = rmStat(sc, "globe");
      return mn()
        ? `<div class="prose"><p><b>Нэг дулаарал, хоёр тэмдэг.</b> Дулаан агаар илүү ус агуулдаг ч хуурай газар дээр "чийглэг газар илүү чийглэг, хуурай газар илүү хуурай болно" гэсэн энгийн дүрэм биелдэггүй: Greve нар (2014, Nature Geoscience) хуурай газрын ердөө 10.8% нь энэ дүрмийг дагаж, 9.5% нь эсрэгээрээ байгааг олсон. Газрын зураг ач холбогдолтой өсөлт ба бууралтын бүсүүдийг зэрэгцүүлж харуулна.</p><p>Дэлхийн дундаж: арван жилд ${signed(g.sen)} ${esc(unitLabel(sc.units))} (энгийн p ${fmtP(g.p_naive)}, засварласан p ${fmtP(g.p_mk)}).</p><p>MERRA-2-ын хур тунадсыг хуурай газар дээр бага, дунд өргөрөгт борооны хэмжүүрээр засварладаг, 62.5°-аас хойш зөвхөн загварынх; далай дээр загварын өөрийнх. Хөрсний чийг нь энэ хур тунадсаар хөдлөгдөх загварын бүтээгдэхүүн бөгөөд урсгалын шилжилтийг (1992, 2001, 2011) алхамаар шалгадаг.</p></div>`
        : `<div class="prose"><p><b>One warming, two signs.</b> A warmer atmosphere holds more water, but over land the result is not simply "wet gets wetter, dry gets drier": Greve et al. (2014, Nature Geoscience) found only about 10.8% of land follows that pattern and 9.5% does the opposite. The map shows regions of significant increase and decrease side by side.</p><p>Global mean: ${signed(g.sen)} ${esc(unitLabel(sc.units))} per decade (naive p ${fmtP(g.p_naive)}, corrected p ${fmtP(g.p_mk)}).</p><p>MERRA-2 precipitation is gauge-corrected over land at low and middle latitudes and model-only poleward of 62.5°; over the oceans it is the model's own. Soil wetness is a model product forced by that precipitation, and its stream changes (1992, 2001, 2011) are tested as steps.</p></div>`;
    },
    "arctic-amplification": (sc) => {
      const nh = rmStat(sc, "nh"), sh = rmStat(sc, "sh"), g = rmStat(sc, "globe"), st = stepOf(g, "2006-04");
      const fl = (sc.steps.find((x) => x.label.startsWith("2006-04")) || { flagged: 0 }).flagged;
      return mn()
        ? `<div class="prose"><p>Хойд хагас бөмбөрцөг: арван жилд ${signed(nh.sen)} °C; Өмнөд хагас бөмбөрцөг: ${signed(sh.sen)} °C. Хамгийн хүчтэй дулаарал Арктикт байна; Rantanen нар (2022) Арктик 1979 оноос хойш дэлхийн дунджаас бараг дөрөв дахин хурдан дулаарсныг тогтоосон. Антарктидын орчимд ач холбогдолтой хөргөлтийн бүс тод харагдана.</p><p>Далай дээр MERRA-2-ын агаарын температур тогтоосон далайн гадаргын температурыг дагадаг бөгөөд эх сурвалж нь 1982, 2005, 2006 онд солигдсон.${st ? ` 2006 оны 4-р сарын шилжилтэд ${nf(fl)} нүдэнд ач холбогдолтой алхам гарсан; тэнд алхамыг тооцвол дэлхийн чиг ${signed(g.sen)}-ээс ${signed(st.trend_with_step)} °C болно (алхам ${signed(st.step)} °C, p ${fmtP(st.p_step)}). Алхамын тест жинхэнэ өөрчлөлт ба артефактыг ялгаж чадахгүй тул үүнийг хараат бус бүртгэлтэй шалгах дохио гэж үзнэ үү.` : ""}</p></div>`
        : `<div class="prose"><p>Northern Hemisphere: ${signed(nh.sen)} °C per decade; Southern Hemisphere: ${signed(sh.sen)} °C per decade. The strongest warming sits in the high Arctic, which Rantanen et al. (2022) found has warmed nearly four times faster than the globe since 1979. Around Antarctica a region of significant cooling stands out.</p><p>Over the oceans MERRA-2 air temperature follows its prescribed sea-surface temperature, whose sources changed in 1982, 2005 and 2006.${st ? ` ${nf(fl)} cells show a significant step at the April 2006 switch, and allowing for a step there moves the global trend from ${signed(g.sen)} to ${signed(st.trend_with_step)} °C per decade (step ${signed(st.step)} °C, p ${fmtP(st.p_step)}). A step test cannot tell an artificial jump from natural variability that shifts near that date, so treat this as a flag to check against an independent record.` : ""}</p></div>`;
    },
    mongolia: (sc) => {
      const m = sc.region_means[0].stats;
      const flagged = sc.steps.filter((s) => s.flagged).map((s) => `${s.label.slice(0, 4)} (${s.flagged})`);
      return mn()
        ? `<div class="prose"><p>Улсын дундаж: арван жилд ${signed(m.sen)} ${esc(unitLabel(sc.units))} (95% завсар ${fmt(m.sen_lo)}–${fmt(m.sen_hi)}; засварласан p ${fmtP(m.p_mk)}, бүх хугацаа). Газрын зураг аймгийн төвүүд, Оюу толгой болон Таван толгойн нисэх буудлыг тэмдэглэнэ.</p>${flagged.length ? `<p><b>Нэгэн төрлийн байдлын дохио.</b> MERRA-2-ын үйлдвэрлэлийн урсгалын хил ${flagged.join(", ")} дээр ач холбогдолтой алхам гарсан; Reichle нар (2017) тэнд хуурай газрын эхлэлийн (spin-up) нөлөөг баримтжуулсан. Монголд энэ хувьсагчийн чигийг хараат бус бүтээгдэхүүнгүйгээр иш татахгүй байх нь зөв.</p>` : ""}<p>MERRA-2 бол ~50 км-ийн реанализ. Уурхай, зам зэрэг орон нутгийн эх үүсвэрийг харахгүй; тэдгээрийн оршиж буй бүс нутгийн уур амьсгалыг харуулна. Хувьсагчийн эрэмбэ хуудас Монгол дээрх MERRA-2 ба CERES-ийн бүх хувьсагчийг эрэмбэлнэ.</p></div>`
        : `<div class="prose"><p>Country mean: ${signed(m.sen)} ${esc(unitLabel(sc.units))} per decade (95% CI ${fmt(m.sen_lo)} to ${fmt(m.sen_hi)}; corrected p ${fmtP(m.p_mk)}, full record). The map marks aimag centres, Oyu Tolgoi and the Tavan Tolgoi airfield.</p>${flagged.length ? `<p><b>Homogeneity flag.</b> Significant steps appear at the MERRA-2 production-stream boundaries ${flagged.join(", ")}, where Reichle et al. (2017) document land spin-up effects. Trends in this variable over Mongolia should not be cited without an independent product.</p>` : ""}<p>MERRA-2 is a ~50 km reanalysis. It cannot see local sources such as a mine or a road; it shows the regional climate in which they sit. The Variable ranking tab ranks every MERRA-2 and CERES variable over Mongolia.</p></div>`;
    },
    dust: (sc) => {
      const m = sc.region_means[0].stats;
      return mn()
        ? `<div class="prose"><p>CERES SYN1deg-ийн 550 нм-ийн аэрозолийн оптик зузаан (1° тор, 2001–2025). Улсын дундаж: арван жилд ${signed(m.sen)} (95% завсар ${fmt(m.sen_lo)}–${fmt(m.sen_hi)}, засварласан p ${fmtP(m.p_mk)}), дундаж ${fmt(sc.region_means[0].raw_mean)}. Тоос бол олон аэрозолийн нэг; AOD дангаараа тоосыг утаа, бохирдлоос ялгахгүй.</p><p>Бусад Монголын өгөгдөлтэй харьцуулаарай: салхины хурд ба хөрсний чийг. 1° нүд ойролцоогоор 80 × 110 км тул энэ нь Говийн бүс нутгийн суурь түвшин, нэг уурхайн ул мөр биш.</p></div>`
        : `<div class="prose"><p>Aerosol optical depth at 550 nm from CERES SYN1deg (1° grid, 2001–2025). Country mean: ${signed(m.sen)} per decade (95% CI ${fmt(m.sen_lo)} to ${fmt(m.sen_hi)}, corrected p ${fmtP(m.p_mk)}), against a mean of ${fmt(sc.region_means[0].raw_mean)}. Dust is one aerosol among several; AOD alone cannot separate dust from smoke or pollution.</p><p>Compare the drivers in the other Mongolia datasets: wind speed and soil wetness. A 1° cell spans roughly 80 × 110 km, so this is the regional background around the Gobi, not the footprint of one mine.</p></div>`;
    },
    crosscheck: () => {
      const c = (state.index.comparisons || [])[0], ratio = c ? c.region_trend_a.sen / c.region_trend_b.sen : NaN;
      return mn()
        ? `<div class="prose"><p>Загварын (MERRA-2, 42.5°N-ээс хойш аажмаар загварт шилждэг) болон хиймэл дагуулын (GPM IMERG) хур тунадас, ижил тор дээр, 2001–2025.</p>${c ? `<p>Чиглэлээрээ таарч байна: аль нэгэнд ач холбогдолтой нүднүүдийн ${Math.round(100 * c.sign_agreement_significant)}% нь ижил тэмдэгтэй, хоёуланд ач холбогдолтой боловч эсрэг тэмдэгтэй нүд алга, сарын аномалийн корреляц ${fmt(c.region_anomaly_correlation, 2)}. Хэмжээгээрээ зөрж байна: MERRA-2-ын улсын дундаж чиг IMERG-ийнхээс ${fmt(ratio, 2)} дахин их. "Чийглэг болж байна" гэдэг батлагдсан; "хэр их" гэдэг нь бүтээгдэхүүнээс хамаарна.</p>` : ""}</div>`
        : `<div class="prose"><p>Precipitation from a model (MERRA-2, gauge-corrected with a taper above 42.5°N) and from satellites (GPM IMERG), on the same grid, 2001–2025.</p>${c ? `<p>They agree on direction: ${Math.round(100 * c.sign_agreement_significant)}% of cells significant in either share a sign, no cell is significant in both with opposite signs, and monthly anomalies correlate at ${fmt(c.region_anomaly_correlation, 2)}. They disagree on size: MERRA-2's country-mean trend is ${fmt(ratio, 2)} times IMERG's. "Wetter" is supported; "how much wetter" depends on the product.</p>` : ""}</div>`;
    },
  };

  // ------------------------------------------------------------ variable ranking document
  function screenRows() {
    const sc = state.screen;
    if (isFull()) return sc.rows;
    const rows = sc.rows.map((r) => {
      const y0 = Math.max(state.y0, +r.start), sub = subsetAnnual(r.annual_years, r.annual, y0, state.y1);
      const res = sub.vs.length >= 10 ? statsFromJS(S.analyze(sub.vs, sub.ys)) : null;
      const yrs = state.y1 - y0 + 1;
      return Object.assign({}, r, { stats: res, start: String(y0),
        change_sd: res && res.sigma ? res.sen / 10 * yrs / res.sigma : null,
        change_pct: res && r.change_pct !== null && r.clim_mean > 0 ? 100 * res.sen / 10 * yrs / r.clim_mean : null });
    });
    const p = rows.map((r) => (r.stats ? r.stats.p_mk : NaN)), pstar = bhThreshold(p, state.alpha);
    rows.forEach((r, k) => { r.fdr = Number.isFinite(p[k]) && pstar > 0 && p[k] <= pstar; });
    rows.sort((a, b) => (a.fdr === b.fdr ? Math.abs(b.change_sd || 0) - Math.abs(a.change_sd || 0) : (a.fdr ? -1 : 1)));
    return rows;
  }
  function renderScreen() {
    if (state.tab !== "screen" || !state.screen || !state.res) return;
    const f = state.screenFilter, all = screenRows();
    const rows = all.filter((r) => f === "all" || (f === "fdr" && r.fdr) || r.kind === f);
    const sceneFor = (r) => (state.index.scenes.find((s) => s.region === "mongolia" && s.var === r.var && s.product === r.product &&
      s.period.start.slice(0, 4) === (r.kind === "mission" ? "2001" : "1981")) || {}).id;
    $("#screen-meta").innerHTML = `${esc(t("sc_meta", { n: all.length, y0: state.y0, y1: state.y1 }))}${state.season !== "all" ? " " + esc(t("sc_season", { s: seasonText(SEA.byId(state.season)) })) : ""} ${csvBtn("screen")}`;
    $("#screen-head").innerHTML = `<tr>${["h_var", "h_src", "h_years", "h_trend", "h_ci", "h_sd", "h_pct", "h_pn", "h_pc", "h_fdr", "h_ann"].map((k, i) => `<th class="${i >= 2 && i <= 8 ? "n" : ""}">${esc(t(k))}</th>`).join("")}</tr>`;
    $("#screen-body").innerHTML = rows.map((r) => {
      const s = r.stats, id = sceneFor(r);
      return `<tr class="${id ? "link" : ""}" ${id ? `data-go="${id}"` : ""}><td>${esc(r.long_name)} <span class="muted num">${esc(r.var)}</span></td>
        <td>${esc(t(r.kind === "model" ? "src_model" : "src_mission"))}</td><td class="n">${r.start}–${state.y1}</td>
        ${s ? `<td class="n">${signed(s.sen)} <span class="muted">${esc(unitLabel(r.units))}</span></td><td class="n">[${fmt(s.sen_lo, 2)}, ${fmt(s.sen_hi, 2)}]</td>
        <td class="n">${fmt(r.change_sd, 2)}</td><td class="n">${r.change_pct === null || r.change_pct === undefined ? "–" : signed(r.change_pct, 2) + "%"}</td>
        <td class="n">${fmtP(s.p_naive)}</td><td class="n">${fmtP(s.p_mk)}</td>` : `<td class="n" colspan="6">${esc(t("too_short"))}</td>`}
        <td>${r.fdr ? `<span class="yes">✓ ${esc(t("yes"))}</span>` : `<span class="muted">${esc(t("no"))}</span>`}</td><td>${spark(r.annual)}</td></tr>`;
    }).join("");
  }
  function spark(vals) {
    const v = vals.map((x) => (x === null ? NaN : x)), f = v.filter(Number.isFinite);
    if (!f.length) return "";
    const lo = Math.min(...f), hi = Math.max(...f), W = 90, H = 22;
    const d = v.map((x, k) => (Number.isFinite(x) ? `${k ? "L" : "M"}${(k / (v.length - 1) * W).toFixed(1)},${(H - 2 - (x - lo) / ((hi - lo) || 1) * (H - 4)).toFixed(1)}` : "")).join("");
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${d}" fill="none" stroke="var(--s1)" stroke-width="1.5"/></svg>`;
  }

  // ------------------------------------------------------------ method document
  function renderMethod() {
    if (state.tab !== "method") return;
    const v = state.validation, syn = state.cache["synthetic-truth"], tr = syn && syn.sc.truth;
    const keys = v ? Object.keys(v.tests) : [];
    const TEST_MN = { p_naive: "Mann-Kendall, засваргүй", p_hr_empirical: "Hamed-Rao, анхны хувилбар", p_mk: "Mann-Kendall, AR(1) загварчилсан Hamed-Rao (ашигласан)", p_ols_ar1: "OLS + AR(1) үр ашигтай n (Santer 2000)" };
    const table = v ? `<div class="tablewrap"><table><thead><tr><th>${mn() ? "Шуугианы санах ой φ" : "Noise memory φ"}</th>${keys.map((k) => `<th class="n">${esc(mn() ? TEST_MN[k] : v.tests[k])}</th>`).join("")}<th class="n">${mn() ? "Sen завсрын хамралт" : "Sen CI coverage"}</th></tr></thead><tbody>
      ${v.rows.map((r) => `<tr><td class="num">${r.phi}</td>${keys.map((k) => `<td class="n">${(100 * r.size[k]).toFixed(1)}% <span class="muted">/ ${(100 * r.power_at_mdt[k]).toFixed(0)}%</span></td>`).join("")}<td class="n">${(100 * r.sen_ci_coverage).toFixed(0)}%</td></tr>`).join("")}</tbody></table></div>
      <p class="small muted">${mn() ? `Нүд бүрт: чиг байхгүй үеийн хуурамч эерэг хувь (зорилт 5%) / чиг нь Weatherhead-ийн хамгийн бага илрэх хэмжээтэй тэнцүү үеийн илрүүлэлтийн хувь (зорилт 90%). Мөр бүрт 45 жилийн сарын ${v.reps} симуляц; Монте-Карлогийн стандарт алдаа 5% орчимд ±${(100 * v.mc_standard_error_at_5pct).toFixed(1)} пункт.` : `Each cell: false-positive rate with no trend (target 5%) / detection rate when the trend equals the Weatherhead minimum detectable trend (target 90%). ${v.reps} simulated 45-year monthly records per row; Monte Carlo standard error ±${(100 * v.mc_standard_error_at_5pct).toFixed(1)} points at 5%.`}</p>` : "";
    // one value per year (annual means or one season): the AR(1) correction rests on 20-45 points
    const oy = v && v.one_per_year;
    const oneYear = oy ? `<h3>${mn() ? "Жилд нэг утгатай үед (жилийн дундаж эсвэл нэг улирал)" : "One value per year (annual means or one season)"}</h3>
      <div class="tablewrap"><table><thead><tr>${(mn() ? ["Он", "Онуудын хоорондох φ", "Засваргүй MK", "Засварласан MK (ашигласан)", "OLS + AR(1)", "Хоёулаа, нэг чиглэлд"]
        : ["Years", "Year-to-year φ", "Uncorrected MK", "Corrected MK (used)", "OLS + AR(1)", "Both, same sign"]).map((h, k) => `<th${k > 1 ? ' class="n"' : ""}>${h}</th>`).join("")}</tr></thead><tbody>
      ${oy.rows.map((r) => `<tr><td class="num">${r.n}</td><td class="num">${r.phi}</td>${["p_naive", "p_mk", "p_ols_ar1"].map((k) => `<td class="n">${(100 * r.size[k]).toFixed(1)}%</td>`).join("")}<td class="n">${(100 * r.agree).toFixed(1)}%</td></tr>`).join("")}</tbody></table></div>
      <p class="small muted">${mn() ? `Чиг байхгүй үеийн хуурамч эерэг хувь (зорилт 5%), мөр бүрт ${oy.reps} симуляц, стандарт алдаа ±${(100 * oy.mc_standard_error_at_5pct).toFixed(1)} пункт. Цөөн цэгээс φ-г үнэлдэг тул дараалсан онууд төстэй үед тест α-аас арай олныг тэмдэглэнэ; хоёр тест санал нийлэхийг шаардах нь үүнийг багасгадаг. Монголын улирлын дунджийн φ-ийн медиан хувьсагч, улирлаас хамаарч ойролцоогоор −0.1-ээс 0.3.`
        : `False-positive rate with no trend (target 5%), ${oy.reps} simulations per row, standard error ±${(100 * oy.mc_standard_error_at_5pct).toFixed(1)} points. With φ estimated from few points the test flags somewhat more than α when consecutive years are alike; requiring both tests to agree reduces it. Over Mongolia the median φ of season means is about −0.1 to 0.3, depending on variable and season.`}</p>` : "";
    const truth = tr ? (mn()
      ? `<p>Үнэн нь мэдэгдэх талбар дээр энгийн газрын зурагт тэмдэглэгдсэн нүднүүдийн <b>${Math.round(100 * tr.scores.naive.fdp)}%</b> нь худал илрэлт; FDR-ийн дараа <b>${Math.round(100 * tr.scores.fdr.fdp)}%</b> (зорилт ≤ ${Math.round(100 * syn.sc.alpha_fdr)}%). Үнэ нь чадал: жинхэнэ чигтэй нүднүүдийн ${Math.round(100 * tr.scores.fdr.power)}%-ийг FDR олдог бол энгийн газрын зураг ${Math.round(100 * tr.scores.naive.power)}%; алдсан ихэнх нь суулгасан чиг нь илрэх хэмжээнээс бага нүднүүд.</p>`
      : `<p>On the known-truth field, <b>${Math.round(100 * tr.scores.naive.fdp)}%</b> of cells flagged by the naive map are false discoveries; after FDR it is <b>${Math.round(100 * tr.scores.fdr.fdp)}%</b> (target ≤ ${Math.round(100 * syn.sc.alpha_fdr)}%). The price is power: ${Math.round(100 * tr.scores.fdr.power)}% of truly trending cells are found, versus ${Math.round(100 * tr.scores.naive.power)}% by the naive map; most misses are cells whose planted trend is below the detectable size.</p>`) : "";
    const dv = v && v.detection;
    const dtable = dv ? `<div class="tablewrap"><table><thead><tr>${(mn()
      ? ["Түүвэр", "φ", "Жинхэнэ n*", "Завсар хамарсан", "Зөвхөн Sen завсар", "e^±B, m = түүвэр", "e^±B, m = жил", "Медиан n̂*/n*"]
      : ["Sampling", "φ", "True n*", "Range covers", "Sen CI only", "e^±B, m = samples", "e^±B, m = years", "Median n̂*/n*"]).map((h, k) => `<th${k > 1 ? ' class="n"' : ""}>${h}</th>`).join("")}</tr></thead><tbody>
      ${dv.rows.map((r) => `<tr><td>${mn() ? (r.sampling === "monthly" ? "сарын" : "жилийн") : r.sampling}</td><td class="num">${r.phi}</td><td class="n">${r.n_true}</td><td class="n"><b>${(100 * r.cover_range).toFixed(1)}%</b></td>
        <td class="n">${(100 * r.cover_trend_ci_only).toFixed(1)}%</td><td class="n">${(100 * r.noise_part_b_samples).toFixed(1)}%</td><td class="n">${(100 * r.noise_part_b_years).toFixed(1)}%</td><td class="n">${r.median_ratio.toFixed(2)}</td></tr>`).join("")}</tbody></table></div>` : "";
    const emergeCard = mn() ? `<div class="card"><h3>Илрэх он</h3><div class="prose">
        <p>n* = [K σ<sub>N</sub> / |ω| · √((1+φ)/(1−φ))]<sup>2/3</sup> жил (сарын өгөгдөлд K = 3.3; Weatherhead нар 1998). Энэ нь ω хэмжээтэй чигийг 5%-ийн түвшинд 90% магадлалтай илрүүлэхэд шаардлагатай бүртгэлийн урт. Ижил томьёог Whiteman нар (2011), Henson нар (2016), Sutton нар (2019) хэрэглэсэн. Газрын зураг эхлэх он + n* − 1-ийг харуулна; чиг хэмжсэн хурдаараа үргэлжилнэ гэж үзнэ.</p>
        <p>Завсар: Sen-ий 95% завсрыг n* ∝ |ω|<sup>−2/3</sup>-ээр хувиргаж, σ<sub>N</sub> ба φ-ийн үнэлгээний тодорхойгүй байдлыг e<sup>±B</sup>-ээр нэмнэ, B = 4/(3√m) · √((1+φ)/(1−φ)), m = түүврийн тоо (Sutton нар 2019; анхны өгүүллийг бид нээж чадаагүй). Чигийн завсар тэгийг агуулбал дээд хязгаар нь "хэзээ ч үгүй байж магадгүй".</p>
        <p>Зарим судалгаа n*-ийг "time of emergence" гэдэг (Sutton нар 2019); бусад нь энэ нэрийг дохио/шуугианы босгоор тодорхойлдог (жишээ нь Hawkins ба Sutton 2012). Бид чиг илрүүлэх утгаар нь хэрэглэв.</p></div>
        ${dtable}<p class="small muted">Мөр бүрт ${dv ? dv.reps : ""} симуляц, 45 жил. m = жил гэж авбал завсар хэт өргөн (100%), m = түүвэр гэж авбал нийлмэл завсар 92–99% хамарна.</p></div>`
      : `<div class="card"><h3>Year detectable</h3><div class="prose">
        <p>n* = [K σ<sub>N</sub> / |ω| · √((1+φ)/(1−φ))]<sup>2/3</sup> years (K = 3.3 for monthly data; Weatherhead et al. 1998) is the record length at which a trend of size ω is detected with 90% probability at the 5% level. Whiteman et al. (2011), Henson et al. (2016) and Sutton et al. (2019) use the same formula. The map shows start year + n* − 1, assuming the trend continues at the measured rate.</p>
        <p>Range: the Sen 95% CI mapped through n* ∝ |ω|<sup>−2/3</sup>, widened by e<sup>±B</sup> for the estimated σ<sub>N</sub> and φ, B = 4/(3√m) · √((1+φ)/(1−φ)) with m the number of samples (Sutton et al. 2019; we could not access the original paper). If the trend CI includes zero, the upper end is "maybe never".</p>
        <p>Some papers call n* the time of emergence (Sutton et al. 2019); others define emergence by a signal-to-noise threshold (e.g. Hawkins and Sutton 2012). Here it means trend detection.</p></div>
        ${dtable}<p class="small muted">${dv ? dv.reps : ""} simulated 45-year records per row. Reading m as years makes the range far too wide (100%); with m = samples the combined range covers 92–99%.</p></div>`;
    const run = `<pre>pip install -r requirements.txt
python -m pytest -q
python -m trend_detective build        # NASA POWER + NSIDC -> web/data/
python -m trend_detective series merra2 T2M --bbox 104 43 107 45</pre>`;
    $("#method").innerHTML = mn() ? `
      <h2>Хэрэгсэл өөрчлөлтийг бодит гэж хэрхэн шийддэг вэ</h2>
      <div class="cards method">
        <div class="card"><h3>Нүд бүрт</h3><ol>
          <li>Улирлын мөчлөгийг (сарын дундаж) хасна.</li>
          <li>Хэмжээ: Theil-Sen налуу ба зэрэглэлд суурилсан итгэлийн завсар.</li>
          <li>Ач холбогдол: Hamed-Rao автокорреляцын засвартай Mann-Kendall; зэрэглэлийн ACF-ийг AR(1)-ээр загварчилсан.</li>
          <li>Хяналт: AR(1) үр ашигтай түүврийн хэмжээтэй OLS (Santer нар 2000). Санал зөрвөл нууцлахгүй, харуулна.</li>
          <li>Илрэх чадвар: Weatherhead нар (1998)-ын хамгийн бага илрэх чиг ба шаардлагатай жил, түүвэрлэлтийн давтамжид тохируулсан. Бүртгэл хэт богино бол "чиг алга" биш "одоогоор илрэхгүй" гэнэ.</li>
          <li>Нэгэн төрлийн байдал: баримтжуулсан эх сурвалжийн шилжилт бүрт алхамын тест.</li></ol></div>
        <div class="card"><h3>Газрын зураг даяар</h3><ul>
          <li>Бүх хүчинтэй нүдэнд Benjamini-Hochberg-ийн худал илрэлтийн хувь (FDR), орон зайн хамааралтай талбарт α<sub>FDR</sub> = 2 × α (Wilks 2016).</li>
          <li>Дутуу сартай нүдийг нөхөхгүй, хасна, шалтгааныг нь хэлнэ.</li>
          <li>Сонгосон онуудаар бүх тест, FDR, тоог таны хөтөч дээр дахин тооцно: сарын утга хадгалсан өгөгдөлд (Монгол) сарын утгаас, бусад (дэлхий) жилийн дунджаас.</li>
          <li>Сарын шүүлтүүр (Монгол, шууд шинжилгээ): сонгосон сарын дунджийг жил бүр нэг утга болгоод ижил тестүүдийг хийнэ. Шинэ жилийг дамнасан улирал сүүлийн сарынхаа онд тооцогдоно (12–2-р сар 1990 = 1989 оны 12-р сараас 1990 оны 2-р сар); сар нь дутуу онг хасна.</li>
          <li>Хараат бус бүртгэлтэй хөндлөн шалгалт: MERRA-2 ба IMERG хур тунадас; MERRA-2 ба NSIDC далайн мөс.</li>
          <li>Шууд шинжилгээ: MERRA-2-ын 472, CERES-ийн 848 хувьсагчийг AWS дээрх NASA POWER-ээс хөтөч шууд уншина. Задлагчийг numcodecs ба xarray-тай бит тус бүрээр тулгасан; Монгол дээр урьдчилан тооцсон Python-ы үр дүнг давтдаг (T2M +0.1942 °C/арван жил, p 0.00239). Шууд горимд алхамын тест хийхгүй.</li></ul></div>
      </div>
      <h3>Орон нутгийн тестийн Монте-Карло шалгалт</h3>${table}${oneYear}${truth}${emergeCard}
      <div class="card"><h3>Өөрийн шинжилгээг ажиллуулах</h3><p class="prose">Python 3.10+ суулгаад агуулахын хавтсанд суулгах скриптийг ажиллуулна (Windows: <code>install_analysis.bat</code>, macOS/Linux: <code>install_analysis.sh</code>), дараа нь:</p>${run}</div>
      <p class="small muted">Өгөгдөл: NASA POWER v10 (AWS Open Data, CC BY 4.0), NSIDC Sea Ice Index G02135 v4, GeoNames (CC BY 4.0), Natural Earth (world-atlas, ISC). Дэлгэрэнгүй: docs/METHODS.md.</p>`
      : `
      <h2>How the tool decides a change is real</h2>
      <div class="cards method">
        <div class="card"><h3>Per cell</h3><ol>
          <li>Remove the seasonal cycle (monthly climatology).</li>
          <li>Size: Theil-Sen slope with a rank confidence interval.</li>
          <li>Significance: Mann-Kendall with the Hamed-Rao autocorrelation correction, rank ACF modelled as AR(1).</li>
          <li>Cross-check: OLS with an AR(1) effective sample size (Santer et al. 2000). Disagreement is shown, not hidden.</li>
          <li>Detectability: Weatherhead et al. (1998) smallest detectable trend and years needed, scaled for the sampling interval. "No trend" becomes "not yet detectable" when the record is too short.</li>
          <li>Homogeneity: a step test at every documented data-source change.</li></ol></div>
        <div class="card"><h3>Across the map</h3><ul>
          <li>Benjamini-Hochberg false discovery rate over all valid cells, with α<sub>FDR</sub> = 2 × α for spatially correlated fields (Wilks 2016).</li>
          <li>Cells with missing months are excluded, never gap-filled, and the tool says why.</li>
          <li>For chosen years, every test, the FDR and every count are recomputed in your browser, from monthly values where the dataset stores them (Mongolia) and from annual means otherwise (globe).</li>
          <li>Months filter (Mongolia, live analyses): the chosen months are averaged into one value per year and the same tests run on those. A season over New Year counts in the year of its last month (Dec–Feb 1990 = December 1989 to February 1990); a year missing any of the months is left out.</li>
          <li>Cross-checks against independent records: MERRA-2 vs IMERG precipitation; MERRA-2 vs NSIDC sea ice.</li>
          <li>Live analysis: the browser reads any of 472 MERRA-2 or 848 CERES variables straight from NASA POWER on AWS. The decoder matches numcodecs and xarray bit for bit, and over Mongolia it reproduces the precomputed Python results (T2M +0.1942 °C/decade, p 0.00239). Step tests are not run live.</li></ul></div>
      </div>
      <h3>Monte Carlo check of the local tests</h3>${table}${oneYear}${truth}${emergeCard}
      <div class="card"><h3>Run your own analysis</h3><p class="prose">Install Python 3.10+, then run the install script in the repository folder (Windows: <code>install_analysis.bat</code>, macOS/Linux: <code>install_analysis.sh</code>), then:</p>${run}</div>
      <p class="small muted">Data: NASA POWER v10 (AWS Open Data, CC BY 4.0), NSIDC Sea Ice Index G02135 v4, GeoNames (CC BY 4.0), Natural Earth via world-atlas (ISC). Details: docs/METHODS.md.</p>`;
  }

  // ------------------------------------------------------------ chrome: menus, tree, toolbar, language
  function menus() {
    const v = state.view, th = state.theme, ck = (on) => (on ? "check" : "nocheck");
    const sc = state.sc;
    return [
      { id: "file", label: t("m_file"), items: [
        { label: t("file_repo"), href: REPO }, { label: t("file_zip"), href: REPO + "/archive/refs/heads/main.zip" },
        { label: t("file_live"), act: openLive }, "-",
        { label: t("file_csv_map"), act: () => exportCsv("cells") }, { label: t("file_csv_sel"), act: () => exportCsv("series") }, "-",
        { label: t("file_run"), act: () => setTab("method") }] },
      { id: "view", label: t("m_view"), items: [
        { label: t("view_map"), cls: ck(v === "map"), act: () => setView("map") }, { label: t("view_surf"), cls: ck(v === "surf"), act: () => setView("surf") },
        { label: t("view_cmp"), cls: ck(cmp.on), act: () => { if (state.view !== "map") setView("map"); setCompare(!cmp.on); } }, "-",
        { label: t("theme_system"), cls: ck(th === "system"), act: () => setTheme("system") }, { label: t("theme_light"), cls: ck(th === "light"), act: () => setTheme("light") },
        { label: t("theme_dark"), cls: ck(th === "dark"), act: () => setTheme("dark") }, "-",
        { label: "English", cls: ck(L() === "en"), act: () => setLang("en") }, { label: "Монгол", cls: ck(L() === "mn"), act: () => setLang("mn") }, "-",
        { label: t("view_left"), cls: ck(!$("#leftpane").hidden), act: () => { $("#leftpane").hidden = !$("#leftpane").hidden; layoutCols(); } },
        { label: t("view_right"), cls: ck(!$("#rightpane").hidden), act: () => { $("#rightpane").hidden = !$("#rightpane").hidden; layoutCols(); } }] },
      { id: "analysis", label: t("m_analysis"), items: [
        { label: t("an_full"), act: () => preset("full") }, { label: t("an_30"), act: () => preset(30) },
        { label: t("an_20"), act: () => preset(20) }, { label: t("an_2001"), act: () => preset(2001) }, "-",
        ...[0.1, 0.05, 0.01].map((a) => ({ label: t("an_alpha", { a }), cls: ck(Math.abs(state.alpha - a) < 1e-9), act: () => { $("#alpha").value = a.toFixed(2); setAlpha(a); } })), "-",
        ...(sc ? availLayers() : []).map((l) => ({ label: t(LAYER_KEY[l]), cls: ck(state.layer === l), act: () => setLayer(l) }))] },
      { id: "help", label: t("m_help"), items: [
        { label: t("help_guide"), act: showGuide }, { label: t("help_method"), act: () => setTab("method") }, { label: t("help_about"), act: showAbout }] },
    ];
  }
  let openMenu = null;
  function renderMenus() {
    const defs = menus();
    $("#menubar").innerHTML = defs.map((m) => `<div><button type="button" class="menubtn" data-menu="${m.id}" aria-haspopup="true" aria-expanded="${openMenu === m.id}">${esc(m.label)}</button>
      ${openMenu === m.id ? `<div class="menu" role="menu">${m.items.map((it, k) => (it === "-" ? "<hr>" : it.href
        ? `<a role="menuitem" href="${esc(it.href)}" target="_blank" rel="noopener"><span class="nocheck">${esc(it.label)}</span><span>↗</span></a>`
        : `<button type="button" role="menuitem" data-mi="${m.id}:${k}"><span class="${it.cls || "nocheck"}">${esc(it.label)}</span></button>`)).join("")}</div>` : ""}</div>`).join("");
    state.menuDefs = defs;
  }
  function layoutCols() {
    const lp = !$("#leftpane").hidden, rp = !$("#rightpane").hidden;
    $(".workspace").style.gridTemplateColumns = matchMedia("(max-width: 1100px)").matches ? "" : `${lp ? "236px " : ""}minmax(0, 1fr)${rp ? " 350px" : ""}`;
    requestAnimationFrame(drawMap);
  }
  function buildTree() {
    const groups = new Map();
    for (const s of state.index.scenes) { if (!groups.has(s.group)) groups.set(s.group, []); groups.get(s.group).push(s); }
    $("#tree-scenes").innerHTML = [...groups].map(([g, list]) => `<details open><summary>${esc(I.group(g))}</summary>${list.map((s) =>
      `<button type="button" class="item" data-go="${s.id}" aria-current="${state.sc && state.sc.id === s.id}">${esc(sceneTitle(s))}<span class="tag">${s.live ? "LIVE" : s.kind === "mission" ? "SAT" : s.kind === "model" ? "MOD" : "TEST"}</span></button>`).join("")}</details>`).join("");
  }
  function fillYears() {
    const [a, b] = fullRange();
    const opts = (sel) => Array.from({ length: b - a + 1 }, (_, k) => a + k).map((y) => `<option${y === sel ? " selected" : ""}>${y}</option>`).join("");
    $("#y0").innerHTML = opts(state.y0);
    $("#y1").innerHTML = opts(state.y1);
  }
  function fillSeason() {
    const sel = $("#season"), ok = state.sc && state.sc.series.kind === "monthly";
    sel.innerHTML = SEA.PRESETS.map((p, k) => `${k === 1 || k === 7 ? '<option disabled>──────</option>' : ""}<option value="${p.id}"${p.id === state.season ? " selected" : ""}>${esc(seasonText(p, true))}</option>`).join("");
    sel.disabled = !ok;
    sel.title = ok ? t("tb_season_title") : t("season_na");
  }
  function applyStatic() {
    document.documentElement.lang = mn() ? "mn" : "en";
    $$("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    $$("[data-i18n-ph]").forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
    $$("[data-i18n-title]").forEach((el) => { el.title = t(el.dataset.i18nTitle); el.setAttribute("aria-label", el.title); });
    $$("[data-lang]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.lang === L()));
    $("#placelist").innerHTML = state.places.map((p) => `<option value="${esc(placeName(p))}"></option>`).join("");
  }

  // ------------------------------------------------------------ actions
  function renderAll() {
    renderMenus(); buildTree(); fillYears(); fillSeason(); renderPicker(); renderCmpBar(); renderTimeline(); renderSummary(); drawMap(); renderInspector();
    renderAnalysis(); renderScreen(); renderMethod(); status();
    $$("[data-view]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.view === state.view));
    $$("[data-tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === state.tab));
  }
  async function showScene(id, keepYears) {
    stopPlay();
    const entry = await loadScene(id), prev = state.sc;
    if (entry.sc.case === "hazard" && state.mines === undefined) state.mines = await loadPayload("mines").catch(() => null);
    state.entry = entry; state.sc = entry.sc; state.sel = null; state.step = 0; state.year = null;
    if (!prev || prev.region !== entry.sc.region) resetView();
    const [a, b] = fullRange();
    if (!keepYears || !prev) { state.y0 = a; state.y1 = b; } else {
      state.y0 = Math.max(a, Math.min(state.y0, b - 9));
      state.y1 = Math.min(b, Math.max(state.y1, state.y0 + 9));
    }
    if (location.hash.slice(1) !== id) { try { history.replaceState(null, "", "#" + id); } catch (e) { /* file:// can refuse */ } }
    await computeResults();
    // a compare side from another region cannot stay
    if (cmp.on && !cmpChoices().some((c) => c.id === cmp.id)) { const d = cmpDefault(); await cmpLoad(d.id, d.y0, d.y1); }
    renderAll();
  }
  async function applyYears() {
    let y0 = +$("#y0").value, y1 = +$("#y1").value;
    if (y1 < y0) [y0, y1] = [y1, y0];
    if (y1 - y0 < 9) {
      y1 = Math.min(fullRange()[1], y0 + 9);
      y0 = Math.min(y0, y1 - 9);
    }
    state.y0 = y0; state.y1 = y1;
    await computeResults();
    renderAll();
  }
  function preset(p) {
    const [a, b] = fullRange();
    if (p === "full") { $("#y0").value = a; $("#y1").value = b; }
    else if (p === 2001) { $("#y0").value = Math.max(a, 2001); $("#y1").value = b; }
    else { $("#y0").value = Math.max(a, b - p + 1); $("#y1").value = b; }
    applyYears();
  }
  async function setSeason(id) {
    stopPlay();
    state.season = SEA.byId(id).id;
    state.year = null;
    await computeResults();
    if (cmp.on && cmp.entry) await cmpLoad(cmp.id, cmp.y0, cmp.y1);
    renderAll();
  }
  async function setAlpha(a) {
    state.alpha = a;
    await computeResults();
    if (cmp.on && cmp.entry) await cmpLoad(cmp.id, cmp.y0, cmp.y1);
    renderAll();
  }
  function setLayer(l) { state.layer = l; if (l !== "anom") stopPlay(); renderPicker(); renderMenus(); renderTimeline(); drawMap(); }
  // the risk-zone layer exists only for the daily hazard indices: go to one if needed
  async function openRisk() {
    if (!state.sc || !state.sc.clim12) await showScene("mn-dustdays", true);
    if (state.view !== "map") setView("map");
    setTab("map");
    setLayer("zone");
  }
  function setView(v) {
    state.view = v;
    $("#map").hidden = v !== "map"; $("#surf").hidden = v !== "surf"; $("#surfctl").hidden = v !== "surf"; $("#zoomctl").hidden = v !== "map";
    renderCmpBar();
    hideTip();
    $$("[data-view]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.view === v));
    renderMenus();
    setTab("map");
  }
  function setTab(tab) {
    state.tab = tab;
    ["map", "analysis", "screen", "method"].forEach((k) => { $("#doc-" + k).hidden = k !== tab; });
    $("#layerdd").hidden = tab !== "map";
    if (tab !== "map") setLayerMenu(false);
    $$("[data-tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === tab));
    if (tab === "map") requestAnimationFrame(drawMap);
    renderAnalysis(); renderScreen(); renderMethod();
  }
  function setTheme(th) {
    state.theme = th;
    store.set("theme", th);
    if (th === "system") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = th;
    buildPalette();
    renderAll();
  }
  function setLang(l) { I.setLang(l); store.set("lang", l); applyStatic(); renderAll(); }
  function modal(html) {
    $("#modalbox").innerHTML = html + `<div><button type="button" class="btn primary" id="modalclose">${esc(t("close"))}</button></div>`;
    $("#modal").hidden = false;
    $("#modalclose").focus();
  }
  function showGuide() { modal(`<h2>${esc(t("guide_title"))}</h2><ol>${t("guide").map((s) => `<li>${esc(s)}</li>`).join("")}</ol>`); }
  function showAbout() { modal(`<h2>${esc(t("about_title"))}</h2><p>${esc(t("about"))}</p><p class="small">${esc(GIBS_ACK)}</p><p><a href="${REPO}" target="_blank" rel="noopener">${REPO}</a></p>`); }
  // wording requested by NASA GIBS (GIBS API documentation, "Data Use Guidance and Acknowledgements")
  const GIBS_ACK = "We acknowledge the use of imagery provided by services from NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS).";
  function doSearch(q) {
    q = q.trim().toLowerCase();
    if (!q || !state.sc) return;
    const p = state.places.find((x) => x.en.toLowerCase() === q || x.mn.toLowerCase() === q) ||
      state.places.find((x) => x.en.toLowerCase().startsWith(q) || x.mn.toLowerCase().startsWith(q));
    if (!p) return;
    state.searched = p;
    const g = state.sc.grid, i = Math.floor((p.lon - (g.lon[0] - g.dlon / 2)) / g.dlon), j = Math.floor((p.lat - (g.lat[0] - g.dlat / 2)) / g.dlat);
    if (i >= 0 && j >= 0 && i < g.nx && j < g.ny && state.res.status[j * g.nx + i] !== 0) {
      state.sel = { type: "cell", i: j * g.nx + i };
      Object.assign(map.view, { z: Math.max(map.view.z, state.sc.region === "global" ? 4 : 2), lon: p.lon, lat: p.lat });
      setTab("map"); renderInspector(); renderAnalysis(); drawMap();
      status({ cursor: ll(p.lat, p.lon), value: placeName(p) });
    } else {
      drawMap();
      const note = $("#mapnote");
      note.textContent = t("outside", { place: placeName(p) });
      note.hidden = false;
      setTimeout(() => { note.hidden = true; }, 3500);
    }
  }

  // ------------------------------------------------------------ live analysis of any NASA POWER variable
  const live = { cat: null, product: "merra2", busy: false, n: 0 };
  // a box to start from: the box selection, else the visible part of a zoomed map, else Mongolia
  function liveDefaultBox() {
    if (state.sel && state.sel.type === "box") return state.sel.bounds.map((v) => +v.toFixed(2));
    if (state.sc && map.g && map.view.z > 1 && state.view === "map") {
      const g = map.g, cl = (v, a, b) => Math.max(a, Math.min(b, v));
      return [cl(LON(0), g.lon0, g.lon1), cl(LAT(map.H), g.lat0, g.lat1), cl(LON(map.W), g.lon0, g.lon1), cl(LAT(0), g.lat0, g.lat1)].map((v) => +v.toFixed(2));
    }
    return [87.5, 41, 120.5, 52.5];
  }
  async function openLive() {
    if (!live.cat) {
      try { live.cat = await loadPayload("power-catalog"); } catch (e) { modal(`<p>${esc(t("live_fail", { e: e.message }))}</p>`); return; }
    }
    const cat = live.cat, cur = state.sc && !state.sc.live && cat.products[state.sc.product] ? state.sc : null;
    if (cur) live.product = state.sc.product;
    const box = liveDefaultBox(), ph = (k) => esc(t(k));
    modal(`<h2>${ph("live_title")}</h2><p class="small muted">${ph("live_intro")}</p>
      <div class="liveform">
        <label>${ph("live_source")} <select id="lv-prod">${Object.entries(cat.products).map(([k, p]) => `<option value="${k}"${k === live.product ? " selected" : ""}>${esc(p.name)} · ${esc(p.res)}</option>`).join("")}</select></label>
        <label>${ph("live_var")} <input id="lv-var" list="lv-vars" autocomplete="off" spellcheck="false" placeholder="${ph("live_var_ph")}" value="${esc(cur && cat.products[live.product].vars.some((r) => r[0] === cur.var) ? cur.var : "T2M")}"></label>
        <datalist id="lv-vars"></datalist>
        <p class="small muted" id="lv-varinfo"></p>
        <fieldset><legend>${ph("live_region")}</legend>
          ${["live_w", "live_s", "live_e", "live_n"].map((k, i) => `<label>${ph(k)} <input type="number" step="0.5" id="lv-b${i}" value="${box[i]}"></label>`).join("")}
          <span class="lvbtns"><button type="button" class="btn" id="lv-view">${ph("live_use_view")}</button>
          <button type="button" class="btn" id="lv-sel"${state.sel && state.sel.type === "box" ? "" : " disabled"}>${ph("live_use_box")}</button></span>
        </fieldset>
        <label>${ph("live_years")} <select id="lv-y0"></select> – <select id="lv-y1"></select></label>
        <p class="num small" id="lv-est" aria-live="polite"></p>
        <div><button type="button" class="btn primary" id="lv-run">${ph("live_run")}</button></div>
        <p class="small" id="lv-status" aria-live="polite"></p>
      </div>`);
    liveFillProduct(true);
  }
  function liveFillProduct(first) {
    const cat = live.cat, prod = $("#lv-prod").value, p = cat.products[prod];
    live.product = prod;
    $("#lv-vars").innerHTML = p.vars.map((r) => `<option value="${esc(r[0])}">${esc(r[1])} (${esc(r[2])})</option>`).join("");
    const a = +p.t0.slice(0, 4), b = TDLive.lastFullYear(cat, prod);
    const y0 = first && state.sc ? Math.max(a, Math.min(state.y0, b - 9)) : a, y1 = first && state.sc ? Math.min(b, Math.max(state.y1, y0 + 9)) : b;
    const opts = (sel) => Array.from({ length: b - a + 1 }, (_, k) => a + k).map((y) => `<option${y === sel ? " selected" : ""}>${y}</option>`).join("");
    $("#lv-y0").innerHTML = opts(y0); $("#lv-y1").innerHTML = opts(y1);
    if (!TDLive.findVar(cat, prod, $("#lv-var").value)) $("#lv-var").value = prod === "merra2" ? "T2M" : "ALLSKY_SFC_SW_DWN";
    liveEstimate();
  }
  function livePlan() {
    return TDLive.plan(live.cat, live.product, $("#lv-var").value, [0, 1, 2, 3].map((i) => +$("#lv-b" + i).value), +$("#lv-y0").value, +$("#lv-y1").value);
  }
  function liveEstimate() {
    if (!$("#lv-est")) return null;
    const pl = livePlan();
    $("#lv-varinfo").textContent = pl.v ? `${pl.v.name}: ${pl.v.long_name} (${unitLabel(pl.v.units) || "–"})${pl.v.screenable ? "" : " · " + t("live_odd")}` : "";
    const err = pl.error && t("live_err_" + pl.error, { cells: nf(pl.cells || 0), max: nf(pl.error === "cells" ? TDLive.MAX_CELLS : TDLive.MAX_CHUNKS), chunks: (pl.chunks || []).length });
    $("#lv-est").textContent = pl.error === "var" || pl.error === "box" ? "" : t("live_est", { cells: nf(pl.cells), chunks: pl.chunks.length, mb: fmt(pl.mb, 2), s: Math.max(1, Math.round(pl.seconds)) });
    $("#lv-status").textContent = err || "";
    $("#lv-status").className = "small" + (err ? " lverr" : "");
    $("#lv-run").disabled = !!pl.error || live.busy;
    return pl;
  }
  async function liveRun() {
    const pl = liveEstimate();
    if (!pl || pl.error || live.busy) return;
    live.busy = true;
    $("#lv-run").disabled = true;
    const say = (msg) => { const el = $("#lv-status"); if (el) { el.textContent = msg; el.className = "small"; } };
    try {
      const entry = await TDLive.read(live.cat, pl, {
        id: `live-${++live.n}`, focusRings: state.geo && state.geo.focus.rings,
        onProgress: (e) => say(e.phase === "download" ? t("live_dl", { done: e.done, total: e.total, mb: fmt(e.mb, 2) }) : t("live_decode")),
      });
      const sc = entry.sc;
      state.cache[sc.id] = entry;
      state.index.scenes.push({ id: sc.id, title: `${sc.var} · ${sc.region_name}`, group: sc.group, kind: sc.kind, live: true });
      sc.title = `${sc.long_name} (${sc.var})`;
      live.busy = false;
      $("#modal").hidden = true;
      await showScene(sc.id);
      setTab("map");
    } catch (err) {
      live.busy = false;
      const code = err && err.code;
      say(code === "nodata" ? t("live_nodata") : code === "short" ? t("live_err_years") : t("live_fail", { e: err.message || err }));
      const st = $("#lv-status"); if (st) st.className = "small lverr";
      if ($("#lv-run")) $("#lv-run").disabled = false;
    }
  }

  // ------------------------------------------------------------ boot
  async function boot() {
    const saved = store.get("lang");
    I.setLang(saved || ((navigator.language || "").toLowerCase().startsWith("mn") ? "mn" : "en"));
    state.theme = store.get("theme") || "system";
    state.base = window.TDBasemap && TDBasemap.LAYERS[store.get("base")] ? store.get("base") : "none";
    state.baseGrey = store.get("basegrey") !== "0";
    state.baseAlpha = Math.min(1, Math.max(0.2, +store.get("basealpha") || 0.75));
    if (state.theme !== "system") document.documentElement.dataset.theme = state.theme;
    map.canvas = $("#map"); map.ctx = map.canvas.getContext("2d");
    surface = new window.TDSurface($("#surf"));
    buildPalette();
    applyStatic();
    renderMenus();
    try {
      const [index, geo] = await Promise.all([loadPayload("index"), loadPayload("geo")]);
      state.index = index; state.geo = geo;
      const [places, validation, screen] = await Promise.all([loadPayload("places").catch(() => null), loadPayload("validation").catch(() => null),
        index.has_screen ? loadPayload("screen-mongolia").catch(() => null) : null]);
      state.places = places ? places.places : []; state.validation = validation; state.screen = screen;
    } catch (err) {
      $("#summary").innerHTML = `<div class="warn critical"><span class="icon">!</span><p>${esc(t("load_fail", { e: err.message }))}</p></div>`;
      return;
    }
    applyStatic();
    await loadScene("synthetic-truth").catch(() => null);
    const first = location.hash.slice(1);
    if (first === "risk") await openRisk();   // #risk: a shareable link straight to the risk zones
    else await showScene(state.index.scenes.find((s) => s.id === first) ? first : "mn-t2m");
    if (!store.get("seenGuide")) { store.set("seenGuide", "1"); showGuide(); }

    document.addEventListener("click", (e) => {
      const mb = e.target.closest("[data-menu]");
      if (mb) { openMenu = openMenu === mb.dataset.menu ? null : mb.dataset.menu; renderMenus(); return; }
      const mi = e.target.closest("[data-mi]");
      if (mi) {
        const [mid, k] = mi.dataset.mi.split(":");
        const it = state.menuDefs.find((m) => m.id === mid).items[+k];
        openMenu = null; renderMenus();
        if (it && it.act) it.act();
        return;
      }
      if (openMenu && !e.target.closest(".menu")) { openMenu = null; renderMenus(); }
      if (e.target.closest("#layerbtn")) { setLayerMenu($("#picker").hidden, e.detail === 0); return; }
      if (!$("#picker").hidden && !e.target.closest("#picker")) setLayerMenu(false);
      const go = e.target.closest("[data-go]");
      if (go) { showScene(go.dataset.go, true).then(() => setTab("map")); return; }
      if (e.target.closest("[data-risk]")) { setLayerMenu(false); openRisk(); return; }
      const lay = e.target.closest("[data-layer]");
      if (lay) { setLayer(lay.dataset.layer); setLayerMenu(false); if (e.detail === 0) $("#layerbtn").focus(); return; }
      const stp = e.target.closest("[data-step]");
      if (stp) { state.step = +stp.dataset.step; drawMap(); return; }
      const tab = e.target.closest("[data-tab]");
      if (tab) { setTab(tab.dataset.tab); return; }
      const vw = e.target.closest("[data-view]");
      if (vw) { setView(vw.dataset.view); return; }
      const lg = e.target.closest("[data-lang]");
      if (lg) { setLang(lg.dataset.lang); return; }
      const fl = e.target.closest("[data-filter]");
      if (fl) { state.screenFilter = fl.dataset.filter; $$("[data-filter]").forEach((b) => b.setAttribute("aria-pressed", b === fl)); renderScreen(); return; }
      if (e.target.closest("#unitbtn")) {
        state.unit = { decade: "year", year: "total", total: "decade" }[state.unit];
        drawMap(); renderInspector(); return;
      }
      const csvb = e.target.closest("[data-csv]");
      if (csvb) { exportCsv(csvb.dataset.csv, +csvb.dataset.k || 0); return; }
      if (e.target.closest("[data-cmp]")) { if (state.view !== "map") setView("map"); setCompare(!cmp.on); return; }
      if (e.target.closest("[data-cmp-close]")) { setCompare(false); return; }
      if (e.target.id === "cmp-apply") { cmpApply(); return; }
      if (e.target.id === "lv-run") { liveRun(); return; }
      if (e.target.id === "lv-view" || e.target.id === "lv-sel") {
        const b = e.target.id === "lv-sel" && state.sel && state.sel.type === "box" ? state.sel.bounds.map((v) => +v.toFixed(2)) : liveDefaultBox();
        b.forEach((v, i) => { $("#lv-b" + i).value = v; });
        liveEstimate(); return;
      }
      if (e.target.closest("#livebtn")) { openLive(); return; }
      if (e.target.id === "modalclose" || e.target.id === "modal") $("#modal").hidden = true;
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        $("#modal").hidden = true;
        if (openMenu) { openMenu = null; renderMenus(); }
        if (!$("#picker").hidden) { setLayerMenu(false); $("#layerbtn").focus(); }
      }
      if (!$("#picker").hidden && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        const items = $$("#picker button"), n = items.length, k = items.indexOf(document.activeElement), down = e.key === "ArrowDown";
        items[k < 0 ? (down ? 0 : n - 1) : (k + (down ? 1 : -1) + n) % n].focus();
        e.preventDefault();
      }
    });
    $("#apply").addEventListener("click", applyYears);
    $("#modal").addEventListener("input", (e) => { if (e.target.id && e.target.id.startsWith("lv-")) liveEstimate(); });
    $("#modal").addEventListener("change", (e) => { if (e.target.id === "lv-prod") liveFillProduct(false); else if (e.target.id && e.target.id.startsWith("lv-")) liveEstimate(); });
    $("#alpha").addEventListener("change", (e) => setAlpha(+e.target.value));
    $("#season").addEventListener("change", (e) => setSeason(e.target.value));
    $("#search").addEventListener("change", (e) => doSearch(e.target.value));
    $("#search").addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(e.target.value); });
    $("#boxmode").addEventListener("click", (e) => {
      map.boxMode = !map.boxMode;
      e.currentTarget.setAttribute("aria-pressed", map.boxMode);
      e.currentTarget.classList.toggle("primary", map.boxMode);
      $("#mapwrap").classList.toggle("box-mode", map.boxMode);
    });
    ["coast", "borders", "places", "stipple"].forEach((k) => $("#ov-" + k).addEventListener("change", (e) => { state.ov[k] = e.target.checked; drawMap(); }));
    const syncBase = () => {
      $$("input[name=base]").forEach((r) => { r.checked = r.value === state.base; });
      $("#base-date").value = state.baseDate;
      $("#base-date").max = new Date().toISOString().slice(0, 10);
      $("#base-dayrow").hidden = state.base !== "day";
      $("#base-opts").hidden = state.base === "none";
      $("#base-grey").checked = state.baseGrey;
      $("#base-alpha").value = state.baseAlpha;
    };
    syncBase();
    $("#leftpane").addEventListener("change", (e) => {
      if (e.target.name === "base") { state.base = e.target.value; store.set("base", state.base); map.baseWarned = false; }
      else if (e.target.id === "base-date" && e.target.value) state.baseDate = e.target.value;
      else if (e.target.id === "base-grey") { state.baseGrey = e.target.checked; store.set("basegrey", state.baseGrey ? "1" : "0"); }
      else return;
      syncBase(); drawMap();
    });
    $("#base-alpha").addEventListener("input", (e) => { state.baseAlpha = +e.target.value; store.set("basealpha", e.target.value); schedulePaint(); });
    $("#play").addEventListener("click", togglePlay);
    $("#yearslider").addEventListener("input", (e) => {
      state.year = annualCube(state.entry).years[+e.target.value];
      if (state.layer !== "anom") { state.layer = "anom"; renderPicker(); }
      renderTimeline(); drawMap();
    });
    $("#surfmult").addEventListener("input", (e) => { surface.mult = +e.target.value; surface.schedule(); });
    $("#surfreset").addEventListener("click", () => { surface.reset(); surface.mult = 1; $("#surfmult").value = 1; surface.schedule(); });
    map.canvas.addEventListener("pointerdown", onDown);
    map.canvas.addEventListener("pointermove", onMove);
    map.canvas.addEventListener("pointerup", onUp);
    map.canvas.addEventListener("pointercancel", onCancel);
    map.canvas.addEventListener("pointerleave", () => { if (!map.drag && !map.pan) { hideTip(); status({ cursor: null }); } });
    map.canvas.addEventListener("wheel", (e) => {
      if (state.view !== "map" || !state.res) return;
      e.preventDefault();
      const p = pointer(e), dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      zoomAt(p.x, p.y, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.002)));
    }, { passive: false });
    map.canvas.addEventListener("dblclick", (e) => { if (state.view === "map" && state.res) { const p = pointer(e); zoomAt(p.x, p.y, e.shiftKey ? 0.5 : 2); } });
    map.canvas.addEventListener("keydown", (e) => {
      if (state.view !== "map" || !state.res) return;
      const k = e.key, step = 60;
      if (k === "+" || k === "=") zoomAt(map.W / 2, map.H / 2, 1.5);
      else if (k === "-" || k === "_") zoomAt(map.W / 2, map.H / 2, 1 / 1.5);
      else if (k === "0") { resetView(); paint(); status(); }
      else if (k === "ArrowLeft" || k === "ArrowRight") panBy(k === "ArrowLeft" ? step : -step, 0);
      else if (k === "ArrowUp" || k === "ArrowDown") panBy(0, k === "ArrowUp" ? step : -step);
      else return;
      e.preventDefault();
    });
    const handle = $("#cmphandle");
    let dragging = false;
    const moveDivider = (fx) => { cmp.x = Math.max(0.05, Math.min(0.95, fx)); schedulePaint(); };
    handle.addEventListener("pointerdown", (e) => { dragging = true; handle.setPointerCapture(e.pointerId); e.preventDefault(); });
    handle.addEventListener("pointermove", (e) => { if (dragging) moveDivider((e.clientX - map.canvas.getBoundingClientRect().left) / map.W); });
    const stopDrag = () => { if (dragging) { dragging = false; } };
    handle.addEventListener("pointerup", stopDrag);
    handle.addEventListener("pointercancel", stopDrag);
    handle.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") { moveDivider(cmp.x + (e.key === "ArrowLeft" ? -0.05 : 0.05)); e.preventDefault(); }
    });
    $("#zin").addEventListener("click", () => zoomAt(map.W / 2, map.H / 2, 2));
    $("#zout").addEventListener("click", () => zoomAt(map.W / 2, map.H / 2, 0.5));
    $("#zreset").addEventListener("click", () => { resetView(); paint(); status(); });
    window.addEventListener("hashchange", () => {
      const id = location.hash.slice(1);
      if (id === "risk") openRisk();
      else if (id && state.sc && id !== state.sc.id && state.index.scenes.find((s) => s.id === id)) showScene(id, true);
    });
    let rz;
    const onResize = () => { clearTimeout(rz); rz = setTimeout(() => { drawMap(); renderInspector(); renderAnalysis(); }, 120); };
    window.addEventListener("resize", onResize);
    if (window.ResizeObserver) new ResizeObserver(onResize).observe($("#mapwrap"));
    const retheme = () => { buildPalette(); drawMap(); renderInspector(); renderAnalysis(); };
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", retheme);
    new MutationObserver(retheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }
  boot();
})();
