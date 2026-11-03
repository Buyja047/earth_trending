"""Native HDF4 -> daily map checks; all generated HDFs are TEST ONLY."""
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess

import numpy as np
import pytest
import requests

from trend_detective import modis_source as source
from trend_detective import modis_daily as daily
from trend_detective.modis_swath import (Swath, read_swath, brightness_temperature,
                                         decode_cloud_mask, scale_counts)

NAMES = ['MOD021KM.A2025152.0300.061.2025153000000.hdf',
         'MOD03.A2025152.0300.061.2025153000000.hdf',
         'MOD35_L2.A2025152.0300.061.2025153000000.hdf']
BBOX = [106., 45., 106.06, 45.05]
RINGS = [np.array([[100, 40], [120, 40], [120, 50], [100, 50], [100, 40]])]


class Response:
    def __init__(self, payload=None, body=source.HDF4_MAGIC+b'test', status=200, url='https://ladsweb.modaps.eosdis.nasa.gov/file.hdf', mime='application/octet-stream'):
        self.payload, self.body, self.status_code, self.url = payload, body, status, url
        self.headers = {'Content-Type': mime, 'Content-Length': str(len(body))}
    def json(self): return self.payload
    def raise_for_status(self):
        if self.status_code != 200: raise requests.HTTPError('untrusted server text')
    def iter_content(self, size): yield self.body
    def __enter__(self): return self
    def __exit__(self,*args): pass


def entry(name, flag='DAY'):
    return {'producer_granule_id': name, 'day_night_flag': flag, 'granule_size':'10'}


def test_cmr_pairs_exact_time_version_and_skips_night():
    calls=[]
    class Session:
        def get(self,url,params,**kwargs):
            calls.append(params)
            product=params['short_name']
            name=next(n for n in NAMES if n.split('.')[0]==product)
            extra=[entry(NAMES[0].replace('.0300.', '.1500.'),'NIGHT')] if product=='MOD021KM' else []
            return Response({'feed':{'entry':[entry(name),*extra]}})
    groups=source.discover('2025-06-01',BBOX,session=Session())
    assert [[g.name for g in group] for group in groups]==[NAMES]
    assert all(c['version']=='6.1' and c['provider']=='LAADS' for c in calls)
    assert groups[0][0].url.endswith('/MOD021KM/2025/152/'+NAMES[0])


def test_cmr_missing_companion_fails_instead_of_partial_map():
    class Session:
        def get(self,url,params,**kwargs):
            records=[entry(n) for n in NAMES[:2] if n.split('.')[0]==params['short_name']]
            return Response({'feed':{'entry':records}})
    with pytest.raises(source.ModisAccessError,match='matching MODIS'):
        source.discover('2025-06-01',BBOX,session=Session())


def test_download_auth_html_checksum_and_safe_error(tmp_path,monkeypatch):
    monkeypatch.delenv('EARTHDATA_TOKEN',raising=False)
    granule=source.Granule(NAMES[0])
    with pytest.raises(source.ModisAccessError,match='EARTHDATA_TOKEN'):
        source.download(granule,tmp_path)
    class Session:
        def __init__(self,response):self.response=response;self.calls=0
        def get(self,url,headers,**kwargs):
            self.calls+=1
            assert url==granule.url and headers['Authorization']=='Bearer TEST_SECRET'
            return self.response
    login=Session(Response(body=b'<html>TEST_SECRET</html>',mime='text/html',url='https://urs.earthdata.nasa.gov/oauth/authorize'))
    with pytest.raises(source.ModisAccessError) as exc:source.download(granule,tmp_path,'TEST_SECRET',login)
    assert 'TEST_SECRET' not in str(exc.value) and not list(tmp_path.rglob('*.part'))
    good=Session(Response())
    path=source.download(granule,tmp_path,'TEST_SECRET',good)
    assert source.download(granule,tmp_path,session=good)==path and good.calls==1
    receipt=json.loads(path.with_suffix('.receipt.json').read_text())
    assert receipt['bytes']==8 and len(receipt['sha256'])==64
    assert 'TEST_SECRET' not in path.with_suffix('.receipt.json').read_text()
    path.write_bytes(b'corrupt')
    source.download(granule,tmp_path,'TEST_SECRET',good)
    assert good.calls==2


