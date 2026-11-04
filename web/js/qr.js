/* A small QR Code encoder (ISO/IEC 18004): byte mode, error-correction level L,
 * versions 1-5 (up to 106 bytes), which is enough for a case-file link. Written for
 * this project so the viewer stays dependency-free; verified against OpenCV's decoder
 * in tests/test_qr.py. */
(function (root) {
  "use strict";
  // data codewords / error-correction codewords per version at level L (one block each)
  const CAP = [null, [19, 7], [34, 10], [55, 15], [80, 20], [108, 26]];
  const ALIGN = [null, null, 18, 22, 26, 30];

  // ---- GF(256) with the QR primitive polynomial x^8 + x^4 + x^3 + x^2 + 1
  const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
  function generator(n) {
    let g = [1];
    for (let i = 0; i < n; i++) {
      const next = new Array(g.length + 1).fill(0);
      for (let j = 0; j < g.length; j++) { next[j] ^= g[j]; next[j + 1] ^= mul(g[j], EXP[i]); }
      g = next;
    }
    return g;
  }
  function ecCodewords(data, n) {
    const g = generator(n), rem = new Array(n).fill(0);
    for (const b of data) {
      const f = rem.shift() ^ b;
      rem.push(0);
      if (f) for (let j = 0; j < n; j++) rem[j] ^= mul(g[j + 1], f);
    }
    return rem;
  }

  function utf8(text) {
    const out = [];
    for (const ch of unescape(encodeURIComponent(text))) out.push(ch.charCodeAt(0));
    return out;
  }
  function codewords(bytes) {
    const v = CAP.findIndex((c, k) => k > 0 && c[0] - 2 >= bytes.length);
    if (v < 1) throw new Error("text too long for this encoder (106 bytes)");
    const [nd, ne] = CAP[v], bits = [];
    const push = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };
    push(4, 4); push(bytes.length, 8);
    for (const b of bytes) push(b, 8);
    push(0, Math.min(4, nd * 8 - bits.length));
    while (bits.length % 8) bits.push(0);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(""), 2));
    for (let k = 0; data.length < nd; k++) data.push(k % 2 ? 0x11 : 0xec);
    return { version: v, words: data.concat(ecCodewords(data, ne)) };
  }

  // ---- the symbol
  function make(text, forceMask) {
    const { version, words } = codewords(utf8(text)), size = 17 + 4 * version;
    const mod = Array.from({ length: size }, () => new Uint8Array(size)), fn = Array.from({ length: size }, () => new Uint8Array(size));
    const set = (x, y, dark) => { if (x >= 0 && y >= 0 && x < size && y < size) { mod[y][x] = dark ? 1 : 0; fn[y][x] = 1; } };
    const finder = (cx, cy) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)); set(cx + dx, cy + dy, d !== 2 && d !== 4); } };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    for (let i = 8; i < size - 8; i++) { set(i, 6, i % 2 === 0); set(6, i, i % 2 === 0); }
    if (ALIGN[version]) { const c = ALIGN[version]; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(c + dx, c + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1); }
    // reserve the format areas (filled after masking) and the dark module; (6,8) and (8,6) belong to the timing patterns
    for (let i = 0; i < 9; i++) if (i !== 6) { set(8, i, 0); set(i, 8, 0); }
    for (let i = 0; i < 8; i++) { set(size - 1 - i, 8, 0); set(8, size - 1 - i, 0); }
    set(8, size - 8, 1);
    // data bits, right to left in column pairs, zigzag
    const bits = [];
    for (const w of words) for (let i = 7; i >= 0; i--) bits.push((w >> i) & 1);
    let k = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let v = 0; v < size; v++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - v : v;
          if (!fn[y][x] && k < bits.length) { mod[y][x] = bits[k++]; }
        }
      }
    }
    const MASKS = [(y, x) => (x + y) % 2 === 0, (y) => y % 2 === 0, (y, x) => x % 3 === 0, (y, x) => (x + y) % 3 === 0,
      (y, x) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0, (y, x) => (x * y) % 2 + (x * y) % 3 === 0,
      (y, x) => ((x * y) % 2 + (x * y) % 3) % 2 === 0, (y, x) => ((x + y) % 2 + (x * y) % 3) % 2 === 0];
    const applyMask = (m) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[m](y, x)) mod[y][x] ^= 1; };
    const format = (m) => {
      const data = (1 << 3) | m;          // level L = 01
      let rem = data;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
      const f = ((data << 10) | rem) ^ 0x5412, bit = (i) => (f >> i) & 1;
      for (let i = 0; i <= 5; i++) set(8, i, bit(i));
      set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
      for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
      set(8, size - 8, 1);
    };
    const penalty = () => {
      let p = 0;
      const runs = (line) => { let r = 1, s = 0; for (let i = 1; i <= line.length; i++) { if (i < line.length && line[i] === line[i - 1]) r++; else { if (r >= 5) s += r - 2; r = 1; } } return s; };
      for (let y = 0; y < size; y++) p += runs(mod[y]);
      for (let x = 0; x < size; x++) p += runs(mod.map((row) => row[x]));
      for (let y = 0; y + 1 < size; y++) for (let x = 0; x + 1 < size; x++) { const s = mod[y][x] + mod[y][x + 1] + mod[y + 1][x] + mod[y + 1][x + 1]; if (s === 0 || s === 4) p += 3; }
      const pat = (line) => { let s = 0, str = Array.from(line).join(""); for (const q of ["10111010000", "00001011101"]) { let i = -1; while ((i = str.indexOf(q, i + 1)) >= 0) s += 40; } return s; };
      for (let y = 0; y < size; y++) p += pat(mod[y]);
      for (let x = 0; x < size; x++) p += pat(mod.map((row) => row[x]));
      let dark = 0; for (const row of mod) for (const v of row) dark += v;
      p += 10 * Math.max(0, Math.ceil(Math.abs(dark * 20 - size * size * 10) / (size * size)) - 1);
      return p;
    };
    let best = 0, bestP = Infinity;
    for (let m = 0; m < 8; m++) { applyMask(m); format(m); const p = penalty(); if (p < bestP) { bestP = p; best = m; } applyMask(m); }
    if (forceMask !== undefined) best = forceMask;
    applyMask(best); format(best);
    return { size, version, mask: best, get: (x, y) => mod[y][x] === 1, rows: mod };
  }
  function svg(text, cell = 4, margin = 4) {
    const q = make(text), n = q.size + 2 * margin, parts = [];
    for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (q.get(x, y)) parts.push(`M${(x + margin) * cell} ${(y + margin) * cell}h${cell}v${cell}h-${cell}z`);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n * cell} ${n * cell}" width="${n * cell}" height="${n * cell}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="100%" height="100%" fill="#fff"/><path d="${parts.join("")}" fill="#000"/></svg>`;
  }
  const api = { make, svg, utf8 };
  root.TDQR = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
