import json
from unittest.mock import patch

import numpy as np
import pytest

from trend_detective.fire_map import FACTORS, build, classify


def test_ranking_order_missing_and_excluded_fuel():
    a=np.arange(7,dtype=float)
    values={k:(a/10 if d==1 else 1-a/10) for k,d in FACTORS.items()}
    values['ndmi'][-1]=np.nan
    fuel=np.ones(7,bool);fuel[-2]=False
    score,classes=classify(values,fuel)
    assert classes.tolist()==[0,1,2,3,4,-1,-1]
    assert score[:5].tolist()==[0,.25,.5,.75,1]
    assert np.isnan(score[-2:]).all()


def test_identical_values_do_not_create_spatial_hotspots():
    score,classes=classify({k:np.ones(8) for k in FACTORS},np.ones(8,bool))
    assert np.all(score==.5)
    assert np.all(classes==2)


def test_empty_inputs_are_not_low_risk():
    _,classes=classify({k:np.full(3,-9999.) for k in FACTORS},np.ones(3,bool))
    assert np.all(classes==-1)


def test_real_sdk_pixel_graph_and_north_south_orientation():
    ee=pytest.importorskip('ee')
    from ee.apitestcase import GetAlgorithms
    ee.Reset()
    initialize=ee.Initialize
    acquired=1748746800000
    metadata={'system:time_start':acquired,'CLOUD_COVER':1,'LANDSAT_PRODUCT_ID':'TEST_ONLY','SPACECRAFT_ID':'LANDSAT_9'}
    recorded={}
    def pixels(params):
        params['expression'].serialize()
        dims=params['grid']['dimensions'];h,w=dims['height'],dims['width']
        a=np.zeros((h,w),dtype=[(k,'f8') for k in list(FACTORS)+['landcover']])
        for k in FACTORS:a[k]=(np.arange(h*w).reshape(h,w)/100 if FACTORS[k]==1 else 1-np.arange(h*w).reshape(h,w)/100)
        a['landcover']=10
        recorded['a']=a
        return a
    try:
        with patch.object(ee,'Initialize',side_effect=lambda **kw:initialize(None,'',project=kw['project'])),patch.object(ee.data,'_install_cloud_api_resource'),patch.object(ee.data,'getAlgorithms',GetAlgorithms),patch.object(ee.data,'computeValue',side_effect=[1,metadata,1,7]),patch.object(ee.data,'computePixels',side_effect=pixels):
            result=build('offline-test',[106.7,47.7,106.702,47.702],'2025-04-01','2025-10-01')
        assert result['grid']['lat']==sorted(result['grid']['lat'])
        assert result['factors']['lst_c']==np.flipud(recorded['a']['lst_c']).ravel().tolist()
        assert any(c>=0 for c in result['classes'])
        json.dumps(result,allow_nan=False)
    finally:ee.Reset()