def test_mask_byte_bits_and_scaling():
    # determined + confidently clear + day + no snow; bit7 may make signed int8 negative
    cloud,snow=decode_cloud_mask(np.array([63,-1,61,31,55,62],dtype=np.int8))
    np.testing.assert_allclose(cloud[:4],[0,0,1,0])
    np.testing.assert_allclose(snow[:4],[0,0,0,1])
    assert np.isnan(cloud[4:]).all()
    attrs=dict(valid_range=[0,32767],_FillValue=65535,radiance_scales=[.01],radiance_offsets=[10])
    np.testing.assert_allclose(scale_counts(np.array([100,65535,32768]),attrs,0,'radiance'),[.9,np.nan,np.nan],equal_nan=True)
    assert np.isnan(brightness_temperature(np.array([0.,-1]),31)).all()


@pytest.mark.parametrize('band,radiance,expected',[
    (20,[1.,2.,3.],[318.0701788,337.7024380,350.3502352]),
    (31,[5.,9.5,15.],[261.4025034,299.5224076,333.9401351]),
    (32,[5.,9.5,15.],[262.2940292,304.5323149,343.4839139]),
])
def test_kelvin_values_against_satpy_modis_bright_reference(band,radiance,expected):
    # Independently evaluated Satpy calibrate_bt, scale=1/offset=0. Float32
    # coefficients in the reference account for tiny differences from float64.
    np.testing.assert_allclose(brightness_temperature(radiance,band),expected,atol=.0002,rtol=0)


