"""Walk every case file in the real viewer: each step applies, shows live evidence, and the verdict renders."""
import functools
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re
import shutil
import subprocess
import threading

import pytest

playwright = pytest.importorskip("playwright.sync_api")
pytestmark = pytest.mark.skipif(not shutil.which("chromium"), reason="system Chromium unavailable")
ROOT = Path(__file__).resolve().parent.parent


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def case_list():
    out = subprocess.run([shutil.which("node"), "-e", "require('./web/js/cases.js');console.log(JSON.stringify(globalThis.TDCases.list()))"],
                         cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return json.loads(out)


@pytest.fixture(scope="module")
def server():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(QuietHandler, directory=str(ROOT)))
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{srv.server_port}/web/index.html"
    srv.shutdown(); srv.server_close(); thread.join()


def launch(p):
    return p.chromium.launch(executable_path=shutil.which("chromium"), args=["--no-sandbox"])


def settled(page):
    page.wait_for_function("() => { const b = document.querySelector('#casebar'); return b && !b.hidden && !b.querySelector('[data-case-nav=next][disabled], .casenav [data-case][disabled]') && document.querySelector('#busy').hidden; }", timeout=30000)
    page.wait_for_timeout(150)


def test_every_case_walks_to_a_verdict_with_live_evidence(server):
    cases = case_list()
    with playwright.sync_playwright() as p:
        browser = launch(p)
        page = browser.new_page(viewport=dict(width=1440, height=950))
        page.add_init_script("localStorage.setItem('td.lang','en')")
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(server)
        # first visit: the case board, not the ten-step guide
        playwright.expect(page.locator("#modal .caseboard")).to_be_visible()
        assert page.locator("#modal .casecard").count() == len(cases)
        page.locator("#modalclose").click()
        assert page.locator("#modal").is_hidden()
        for c in cases:
            page.locator("#casesbtn").click()
            page.locator(f'#modal [data-case="{c["id"]}"]').click()
            for k in range(c["steps"]):
                settled(page)
                head = page.locator("#casebar .casehead").inner_text().lower()   # the eyebrow is upper-cased by CSS
                assert f"step {k + 1} of {c['steps']}" in head, (c["id"], head)
                assert page.evaluate("location.hash") == f"#case/{c['id']}/{k + 1}"
                body = page.locator("#casebar .casebody").inner_text()
                assert "Resume the case" not in body, (c["id"], k, body)
                if k < c["steps"] - 1:
                    ev = page.locator("#casebar .evidence")
                    assert ev.count() == 1, (c["id"], k, body)
                    assert re.search(r"\d", ev.inner_text()), (c["id"], k, ev.inner_text())
                    assert "NaN" not in ev.inner_text() and "undefined" not in ev.inner_text(), (c["id"], k, ev.inner_text())
                    page.locator('[data-case-nav="next"]').click()
                else:
                    verdict = page.locator("#casebar .verdict")
                    assert verdict.count() == 1 and "What is changing" in verdict.inner_text(), (c["id"], body)
                    assert "NaN" not in body and "undefined" not in body, (c["id"], body)
            page.locator('[data-case-nav="exit"]').click()
            assert page.locator("#casebar").is_hidden()
        assert not errors, errors
        browser.close()


def test_deep_link_language_and_return_to_the_workbench(server):
    with playwright.sync_playwright() as p:
        browser = launch(p)
        page = browser.new_page(viewport=dict(width=1200, height=900))
        page.add_init_script("localStorage.setItem('td.seenGuide','1'); localStorage.setItem('td.lang','mn')")
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(server + "#case/mongolia-warming/3")
        settled(page)
        assert page.locator("#modal").is_hidden()
        head = page.locator("#casebar .casehead").inner_text().lower()
        assert "5-ийн 3-р алхам" in head and "монгол дулаарч" in head, head
        assert page.locator("#season").input_value() == "djf"
        assert "Өвөл" in page.locator("#casebar .evidence").inner_text()
        # moving away from the case's dataset is noticed, and the case can be resumed
        page.locator('[data-go="mn-precip"]').click()
        page.wait_for_function("() => document.querySelector('#casebar [data-case-nav=resume]')")
        page.locator('[data-case-nav="resume"]').click()
        settled(page)
        assert page.locator('[data-case-nav="resume"]').count() == 0
        page.locator('[data-lang="en"]').click()
        assert "step 3 of 5" in page.locator("#casebar .casehead").inner_text().lower()
        # back in the workbench everything is enabled again
        page.locator('[data-case-nav="exit"]').click()
        page.locator('[data-go="mn-t2m"]').click()
        playwright.expect(page.locator("#y0")).to_be_enabled()
        assert page.evaluate("location.hash") == "#mn-t2m"
        assert not errors, errors
        browser.close()
