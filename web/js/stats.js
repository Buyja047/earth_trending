/* Trend statistics in the browser, mirroring trend_detective/stats.py.
 * Used for user-drawn regions and the trend triangle. tests/test_js_stats.py
 * checks these functions against the Python engine.
 */
(function (root) {
  "use strict";

  const WEATHERHEAD_K = 3.3;

  function sign(v) { return v > 0 ? 1 : v < 0 ? -1 : 0; }

  function mkScore(x) {
    let s = 0;
    const n = x.length;
    for (let k = 0; k < n - 1; k++) {
      const xk = x[k];
      for (let j = k + 1; j < n; j++) s += sign(x[j] - xk);
    }
    return s;
  }

  function mkVariance(x) {
    const n = x.length;
    const v = Float64Array.from(x).sort();
    let tie = 0;
    for (let i = 0; i < n;) {
      let j = i + 1;
      while (j < n && v[j] === v[i]) j++;
      const t = j - i;
      if (t > 1) tie += t * (t - 1) * (2 * t + 5);
      i = j;
    }
    return (n * (n - 1) * (2 * n + 5) - tie) / 18;
  }

  function mkZ(s, v) {
    if (!(v > 0)) return NaN;
    if (s > 0) return (s - 1) / Math.sqrt(v);
    if (s < 0) return (s + 1) / Math.sqrt(v);
    return 0;
  }

  // erfc with fractional error < 1.2e-7 (Numerical Recipes erfcc)
  function erfc(x) {
    const z = Math.abs(x);
    const t = 1 / (1 + 0.5 * z);
    const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 +
      t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 +
      t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
    return x >= 0 ? r : 2 - r;
  }

  function pTwoSidedNormal(z) { return Number.isFinite(z) ? erfc(Math.abs(z) / Math.SQRT2) : NaN; }

  function lgamma(x) {
    const c = [76.18009172947146, -86.50532032941677, 24.01409824083091,
      -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    let y = x;
    const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
    let ser = 1.000000000190015;
    for (let j = 0; j < 6; j++) ser += c[j] / ++y;
    return -tmp + Math.log(2.5066282746310005 * ser / x);
  }

  function betacf(a, b, x) {
    const MAXIT = 300, EPS = 3e-14, FPMIN = 1e-300;
    const qab = a + b, qap = a + 1, qam = a - 1;
    let c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= MAXIT; m++) {
      const m2 = 2 * m;
      let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }

  function betai(a, b, x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
  }

  // two-sided Student t p-value with (possibly fractional) dof
  function pTwoSidedT(t, dof) {
    if (!Number.isFinite(t) || !(dof > 0)) return NaN;
    return betai(dof / 2, 0.5, dof / (dof + t * t));
  }

  function ranks(x) {
    const n = x.length;
    const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => x[a] - x[b]);
    const r = new Float64Array(n);
    for (let i = 0; i < n;) {
      let j = i + 1;
      while (j < n && x[idx[j]] === x[idx[i]]) j++;
      const avg = (i + j + 1) / 2; // 1-based average rank
      for (let k = i; k < j; k++) r[idx[k]] = avg;
      i = j;
    }
    return r;
  }

  function lag1(x) {
    const n = x.length;
    let m = 0;
    for (const v of x) m += v;
    m /= n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      const a = x[i] - m;
      den += a * a;
      if (i > 0) num += a * (x[i - 1] - m);
    }
    return den > 0 ? num / den : 0;
  }

  function ar1VarianceFactor(x, t, slope) {
    const n = x.length;
    const r1 = lag1(ranks(x.map((v, i) => v - slope * t[i])));
    const phi = Math.min(0.98, Math.max(0, (n * r1 + 1) / (n - 4)));
    let total = 0, pk = 1;
    for (let k = 1; k < n; k++) {
      pk *= phi;
      if (pk < 1e-15) break;
      total += (n - k) * (n - k - 1) * (n - k - 2) * pk;
    }
    return 1 + 2 * total / (n * (n - 1) * (n - 2));
  }

  function orderStat(sorted, pos) {
    const lo = Math.floor(pos), frac = pos - lo;
    return frac === 0 ? sorted[lo] : (1 - frac) * sorted[lo] + frac * sorted[lo + 1];
  }

  function senSlope(x, t, varS, alpha = 0.05) {
    const n = x.length;
    const npairs = n * (n - 1) / 2;
    const sl = new Float64Array(npairs);
    let p = 0;
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) sl[p++] = (x[j] - x[i]) / (t[j] - t[i]);
    }
    sl.sort();
    const med = 0.5 * (sl[(npairs - 1) >> 1] + sl[npairs >> 1]);
    let lo = NaN, hi = NaN;
    if (varS > 0) {
      const zc = 1.959963984540054; // alpha = 0.05
      const c = (alpha === 0.05 ? zc : zc) * Math.sqrt(varS);
      const loPos = Math.min(Math.max((npairs - c) / 2 - 1, 0), npairs - 1);
      const hiPos = Math.min(Math.max((npairs + c) / 2, 0), npairs - 1);
      lo = orderStat(sl, loPos);
      hi = orderStat(sl, hiPos);
    }
    return { sen: med, lo, hi };
  }

  function olsAr1(x, t) {
    const n = x.length;
    let tm = 0, xm = 0;
    for (let i = 0; i < n; i++) { tm += t[i]; xm += x[i]; }
    tm /= n; xm /= n;
    let sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) { const d = t[i] - tm; sxx += d * d; sxy += d * (x[i] - xm); }
    const b = sxy / sxx;
    const e = x.map((v, i) => (v - xm) - b * (t[i] - tm));
    let sse = 0, cross = 0;
    for (let i = 0; i < n; i++) { sse += e[i] * e[i]; if (i > 0) cross += e[i] * e[i - 1]; }
    const r1 = sse > 0 ? cross / sse : 0;
    const r1c = Math.min(0.99, Math.max(0, r1));
    const ne = n * (1 - r1c) / (1 + r1c);
    const se = Math.sqrt(sse / (ne - 2) / sxx);
    const p = ne > 3 ? pTwoSidedT(b / se, ne - 2) : NaN;
    return { ols: b, se, p, phi: r1, nEff: ne, sigma: Math.sqrt(sse / (n - 2)), intercept: xm - b * tm };
  }

  function minDetectableTrend(sigma, phi, years) {
    const f = Math.min(0.95, Math.max(-0.95, phi));
    return WEATHERHEAD_K * sigma * Math.sqrt((1 + f) / (1 - f)) / Math.pow(years, 1.5);
  }

  function yearsToDetect(sigma, phi, omega) {
    const f = Math.min(0.95, Math.max(-0.95, phi));
    return Math.pow(WEATHERHEAD_K * sigma / Math.abs(omega) * Math.sqrt((1 + f) / (1 - f)), 2 / 3);
  }

  /** Full battery on one series of anomalies; t in decimal years. Drops NaNs. */
  function analyze(xIn, tIn) {
    const x = [], t = [];
    for (let i = 0; i < xIn.length; i++) {
      if (Number.isFinite(xIn[i])) { x.push(xIn[i]); t.push(tIn[i]); }
    }
    const n = x.length;
    if (n < 8) return null;
    const S = mkScore(x);
    const varS = mkVariance(x);
    const pNaive = pTwoSidedNormal(mkZ(S, varS));
    const sen0 = senSlope(x, t).sen;
    const factor = ar1VarianceFactor(x, t, sen0);
    const varMk = varS * factor;
    const pMk = pTwoSidedNormal(mkZ(S, varMk));
    const sen = senSlope(x, t, varMk);
    const o = olsAr1(x, t);
    const years = t[n - 1] - t[0] + median(t.slice(1).map((v, i) => v - t[i]));
    return {
      n, S, varS, factor, pNaive, pMk, sen: sen.sen, senLo: sen.lo, senHi: sen.hi,
      ols: o.ols, pOls: o.p, phi: o.phi, nEff: o.nEff, sigma: o.sigma,
      mdt: minDetectableTrend(o.sigma, o.phi, years),
      nstar: yearsToDetect(o.sigma, o.phi, sen.sen), years,
      intercept: median(x.map((v, i) => v - sen.sen * t[i])),
    };
  }

  function median(a) {
    const s = Float64Array.from(a).sort();
    const n = s.length;
    return n % 2 ? s[(n - 1) / 2] : 0.5 * (s[n / 2 - 1] + s[n / 2]);
  }

  const api = { mkScore, mkVariance, mkZ, pTwoSidedNormal, pTwoSidedT, ranks, lag1,
    ar1VarianceFactor, senSlope, olsAr1, minDetectableTrend, yearsToDetect, analyze, median };
  root.TDStats = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
