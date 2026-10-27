/* Seasons: the mean of chosen calendar months, one value per year, from a monthly series.
 * A season that runs over New Year (Dec-Feb, Nov-Mar) belongs to the year of its last month, as in
 * NOAA CPC's ONI file, where "DJF 1950" is December 1949 to February 1950. A season value
 * needs every one of its months; one missing month leaves that year empty rather than mixing in
 * a different part of the seasonal cycle. */
(function (root) {
  "use strict";
  // m0..m1 inclusive, wrapping over December; "all" keeps the whole year (no season)
  const PRESETS = [
    { id: "all" },
    { id: "djf", m0: 12, m1: 2 }, { id: "mam", m0: 3, m1: 5 }, { id: "jja", m0: 6, m1: 8 }, { id: "son", m0: 9, m1: 11 },
    { id: "ndjfm", m0: 11, m1: 3 }, { id: "mjjas", m0: 5, m1: 9 },
    ...Array.from({ length: 12 }, (_, k) => ({ id: "m" + (k + 1), m0: k + 1, m1: k + 1 })),
  ];
  const byId = (id) => PRESETS.find((p) => p.id === id) || PRESETS[0];

  function months(m0, m1) {
    const out = [];
    for (let m = m0; ; m = (m % 12) + 1) { out.push(m); if (m === m1) break; }
    return out;
  }
  // each month with its year relative to the season's year (-1 for the months before New Year)
  function parts(m0, m1) {
    return months(m0, m1).map((m) => ({ m, dy: m0 > m1 && m >= m0 ? -1 : 0 }));
  }
  /** Middle of the season as a fraction of its year (December of the year before counts negative). */
  function offset(m0, m1) {
    const p = parts(m0, m1);
    return p.reduce((s, q) => s + q.dy + (q.m - 0.5) / 12, 0) / p.length;
  }
  const letters = (m0, m1) => months(m0, m1).map((m) => "JFMAMJJASOND"[m - 1]).join("");

  /**
   * Which values of a monthly series of length n make each season. `start` is the decimal year of
   * the first value (any month, mid-month or month start). Returns the season years whose months
   * all lie inside the record, the indices of their months, and the season's mid-point offset.
   */
  function plan(n, start, m0, m1) {
    const y0 = Math.floor(start + 1e-9), k0 = y0 * 12 + Math.floor((start - y0) * 12 + 1e-6);
    const p = parts(m0, m1), years = [], idx = [];
    const first = Math.floor(k0 / 12) - 1, last = Math.floor((k0 + n - 1) / 12) + 1;
    for (let Y = first; Y <= last; Y++) {
      const ks = p.map((q) => (Y + q.dy) * 12 + (q.m - 1) - k0);
      if (ks.every((k) => k >= 0 && k < n)) { years.push(Y); idx.push(ks); }
    }
    return { years, idx, off: offset(m0, m1), m0, m1 };
  }
  /**
   * Season means of one series along a plan; NaN where any month is missing. With `scale`, `vals`
   * are stored 16-bit integers (-32768 = missing) summed exactly before scaling, so two seasons with
   * the same stored sum get the same mean to the last bit and Mann-Kendall's ties stay ties.
   */
  function apply(vals, pl, base = 0, scale = 0) {
    return pl.idx.map((ks) => {
      let s = 0;
      for (const k of ks) {
        const v = vals[base + k];
        if (v === null || !Number.isFinite(v) || (scale && v === -32768)) return NaN;
        s += v;
      }
      return scale ? (s / ks.length) * scale : s / ks.length;
    });
  }
  function series(vals, start, m0, m1) {
    const pl = plan(vals.length, start, m0, m1);
    return { years: pl.years, vals: apply(vals, pl), off: pl.off };
  }

  const api = { PRESETS, byId, months, parts, offset, letters, plan, apply, series };
  root.TDSeason = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
