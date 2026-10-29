/* Satellite imagery under the trend map, from NASA GIBS (WMTS, EPSG:4326 "best" endpoint).
 * Tile grid, from GIBS's own WMTSCapabilities: top-left corner (-180, 90), 512 x 512 pixel
 * tiles, one tile spans 288 / 2^level degrees, so level 0 is 2 x 1 tiles and the tiles at the
 * east and south edges extend past the globe (that padding is black and is clipped here). */
(function (root) {
  "use strict";
  const BASE = "https://gibs.earthdata.nasa.gov/wmts/epsg4326/best";
  const LAYERS = {
    sentinel: { id: "s2cloudless-2020", wms: true, max: 13, credit: "Sentinel-2 cloudless 2020 · EOX · Contains modified Copernicus Sentinel data 2020" },
    relief: { id: "BlueMarble_ShadedRelief_Bathymetry", tms: "500m", max: 7, ext: "jpeg", credit: "NASA Blue Marble" },
    terrain: { id: "ASTER_GDEM_Greyscale_Shaded_Relief", tms: "31.25m", max: 11, ext: "jpeg", credit: "ASTER GDEM (NASA/METI)" },
    night: { id: "VIIRS_Black_Marble", tms: "500m", max: 7, ext: "png", time: "2016-01-01", credit: "NASA Black Marble 2016" },
    day: { id: "MODIS_Terra_CorrectedReflectance_TrueColor", tms: "250m", max: 8, ext: "jpeg", dated: true, credit: "MODIS Terra" },
  };
  const TILE_PX = 512, DEG0 = 288;
  const tileDeg = (z) => DEG0 / Math.pow(2, z);
  const matrix = (z) => ({ cols: Math.ceil(360 / tileDeg(z)), rows: Math.ceil(180 / tileDeg(z)) });

  /** Level whose pixels are at least as fine as the screen's, given screen pixels per degree. */
  function level(layer, pxPerDeg) {
    const want = 1 / Math.max(pxPerDeg, 1e-9);                  // degrees per screen pixel
    const z = Math.ceil(Math.log2((DEG0 / TILE_PX) / want) - 1e-9);
    return Math.max(0, Math.min(layer.max, z));
  }
  /** Tiles of level z covering lon [a, b], lat [s, n] (clipped to the globe). */
  function tiles(z, a, b, s, n) {
    const D = tileDeg(z), m = matrix(z), out = [];
    a = Math.max(-180, a); b = Math.min(180, b); s = Math.max(-90, s); n = Math.min(90, n);
    if (a >= b || s >= n) return out;
    const c0 = Math.floor((a + 180) / D), c1 = Math.min(m.cols - 1, Math.floor((b + 180 - 1e-9) / D));
    const r0 = Math.floor((90 - n) / D), r1 = Math.min(m.rows - 1, Math.floor((90 - s - 1e-9) / D));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      out.push({ z, r, c, lon0: -180 + c * D, lon1: -180 + (c + 1) * D, lat1: 90 - r * D, lat0: 90 - (r + 1) * D });
    }
    return out;
  }
  function url(layer, t, date) {
    if (layer.wms) {
      // WMS 1.1.1 uses longitude/latitude axis order for EPSG:4326.
      const bbox = [Math.max(-180, t.lon0), Math.max(-90, t.lat0), Math.min(180, t.lon1), Math.min(90, t.lat1)].join(",");
      return "https://tiles.maps.eox.at/wms?" + new URLSearchParams({
        SERVICE: "WMS", VERSION: "1.1.1", REQUEST: "GetMap", LAYERS: layer.id,
        STYLES: "", SRS: "EPSG:4326", BBOX: bbox,
        WIDTH: String(TILE_PX), HEIGHT: String(TILE_PX), FORMAT: "image/jpeg"
      }).toString();
    }
    const time = layer.time || (layer.dated ? date : null);
    return `${BASE}/${layer.id}/default/${time ? time + "/" : ""}${layer.tms}/${t.z}/${t.r}/${t.c}.${layer.ext}`;
  }

  // loaded tiles by URL; insertion order doubles as age for trimming
  const cache = new Map();
  const MAX_TILES = 400;
  let failures = 0, loads = 0;
  function get(src, onload) {
    let e = cache.get(src);
    if (e) { cache.delete(src); cache.set(src, e); return e; }
    e = { img: new Image(), ok: false, failed: false };
    e.img.crossOrigin = "anonymous";                           // GIBS sends CORS headers; keeps the canvas exportable
    e.img.onload = () => { e.ok = true; loads++; onload(); };
    e.img.onerror = () => { e.failed = true; failures++; onload(); };
    e.img.src = src;
    cache.set(src, e);
    while (cache.size > MAX_TILES) cache.delete(cache.keys().next().value);
    return e;
  }

  /**
   * Draw imagery for the visible part of the map. `v` gives the visible bounds, the
   * lon/lat -> pixel functions X and Y, the screen pixels per degree (sx, sy) and the
   * device pixel ratio. Coarser levels already in the cache fill in while finer tiles load.
   */
  function draw(ctx, key, v, opt) {
    const layer = LAYERS[key];
    if (!layer) return;
    const z = level(layer, Math.max(v.sx, v.sy) * v.dpr);
    ctx.save();
    ctx.beginPath();
    ctx.rect(v.X(-180), v.Y(90), v.X(180) - v.X(-180), v.Y(-90) - v.Y(90));
    ctx.clip();
    if (opt.grey && "filter" in ctx) ctx.filter = "grayscale(1)";
    for (let lev = Math.max(0, z - 3); lev <= z; lev++) {
      for (const t of tiles(lev, v.lon0, v.lon1, v.lat0, v.lat1)) {
        const src = url(layer, t, opt.date);
        const e = lev === z ? get(src, opt.onload) : cache.get(src);
        if (!e || !e.ok) continue;
        const x0 = v.X(t.lon0), x1 = v.X(layer.wms ? Math.min(180, t.lon1) : t.lon1),
          y0 = v.Y(t.lat1), y1 = v.Y(layer.wms ? Math.max(-90, t.lat0) : t.lat0);
        ctx.drawImage(e.img, x0, y0, x1 - x0, y1 - y0);
      }
    }
    ctx.restore();
    return z;
  }

  const api = { LAYERS, TILE_PX, tileDeg, matrix, level, tiles, url, draw, status: () => ({ loads, failures, cached: cache.size }) };
  root.TDBasemap = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
