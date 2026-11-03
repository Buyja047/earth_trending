import json
import threading
from http.server import ThreadingHTTPServer
from urllib.request import urlopen
from urllib.error import HTTPError

import pytest

from trend_detective.fire_server import make_handler
from trend_detective.fire_map import publish
from trend_detective.payload import read_payload


def test_same_origin_endpoint_exact_date_and_no_secret_errors():
    calls=[]
    def builder(project,bbox,start,end):
        calls.append((project,bbox,start,end))
        if start=='2025-06-02':raise RuntimeError('No qualifying clear scene')
        if start=='2025-06-03':raise Exception('secret must not reach browser')
        return {'period':{'start':start}}
    server=ThreadingHTTPServer(('127.0.0.1',0),make_handler('project',builder))
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    url=f'http://127.0.0.1:{server.server_port}'
    try:
        for _ in range(2):
            with urlopen(url+'/api/fire-map?date=2025-06-01&bbox=106,47,107,48') as r:
                assert json.load(r)['period']['start']=='2025-06-01'
        assert calls==[('project',[106.,47.,107.,48.],'2025-06-01','2025-06-02')]
        for day in ['2025-06-02','2025-06-03']:
            with pytest.raises(HTTPError) as e:urlopen(url+f'/api/fire-map?date={day}&bbox=106,47,107,48')
            body=e.value.read().decode();assert 'secret' not in body
        with pytest.raises(HTTPError):urlopen(url+'/.git/config')
        with urlopen(url+'/web/index.html') as r:assert r.status==200
    finally:server.shutdown();server.server_close();thread.join()


def test_publishing_retains_dates_and_replaces_same_date(tmp_path):
    path=tmp_path/'fire-risk.js'
    for day in ['2025-06-01','2025-06-02','2025-06-01']:
        publish({'period':{'start':day}},path)
    index=json.loads((tmp_path/'fire-map-index.json').read_text())
    assert [x['date'] for x in index['maps']]==['2025-06-01','2025-06-02']
    assert read_payload(tmp_path/'fire-risk-2025-06-02.js')['period']['start']=='2025-06-02'


def test_dust_endpoint_does_not_share_fire_cache_or_expose_failures(tmp_path):
    calls=[]
    def dust_builder(folder,day,bbox):
        calls.append(day)
        if day=='2025-06-02':raise Exception('secret file path')
        return {'period':{'start':day},'kind':'dust-risk'}
    server=ThreadingHTTPServer(('127.0.0.1',0),make_handler(None,dust_dir=tmp_path,dust_builder=dust_builder))
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    base=f'http://127.0.0.1:{server.server_port}/api/'
    try:
        for _ in range(2):
            with urlopen(base+'dust-map?date=2025-06-01&bbox=100,40,110,50') as r:
                assert json.load(r)['kind']=='dust-risk'
        assert calls==['2025-06-01']
        for path in ['dust-map?date=2025-06-02&bbox=100,40,110,50',
                     'dust-map?date=2025-06-01&bbox=nan,40,110,50',
                     'fire-map?date=2025-06-01&bbox=100,40,110,50']:
            with pytest.raises(HTTPError) as exc:urlopen(base+path)
            assert 'secret' not in exc.value.read().decode()
    finally:server.shutdown();server.server_close();thread.join()
