"""Same-origin development service: date selection in the existing viewer -> EE.

Run behind a properly configured application gateway for a hosted deployment;
GitHub Pages only serves the dated static archive, not this Python process.
"""
from datetime import date, timedelta
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import threading
from urllib.parse import parse_qs, unquote, urlsplit

from .fire_map import build

ROOT = Path(__file__).resolve().parent.parent


def make_handler(project, builder=build):
    gate = threading.Lock()
    cache = {}

    class Handler(SimpleHTTPRequestHandler):
        def reply(self, code, payload):
            body = json.dumps(payload, allow_nan=False).encode()
            self.send_response(code)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            url = urlsplit(self.path)
            if url.path == '/api/fire-map':
                params = parse_qs(url.query)
                try:
                    day = date.fromisoformat(params.get('date', [''])[0])
                    bbox = [float(x) for x in params.get('bbox', [''])[0].split(',')]
                    if len(bbox) != 4:
                        raise ValueError('bbox requires west,south,east,north')
                except ValueError as exc:
                    self.reply(400, {'error': str(exc)})
                    return
                if not gate.acquire(blocking=False):
                    self.reply(429, {'error': 'Another Earth Engine request is running; try again shortly.'})
                    return
                try:
                    key = (day.isoformat(), tuple(bbox))
                    if key not in cache:
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
                    self.reply(502, {'error': 'Earth Engine request failed; check server authorization and dataset availability.'})
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


def serve(project, port=8000):
    server = ThreadingHTTPServer(('127.0.0.1', port), make_handler(project))
    print(f'Trend Detective with Earth Engine service on port {port}; Ctrl-C to stop.', flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()
