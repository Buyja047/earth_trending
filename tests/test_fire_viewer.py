"""Exercise the integrated map with an explicit test-only raster, never shipped data."""
import functools
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import shutil
import threading

import pytest

playwright = pytest.importorskip('playwright.sync_api')
pytestmark = pytest.mark.skipif(not shutil.which('chromium'), reason='system Chromium unavailable')
ROOT = Path(__file__).resolve().parent.parent

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def fixture_map():
    return dict(schema='trend-detective/fire-map/v1', id='fire-risk', kind='fire-risk',
        title='TEST ONLY fire map', region='mongolia', region_name='Mongolia', units='relative score',
        grid=dict(nx=3,ny=2,lon=[106.75,106.85,106.95],lat=[47.75,47.85],dlon=.1,dlat=.1),
        classes=[0,1,2,3,4,-1],score=[.1,.3,.5,.7,.9,None],
        factors={k:[1,2,3,4,5,None] for k in ['lst_c','ndmi','vpd_kpa','wind_ms','rain_7d_mm','soil_water']},
        metadata=dict(CLOUD_COVER=2,LANDSAT_PRODUCT_ID='TEST ONLY'),
        period=dict(start='2025-06-01',end='2025-06-01'),acquired_utc='2025-06-01T03:00:00Z',
        weather_hour_utc='2025-06-01T03:00:00Z',method='relative-percentile-six-factor-v1')


def test_integrated_risk_map_and_return_to_trends(tmp_path):
    server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(QuietHandler,directory=str(ROOT)))
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    try:
        with playwright.sync_playwright() as p:
            browser=p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox'])
            page=browser.new_page(viewport=dict(width=1440,height=950))
            page.add_init_script("localStorage.setItem('td.seenGuide','1'); localStorage.setItem('td.lang','en')")
            errors=[];page.on('pageerror',lambda e:errors.append(e.stack))
            page.route('**/data/fire-risk.js',lambda route:route.fulfill(content_type='application/javascript',body='TD_DATA("fire-risk",'+json.dumps(fixture_map())+');'))
            page.goto(f'http://127.0.0.1:{server.server_port}/web/index.html#risk')
            playwright.expect(page.locator('#legend')).to_contain_text('Very high')
            assert page.locator('.workspace').count()==1
            assert page.locator('a[href="fire.html"]').count()==0
            assert page.locator('#y0').is_disabled()
            assert page.locator('#season').is_disabled()
            assert page.locator('#map').is_visible()
            # Actual categorical colours reached the canvas, including green and red.
            colors=page.locator('#map').evaluate('''c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let red=0,green=0;for(let i=0;i<d.length;i+=4){if(d[i]===227&&d[i+1]===26&&d[i+2]===28)red++;if(d[i]===35&&d[i+1]===139&&d[i+2]===0)green++;}return {red,green}}''')
            assert colors['red']>100 and colors['green']>100
            page.locator('#map').click(position=dict(x=200,y=300))
            page.locator('#fire-date').fill('2025-06-02')
            page.locator('#fire-date').dispatch_event('change')
            playwright.expect(page.locator('#legend')).to_contain_text('No risk data for this date')
            assert page.locator('#modal').is_hidden()
            page.locator('#fire-date').fill('2025-06-01')
            page.locator('#fire-date').dispatch_event('change')
            playwright.expect(page.locator('#legend')).to_contain_text('Very high')
            page.locator('[data-lang="mn"]').click()
            playwright.expect(page.locator('#legend')).to_contain_text('Маш өндөр')
            page.screenshot(path=str(tmp_path/'integrated-fire-map-test.png'))
            page.locator('[data-tab="method"]').click()
            playwright.expect(page.locator('#method')).to_contain_text('Туршилтын')
            page.locator('[data-tab="map"]').click()
            page.locator('[data-go="mn-t2m"]').click()
            playwright.expect(page.locator('#y0')).to_be_enabled()
            assert not errors,errors
            browser.close()
    finally:
        server.shutdown();server.server_close();thread.join()
