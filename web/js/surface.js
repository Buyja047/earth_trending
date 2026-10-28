/* 3D surface of a gridded field on a 2D canvas: painter's algorithm with
 * simple Lambert shading. Drag to rotate, wheel or pinch to zoom. */
(function (root) {
  "use strict";

  function Surface(canvas, onChange) {
    this.c = canvas;
    this.ctx = canvas.getContext("2d");
    this.onChange = onChange || (() => {});
    this.reset();
    this.mult = 1;
    this.data = null;
    this.raf = 0;
    let drag = null;
    canvas.addEventListener("pointerdown", (e) => {
      drag = { x: e.clientX, y: e.clientY, yaw: this.yaw, elev: this.elev };
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = "grabbing";
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!drag) return;
      this.yaw = drag.yaw + (e.clientX - drag.x) * 0.008;
      this.elev = Math.min(1.5, Math.max(0.2, drag.elev + (e.clientY - drag.y) * 0.006));
      this.schedule();
    });
    const end = () => { drag = null; canvas.style.cursor = "grab"; };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.zoom = Math.min(4, Math.max(0.5, this.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      this.schedule();
    }, { passive: false });
  }

  Surface.prototype.reset = function () { this.yaw = -0.35; this.elev = 0.62; this.zoom = 1; this.schedule && this.schedule(); };
  Surface.prototype.setData = function (d) { this.data = d; this.schedule(); };
  Surface.prototype.schedule = function () {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.render(); });
  };

  Surface.prototype.render = function () {
    const c = this.c, ctx = this.ctx, d = this.data;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth, H = c.clientHeight;
    if (!W || !H) return;
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = d ? d.bg : "#fff";
    ctx.fillRect(0, 0, W, H);
    if (!d) return;
    const { nx, ny, lon0, lon1, lat0, lat1, aspect } = d;
    const ax = 1 / aspect;
    const zs = 0.32 * this.mult;
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const se = Math.sin(this.elev), ce = Math.cos(this.elev);
    const s = this.zoom * Math.min(W / (2.5 * ax), H / 2.6);
    const P = 7;
    const cxs = W / 2, cys = H * 0.54;
    const proj = (x, y, z) => {
      const x1 = x * cy - y * sy, y1 = x * sy + y * cy;
      const u = y1 * se + z * ce, dep = -y1 * ce + z * se;
      const f = P / (P - dep);
      return [cxs + s * f * x1, cys - s * f * u, dep];
    };
    const gx = (lon) => ((lon - lon0) / (lon1 - lon0) * 2 - 1) * ax;
    const gy = (lat) => (lat - lat0) / (lat1 - lat0) * 2 - 1;

    // base plane and coastlines at z = 0
    ctx.lineWidth = 1;
    ctx.strokeStyle = d.frame;
    ctx.beginPath();
    [[-ax, -1], [ax, -1], [ax, 1], [-ax, 1], [-ax, -1]].forEach(([x, y], k) => {
      const p = proj(x, y, 0);
      if (k) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]);
    });
    ctx.stroke();
    ctx.strokeStyle = d.coast;
    ctx.lineWidth = 0.8;
    for (const ring of d.lines || []) {
      ctx.beginPath();
      let prev = null;
      for (const [lo, la] of ring) {
        if (lo < lon0 || lo > lon1 || la < lat0 || la > lat1) { prev = null; continue; }
        const p = proj(gx(lo), gy(la), 0);
        if (prev === null || Math.abs(lo - prev) > 180) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
        prev = lo;
      }
      ctx.stroke();
    }

    // corner heights: mean of the finite neighbouring cells
    const h = d.h;
    const cw = nx + 1;
    const ch = new Float32Array((ny + 1) * cw).fill(NaN);
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        let sum = 0, n = 0;
        for (const [jj, ii] of [[j - 1, i - 1], [j - 1, i], [j, i - 1], [j, i]]) {
          if (jj < 0 || ii < 0 || jj >= ny || ii >= nx) continue;
          const v = h[jj * nx + ii];
          if (Number.isFinite(v)) { sum += v; n++; }
        }
        if (n) ch[j * cw + i] = sum / n;
      }
    }
    const quads = [];
    const dxw = 2 * ax / nx, dyw = 2 / ny;
    const L = [-0.45, 0.35, 0.82];
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (!Number.isFinite(h[k]) || !d.color[k]) continue;
        const z00 = ch[j * cw + i], z01 = ch[j * cw + i + 1], z10 = ch[(j + 1) * cw + i], z11 = ch[(j + 1) * cw + i + 1];
        const x0 = -ax + i * dxw, x1 = x0 + dxw, y0 = -1 + j * dyw, y1 = y0 + dyw;
        const a = proj(x0, y0, z00 * zs), b = proj(x1, y0, z01 * zs), cc = proj(x1, y1, z11 * zs), dd = proj(x0, y1, z10 * zs);
        // normal from the height gradient, for shading
        const gxz = ((z01 + z11) - (z00 + z10)) * zs / (2 * dxw), gyz = ((z10 + z11) - (z00 + z01)) * zs / (2 * dyw);
        const nrm = Math.hypot(gxz, gyz, 1);
        const lam = Math.max(0, (-gxz * L[0] - gyz * L[1] + L[2]) / nrm);
        quads.push({ p: [a, b, cc, dd], dep: (a[2] + b[2] + cc[2] + dd[2]) / 4, col: d.color[k], sh: 0.62 + 0.38 * lam });
      }
    }
    quads.sort((q1, q2) => q1.dep - q2.dep);
    ctx.lineWidth = 0.7;
    for (const q of quads) {
      const [r, g, b] = q.col;
      const fill = `rgb(${Math.round(r * q.sh)},${Math.round(g * q.sh)},${Math.round(b * q.sh)})`;
      ctx.fillStyle = fill;
      ctx.strokeStyle = fill;
      ctx.beginPath();
      ctx.moveTo(q.p[0][0], q.p[0][1]);
      for (let k = 1; k < 4; k++) ctx.lineTo(q.p[k][0], q.p[k][1]);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    this.onChange();
  };

  root.TDSurface = Surface;
})(typeof globalThis !== "undefined" ? globalThis : this);
