"""The regime-shift layer and the offline copy (service worker), in the real viewer."""
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import shutil
import threading

import pytest

playwright = pytest.importorskip("playwright.sync_api")
pytestmark = pytest.mark.skipif(not shutil.which("chromium"), reason="system Chromium unavailable")
ROOT = Path(__file__).resolve().parent.parent


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


@pytest.fixture(scope="module")
def server():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(QuietHandler, directory=str(ROOT)))
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{srv.server_port}/web/index.html"
    srv.shutdown(); srv.server_close(); thread.join()


def launch(p):
    return p.chromium.launch(executable_path=shutil.which("chromium"), args=["--no-sandbox"])


def test_regime_shift_layer_counts_colours_and_availability(server):
    with playwright.sync_playwright() as p:
        browser = launch(p)
        page = browser.new_page(viewport=dict(width=1400, height=950))
        page.add_init_script("localStorage.setItem('td.seenGuide','1'); localStorage.setItem('td.lang','en')")
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(server + "#mn-t2m")
        page.wait_for_function("() => window.TDApp && TDApp.state.res && TDApp.state.sc.id === 'mn-t2m'")
        assert "shift" in page.evaluate("TDApp.availLayers()")
        page.evaluate("TDApp.setLayer('shift')")
        page.wait_for_function("() => TDApp.state.res.shift && TDApp.state.res.shift.key", timeout=60000)
        page.wait_for_timeout(300)
        counts = page.evaluate("Array.from(TDApp.state.res.shift.counts)")
        valid = page.evaluate("TDApp.state.res.counts.valid")
        assert sum(counts) == page.evaluate("TDApp.state.sc.grid.nx * TDApp.state.sc.grid.ny") and sum(counts[1:]) <= valid
        assert sum(counts[1:]) > 0.8 * valid, counts      # almost every valid cell gets a verdict on both halves
        legend = page.locator("#legend").inner_text()
        assert "Reversed, both halves significant" in legend and "1981–2002" in legend and "2003–2025" in legend, legend
        # the canvas carries red or blue (a reversal coloured by the second half) and grey (same direction)
        px = page.locator("#map").evaluate("""c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let col = 0, grey = 0;
          for (let i = 0; i < d.length; i += 4) { const r = d[i], g = d[i+1], b = d[i+2]; if (Math.abs(r - b) > 60) col++; else if (r === 225 && g === 225 && b === 225) grey++; } return {col, grey}; }""")
        assert px["col"] > 50 and px["grey"] > 50, px
        # a window under 20 years has no halves worth testing: the layer disappears and the map falls back to the trend
        page.evaluate("TDApp.configure({years: [2010, 2025]}).then(() => TDApp.renderAll())")
        page.wait_for_function("() => TDApp.state.y0 === 2010 && !document.querySelector('#busy') .offsetParent")
        assert "shift" not in page.evaluate("TDApp.availLayers()") and page.evaluate("TDApp.state.layer") == "trend"
        assert not errors, errors
        browser.close()


def test_viewer_reopens_offline_after_one_visit(server):
    with playwright.sync_playwright() as p:
        browser = launch(p)
        context = browser.new_context(viewport=dict(width=1200, height=900))
        page = context.new_page()
        page.add_init_script("localStorage.setItem('td.seenGuide','1'); localStorage.setItem('td.lang','en')")
        page.goto(server + "#mn-t2m")
        page.wait_for_function("() => window.TDApp && TDApp.state.res")
        page.wait_for_function("() => navigator.serviceWorker && navigator.serviceWorker.controller", timeout=30000)
        page.wait_for_function("""() => caches.open('trend-detective-v1').then(c => c.keys()).then(ks => ks.some(r => r.url.endsWith('data/mn-t2m.js')) && ks.some(r => r.url.endsWith('js/app.js')))""", timeout=30000)
        context.set_offline(True)
        page.reload()
        page.wait_for_function("() => window.TDApp && TDApp.state.res && TDApp.state.sc.id === 'mn-t2m'", timeout=30000)
        assert "Air temperature" in page.locator("#summary").inner_text()
        # a dataset that was never opened is not there offline, and the page says so instead of hanging
        page.locator('[data-go="mn-precip"]').click()
        page.wait_for_timeout(1500)
        assert page.evaluate("TDApp.state.sc.id") == "mn-t2m"
        context.set_offline(False)
        browser.close()
