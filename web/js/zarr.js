/* Reading NASA POWER Zarr v2 chunks in the browser: the Blosc container (zstd
 * only), byte and bit unshuffle, and the fixedscaleoffset filter. The block and
 * split rules follow c-blosc 1.x (blosc_d, serial_blosc, bitunshuffle). */
(function (root) {
  "use strict";
  const zstd = () => root.fzstd || (typeof require === "function" ? require("./vendor/fzstd.js") : null);
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  const LITTLE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

  // inverse of the byte shuffle: byte j of element i was stored at j * n + i
  function unshuffle(src, ts, dest, off, bsize) {
    const n = Math.floor(bsize / ts);
    for (let j = 0; j < ts; j++) {
      const s0 = j * n;
      for (let i = 0; i < n; i++) dest[off + i * ts + j] = src[s0 + i];
    }
    for (let k = n * ts; k < bsize; k++) dest[off + k] = src[k];
  }

  // inverse of the bit shuffle: bit k of byte j of element i was stored in bit row j * 8 + k,
  // rows of n bits packed least significant bit first; only whole groups of 8 elements are shuffled
  function bitunshuffle(src, ts, dest, off, bsize) {
    const n = Math.floor(bsize / ts);
    if (n % 8) { dest.set(src.subarray(0, bsize), off); return; }
    const rowBytes = n / 8;
    dest.fill(0, off, off + n * ts);
    for (let r = 0; r < 8 * ts; r++) {
      const j = r >> 3, bit = 1 << (r & 7), base = r * rowBytes;
      for (let b = 0; b < rowBytes; b++) {
        const v = src[base + b];
        if (!v) continue;
        for (let q = 0; q < 8; q++) if (v & (1 << q)) dest[off + (b * 8 + q) * ts + j] |= bit;
      }
    }
    for (let k = n * ts; k < bsize; k++) dest[off + k] = src[k];
  }

  /** Decode one Blosc (format version 2) buffer into its uncompressed bytes. */
  function bloscDecode(buf) {
    if (buf.length < 16) throw new Error("Blosc: buffer too short");
    const version = buf[0], flags = buf[2], ts = buf[3];
    const nbytes = u32(buf, 4), blocksize = u32(buf, 8), cbytes = u32(buf, 12);
    if (version !== 2) throw new Error(`Blosc: format version ${version} not supported`);
    if (flags & 0x08) throw new Error("Blosc: flags from a newer format");
    if (cbytes > buf.length) throw new Error("Blosc: truncated buffer");
    const out = new Uint8Array(nbytes);
    if (!nbytes) return out;
    if (flags & 0x02) {                                   // stored without compression
      out.set(buf.subarray(16, 16 + nbytes));
      return out;
    }
    if (flags >> 5 !== 4) throw new Error(`Blosc: codec ${flags >> 5} not supported (zstd only)`);
    const doShuffle = (flags & 0x01) && ts > 1, dontSplit = (flags & 0x10) >> 4;
    const nblocks = Math.ceil(nbytes / blocksize), leftover = nbytes % blocksize;
    const tmp = new Uint8Array(blocksize);
    for (let j = 0; j < nblocks; j++) {
      const last = j === nblocks - 1 && leftover > 0, bsize = last ? leftover : blocksize;
      const doBit = (flags & 0x04) && bsize >= ts;
      const nsplits = !dontSplit && ts <= 16 && Math.floor(bsize / ts) >= 128 && !last ? ts : 1;
      const neb = bsize / nsplits;
      if (!Number.isInteger(neb)) throw new Error("Blosc: splits do not cover the block");
      const target = doShuffle || doBit ? tmp : out.subarray(j * blocksize, j * blocksize + bsize);
      let src = u32(buf, 16 + 4 * j);
      for (let s = 0; s < nsplits; s++) {
        const cb = u32(buf, src);
        src += 4;
        if (src + cb > cbytes) throw new Error("Blosc: split runs past the buffer");
        const part = target.subarray(s * neb, (s + 1) * neb);
        if (cb === neb) part.set(buf.subarray(src, src + cb));
        else zstd().decompress(buf.subarray(src, src + cb), part);
        src += cb;
      }
      if (doShuffle) unshuffle(tmp, ts, out, j * blocksize, bsize);
      else if (doBit) bitunshuffle(tmp, ts, out, j * blocksize, bsize);
    }
    return out;
  }

  /** Float32 values of one chunk after the fixedscaleoffset filter, rounded as numcodecs does
   *  (float32 arithmetic: enc / scale, then + offset). */
  function decodeChunk(buf, scale, offset, length) {
    const raw = bloscDecode(buf);
    if (raw.length !== length * 4) throw new Error(`chunk has ${raw.length} bytes, expected ${length * 4}`);
    const out = new Float32Array(length);
    if (LITTLE && raw.byteOffset % 4 === 0) {
      const enc = new Float32Array(raw.buffer, raw.byteOffset, length);
      for (let k = 0; k < length; k++) out[k] = Math.fround(Math.fround(enc[k] / scale) + offset);
    } else {
      const dv = new DataView(raw.buffer, raw.byteOffset, raw.length);
      for (let k = 0; k < length; k++) out[k] = Math.fround(Math.fround(dv.getFloat32(4 * k, true) / scale) + offset);
    }
    return out;
  }

  /** Bytes of one chunk, or null when the store has none (S3 answers 403/404 for absent keys). */
  async function fetchChunk(url, fetchImpl) {
    const r = await (fetchImpl || root.fetch)(url);
    if (r.status === 403 || r.status === 404) return null;
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  }

  const api = { bloscDecode, decodeChunk, fetchChunk, unshuffle, bitunshuffle };
  root.TDZarr = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
