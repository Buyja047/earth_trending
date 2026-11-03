"""Same-origin development service: date selection in the existing viewer -> EE.

Run behind a properly configured application gateway for a hosted deployment;
GitHub Pages only serves the dated static archive, not this Python process.
"""
from datetime import date, timedelta
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import math
from pathlib import Path
import threading
from urllib.parse import parse_qs, unquote, urlsplit

from .fire_map import build

ROOT = Path(__file__).resolve().parent.parent


def make_handler(project, builder=build, dust_dir=None, dust_builder=None,
                 modis_live=False, modis_cache=None, modis_sensor="terra", modis_resolution=5000,
                 allow_origin=None):
    if allow_origin:
        origin = urlsplit(allow_origin)
        if origin.scheme not in ("https", "http") or not origin.netloc or origin.path or origin.query or origin.fragment or origin.username or origin.password:
            raise ValueError("CORS origin must be an exact http(s) origin without path or credentials")
    gate = threading.Lock()
    cache = {}

    class Handler(SimpleHTTPRequestHandler):
        def reply(self, code, payload):
            body = json.dumps(payload, allow_nan=False).encode()
            self.send_response(code)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            if allow_origin:
                self.send_header('Access-Control-Allow-Origin', allow_origin)
                self.send_header('Vary', 'Origin')
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            url = urlsplit(self.path)
            if url.path in ('/api/fire-map', '/api/dust-map'):
                dust = url.path == '/api/dust-map'
                params = parse_qs(url.query)
                try:
                    day = date.fromisoformat(params.get('date', [''])[0])
                    bbox = [float(x) for x in params.get('bbox', [''])[0].split(',')]
                    if len(bbox) != 4:
                        raise ValueError('bbox requires west,south,east,north')
                    if not all(math.isfinite(v) for v in bbox) or not (
                            -180 <= bbox[0] < bbox[2] <= 180 and -90 <= bbox[1] < bbox[3] <= 90):
                        raise ValueError('Invalid WGS84 bounding box')
                except ValueError as exc:
                    self.reply(400, {'error': str(exc)})
                    return
                if not gate.acquire(blocking=False):
                    self.reply(429, {'error': 'Another observation request is running; try again shortly.'})
                    return
                try:
                    key = (url.path, day.isoformat(), tuple(bbox))
                    if dust and modis_live:
                        cache.pop(key, None)  # direct pipeline rechecks late granules
                    if key not in cache:
                        if dust:
                            if modis_live:
                                from .modis_daily import build_direct
                                result = build_direct(day.isoformat(), bbox, cache_dir=modis_cache,
                                                      sensor=modis_sensor, resolution=modis_resolution)
                            elif dust_dir is None:
                                raise RuntimeError('Daily calibrated MODIS data service is not configured')
                            else:
                                from .dust_map import build_day
                                result = (dust_builder or build_day)(dust_dir, day.isoformat(), bbox)
                        else:
                            if project is None:
                                raise RuntimeError('Earth Engine fire service is not configured')
                            result = builder(project, bbox, day.isoformat(), (day + timedelta(days=1)).isoformat())
                        if result['period']['start'] != day.isoformat():
                            raise RuntimeError('No map for the requested day')
                        if len(cache) >= 8:
                            cache.pop(next(iter(cache)))
                        cache[key] = result
                    self.reply(200, cache[key])
                except (ValueError, RuntimeError) as exc:
                    self.reply(422, {'error': str(exc)})
                except Exception:
                    # Do not expose OAuth or signed download URLs in HTTP errors.
                    self.reply(502, {'error': 'Observation request failed; check server authorization and dataset availability.'})
                finally:
                    gate.release()
                return
            path = unquote(url.path)
            if path == '/':
                self.send_response(302)
                self.send_header('Location', '/web/index.html')
                self.end_headers()
                return
            if not path.startswith('/web/') or any(p.startswith('.') for p in path.split('/') if p):
                self.send_error(404)
                return
            super().do_GET()

        def list_directory(self, path):
            self.send_error(404)
            return None

    return partial(Handler, directory=str(ROOT))


def serve(project, port=8000, dust_dir=None, **modis_options):
    server = ThreadingHTTPServer(('127.0.0.1', port), make_handler(project, dust_dir=dust_dir, **modis_options))
    print(f'Trend Detective observation service on port {port}; Ctrl-C to stop.', flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()
