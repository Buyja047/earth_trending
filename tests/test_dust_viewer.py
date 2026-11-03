"""Exercise actual browser rendering with explicitly synthetic test-only rasters."""
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


def fixture_map():
    return dict(schema='trend-detective/dust-map/v1', id='dust-risk', kind='dust-risk',
        title='TEST ONLY dust', region='mongolia', method='modis-idi-otsu-v1',
        period=dict(start='2025-06-01',end='2025-06-01'),acquired_utc='2025-06-01T03:00:00Z',
        source='TEST ONLY MODIS',native_resolution_m=1000,idi_threshold=1.,water_detection_enabled=True,
        grid=dict(nx=3,ny=2,lon=[106.75,106.85,106.95],lat=[47.75,47.85],dlon=.1,dlat=.1),
        classes=[0,1,2,3,4,-1],factors={
            **{k:[.1,.2,.3,.4,.5,None] for k in ['ndvi','ndwi','ndwi_nir_swir','ndai','btd_20_31','r47']},
            'idi':[.8,1.2,1.,1.,1.,None]},
        areas=dict(land_dust_km2=20.,water_dust_km2=5.,observed_km2=100.,
                   unclassified_km2=10.,missing_km2=30.,total_km2=130.))


def test_daily_dust_selection_archive_dates_language_and_return(tmp_path):
    class Quiet(SimpleHTTPRequestHandler):
        def log_message(self,*args): pass
    server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)))
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    try:
        with playwright.sync_playwright() as p:
            browser=p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox'])
            page=browser.new_page(viewport=dict(width=1440,height=1000))
            page.add_init_script("localStorage.setItem('td.seenGuide','1'); localStorage.setItem('td.lang','mn')")
            errors=[];page.on('pageerror',lambda e:errors.append(e.stack))
            fixture=fixture_map()
            page.route('**/data/dust-risk.js',lambda r:r.fulfill(content_type='application/javascript',body='TD_DATA("dust-risk",'+json.dumps(fixture)+');'))
            older={**fixture,'period':dict(start='2025-05-31',end='2025-05-31'),'acquired_utc':'2025-05-31T03:00:00Z'}
            page.route('**/data/dust-map-index.json',lambda r:r.fulfill(json={'maps':[
                {'date':d,'key':'dust-risk-'+d} for d in ['2025-05-31','2025-06-01']]}))
            page.route('**/data/dust-risk-2025-05-31.js',lambda r:r.fulfill(body='TD_DATA("dust-risk-2025-05-31",'+json.dumps(older)+');'))
            page.route('**/data/dust-risk-2025-06-01.js',lambda r:r.fulfill(body='TD_DATA("dust-risk-2025-06-01",'+json.dumps(fixture)+');'))
            page.goto(f'http://127.0.0.1:{server.server_port}/web/index.html#risk')
            playwright.expect(page.locator('#summary')).to_contain_text('25 км²')
            playwright.expect(page.locator('#risk-type')).to_have_value('dust')
            assert page.locator('#risk-type option[value="flood"]').evaluate('e=>e.disabled')
            assert page.locator('#y0').is_disabled()
            assert page.locator('[data-view="surf"]').is_disabled()
            colors=page.locator('#map').evaluate('''c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let dust=0;for(let i=0;i<d.length;i+=4)if(d[i]===237&&d[i+1]===170&&d[i+2]===48)dust++;return dust}''')
            assert colors>100
            page.locator('#risk-next').click()
            playwright.expect(page.locator('#legend')).to_contain_text('Энэ өдрийн шуурганы өгөгдөлгүй')
            playwright.expect(page.locator('#yearlbl')).to_have_text('2025-06-02')
            page.locator('#risk-prev').click()
            playwright.expect(page.locator('#legend')).to_contain_text('Газар дээрх тоос')
            page.locator('#risk-prev').click()
            playwright.expect(page.locator('#yearlbl')).to_have_text('2025-05-31')
            page.locator('#risk-next').click()
            playwright.expect(page.locator('#yearlbl')).to_have_text('2025-06-01')
            page.locator('[data-tab="method"]').click()
            playwright.expect(page.locator('#method')).to_contain_text('BT20/BT31')
            page.locator('[data-lang="en"]').click()
            playwright.expect(page.locator('#risk-type')).to_contain_text('Yellow dust storm')
            page.locator('[data-tab="map"]').click()
            page.locator('#risk-type').select_option('fire')
            playwright.expect(page.locator('#summary')).to_contain_text('Fire map')
            page.locator('#risk-type').select_option('dust')
            playwright.expect(page.locator('#summary')).to_contain_text('Yellow dust distribution')
            page.locator('[data-go="mn-t2m"]').click()
            playwright.expect(page.locator('#y0')).to_be_enabled()
            assert page.locator('#risk-type-row').is_hidden()
            # Toolbar reopens the last chosen type, without leaving the workspace.
            page.locator('.toolbar [data-risk]').click()
            playwright.expect(page.locator('#risk-type')).to_have_value('dust')
            page.screenshot(path=str(tmp_path/'dust-test-only.png'))
            assert not errors,errors
            browser.close()
    finally:server.shutdown();server.server_close();thread.join()
