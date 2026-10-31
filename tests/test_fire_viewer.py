"""Optional real Chromium checks; synthetic report is a test fixture only."""
import functools
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import shutil
import threading

import pytest

playwright = pytest.importorskip("playwright.sync_api")
pytestmark = pytest.mark.skipif(not shutil.which("chromium"), reason="system Chromium not installed")
ROOT = Path(__file__).resolve().parent.parent


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def test_fire_page_import_language_and_mobile(tmp_path):
    server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(QuietHandler, directory=str(ROOT)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with playwright.sync_playwright() as p:
            browser = p.chromium.launch(executable_path=shutil.which("chromium"), args=["--no-sandbox"])
            page = browser.new_page(viewport={"width": 390, "height": 844})
            errors = []
            page.on("pageerror", lambda exc: errors.append(str(exc)))
            response = page.goto(f"http://127.0.0.1:{server.server_port}/web/fire.html")
            assert response.status == 200
            assert "Түймрийн" in page.locator("h1").inner_text()
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
            page.locator("#language").click()
            assert "Fire weather" in page.locator("h1").inner_text()

            fixture = {"schema": "trend-detective/fire-context/v1", "bbox": [106.7, 47.7, 107, 47.9],
                       "start_inclusive": "2025-04-01", "end_exclusive": "2025-10-01",
                       "matched_scene_count": 0, "scenes": []}
            report = tmp_path / "test-report.json"
            report.write_text(json.dumps(fixture))
            page.locator("#report-file").set_input_files(str(report))
            playwright.expect(page.locator("#report")).to_contain_text("No qualifying scenes")

            fixture.update(matched_scene_count=1, scenes=[{
                "metadata": {"LANDSAT_PRODUCT_ID": "<img src=x onerror=alert(1)>", "CLOUD_COVER": 2},
                "acquired_utc": "2025-06-01T03:00:00Z", "surface_means": {"lst_c": 30},
                "weather": {"values": None}, "previews": {"rgb": "https://invalid.test/tracker.png"}}])
            report.write_text(json.dumps(fixture))
            page.locator("#report-file").set_input_files(str(report))
            playwright.expect(page.locator("#report")).to_contain_text("30.00")
            assert page.locator("#report img").count() == 0
            assert page.locator("#report h3").inner_text() == "<img src=x onerror=alert(1)>"
            assert "No data" in page.locator("#report").inner_text()

            fixture["scenes"][0]["metadata"]["CLOUD_COVER"] = -1
            report.write_text(json.dumps(fixture))
            page.locator("#report-file").set_input_files(str(report))
            playwright.expect(page.locator("#status")).to_contain_text("Invalid report")
            assert page.locator("#report").inner_text() == ""
            page.locator("#language").click()
            page.screenshot(path=str(tmp_path / "fire-mobile.png"), full_page=True)
            assert not errors
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