def hdf_triplet(folder):
    pyhdf=pytest.importorskip('pyhdf.SD')
    SD,SDC=pyhdf.SD,pyhdf.SDC
    lon,lat,dx,dy,*_=daily.output_grid(BBOX,1000)
    xx,yy=np.meshgrid(lon,lat)
    ny,nx=xx.shape
    def field(f,name,a,attrs=None):
        typ=SDC.FLOAT64 if np.issubdtype(a.dtype,np.floating) else SDC.UINT16
        d=f.create(name,typ,a.shape);d[:]=a
        for k,v in (attrs or {}).items():setattr(d,k,v)
        d.endaccess()
    paths=[folder/n for n in NAMES]
    with_sd=SD(str(paths[1]),SDC.WRITE|SDC.CREATE)
    field(with_sd,'Latitude',yy);field(with_sd,'Longitude',xx)
    field(with_sd,'SolarZenith',np.zeros_like(xx,dtype=np.uint16),{'scale_factor':.01})
    with_sd.end()
    f=SD(str(paths[0]),SDC.WRITE|SDC.CREATE)
    reflectance={1:.15,2:.3,3:.1,4:.2,5:.1,7:.1,8:.01}
    for name,bs in [('EV_250_Aggr1km_RefSB',[1,2]),('EV_500_Aggr1km_RefSB',[3,4,5,6,7]),('EV_1KM_RefSB',[8])]:
        values=np.stack([np.full(xx.shape,int(reflectance.get(b,.1)*10000),dtype=np.uint16) for b in bs])
        field(f,name,values,dict(band_names=','.join(map(str,bs)),valid_range=[0,32767],reflectance_scales=[.0001]*len(bs),reflectance_offsets=[0.]*len(bs)))
    # Real radiance units; two temperatures in band32 produce two IDI groups.
    rad=np.stack([np.full_like(xx,1.),np.full_like(xx,9.5),np.where(np.indices(xx.shape)[1]<nx//2,8.,10.)])
    field(f,'EV_1KM_Emissive',(rad*1000).astype(np.uint16),dict(band_names='20,31,32',valid_range=[0,32767],radiance_scales=[.001]*3,radiance_offsets=[0.]*3))
    f.end()
    f=SD(str(paths[2]),SDC.WRITE|SDC.CREATE)
    flags=np.full((6,ny,nx),63,dtype=np.uint16);flags[0,0,0]=61
    field(f,'Cloud_Mask',flags);f.end()
    return paths


def test_native_hdf_channels_to_calibrated_indices(tmp_path):
    paths=hdf_triplet(tmp_path)
    swath=read_swath(*paths,BBOX)
    assert swath.acquired_utc=='2025-06-01T03:00:00+00:00'
    assert swath.classes[0,0]==-1
    assert set(np.unique(swath.classes))=={-1,0,1}
    np.testing.assert_allclose(swath.factors['ndvi'][1:],1/3)
    with pytest.raises(ValueError,match='identical'):
        read_swath(paths[0],paths[1].with_name(NAMES[1].replace('.0300.','.0400.')),paths[2],BBOX)


def test_daily_union_keeps_dust_and_source_through_later_clear_and_cloud(tmp_path):
    paths=hdf_triplet(tmp_path)
    swath=read_swath(*paths,BBOX)
    shape=swath.classes.shape
    later=Swath(swath.lon,swath.lat,np.where(swath.classes>=0,0,-1),
                {k:np.where(swath.classes>=0,.5,np.nan) for k in daily.FACTOR_NAMES},
                1.,'2025-06-01T04:00:00Z',[n.replace('.0300.','.0400.') for n in NAMES])
    result=daily.compose([swath,later],'2025-06-01',BBOX,1000,country_rings=RINGS)
    assert result['areas']['land_dust_km2']>0
    assert any(c==1 and result['observation_index'][i]==0 for i,c in enumerate(result['classes']))
    assert any(c==0 and result['observation_index'][i]==1 for i,c in enumerate(result['classes']))
    assert result['areas']['missing_km2']>0
    # Exercise the JS import trust boundary against a Python-generated daily payload.
    root=Path(__file__).resolve().parent.parent
    script="require('./web/js/dust-map.js');let s=JSON.parse(require('fs').readFileSync(0,'utf8'));TDDustMap.validate(s);console.log(TDDustMap.csv(s).split('\\n')[1]);s.observation_index.fill(-1);try{TDDustMap.validate(s);process.exit(1)}catch(e){}"
    run=subprocess.run(['node','-e',script],input=json.dumps(result,allow_nan=False),text=True,capture_output=True,cwd=root)
    assert run.returncode==0,run.stderr
    assert 'acquired_utc,idi_threshold' in run.stdout


def test_display_reduction_preserves_working_grid_area(tmp_path):
    paths=hdf_triplet(tmp_path);swath=read_swath(*paths,BBOX)
    fine=daily.compose([swath],'2025-06-01',BBOX,1000,country_rings=RINGS)
    # A larger region is needed for at least two 2km display cells in both axes.
    coarse=daily.compose([swath],'2025-06-01',BBOX,2000,country_rings=RINGS)
    assert coarse['areas']['land_dust_km2']==pytest.approx(fine['areas']['land_dust_km2'])
    assert len(coarse['classes'])<len(fine['classes'])


def test_direct_pipeline_cache_and_late_granule_refresh(tmp_path,monkeypatch):
    paths=hdf_triplet(tmp_path)
    swath=read_swath(*paths,BBOX)
    groups=[tuple(source.Granule(n) for n in NAMES)]
    monkeypatch.setattr(daily,'discover',lambda *a,**k:groups)
    monkeypatch.setattr(daily,'download',lambda g,folder:tmp_path/g.name)
    calls=[]
    monkeypatch.setattr(daily,'read_swath',lambda *a,**k:(calls.append(1) or swath))
    monkeypatch.setattr(daily,'load_focus_rings',lambda path:RINGS)
    first=daily.build_direct('2025-06-01',BBOX,tmp_path/'cache',resolution=1000)
    assert daily.build_direct('2025-06-01',BBOX,tmp_path/'cache',resolution=1000)==first
    assert len(calls)==1
    groups.append(tuple(source.Granule(n.replace('.0300.','.0400.')) for n in NAMES))
    daily.build_direct('2025-06-01',BBOX,tmp_path/'cache',resolution=1000)
    assert len(calls)==3
