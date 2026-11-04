"""The case files (web/js/cases.js) refer only to datasets, places, layers and months that exist."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from trend_detective.payload import read_payload

ROOT = Path(__file__).resolve().parent.parent
NODE = shutil.which("node")


def _node(script: str) -> str:
    return subprocess.run([NODE, "-e", script], cwd=ROOT, capture_output=True, text=True, check=True).stdout


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_case_definitions_check_against_the_data():
    scenes = [s["id"] for s in read_payload(ROOT / "web/data/index.js")["scenes"]] + ["fire-risk", "dust-risk"]
    places = [p["en"] for p in read_payload(ROOT / "web/data/places.js")["places"]]
    out = _node(f"""
      require('./web/js/cases.js'); const C = globalThis.TDCases;
      console.log(JSON.stringify({{problems: C.check({json.dumps(scenes)}, {json.dumps(places)}), cases: C.list()}}));""")
    r = json.loads(out)
    assert r["problems"] == []
    ids = [c["id"] for c in r["cases"]]
    assert len(ids) == len(set(ids)) and len(ids) >= 8
    # the four questions of the challenge are covered: a global case, a Mongolian one, a data trap and a method check
    assert {c["tag"] for c in r["cases"]} >= {"global", "mongolia", "trap", "hazard", "method"}
    for c in r["cases"]:
        assert c["title"]["en"] != c["title"]["mn"] and c["question"]["en"] != c["question"]["mn"]


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_the_checker_catches_bad_references():
    out = _node("""
      require('./web/js/cases.js'); const C = globalThis.TDCases;
      console.log(JSON.stringify(C.check(['mn-t2m'], [])));""")
    problems = json.loads(out)
    assert any("unknown scene" in p for p in problems) and any("unknown place" in p for p in problems)


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_a_live_scene_becomes_a_five_step_case():
    out = _node("""
      require('./web/js/cases.js'); const C = globalThis.TDCases;
      const sc = {id: 'live-1', live: true, long_name: 'Temperature at 2 Meters', var: 'T2M', kind: 'model', product_name: 'MERRA-2',
        region_name: '106°E–108°E, 47°N–48°N', units: 'C', region_means: [{key: 'box', name: 'Box mean'}],
        transitions: [{date: '2001-01', label: 'New MERRA-2 production stream'}], notes: [], live_info: {mb: 1.2, chunks: 2}};
      const c = C.template(sc);
      console.log(JSON.stringify({id: c.id, own: c.own, n: c.steps.length, first: c.steps[0].action, last: typeof c.steps[4].verdict,
        ev: c.steps.slice(0, 4).every((s) => typeof s.evidence === 'function'), en: c.title.en, mn: c.steps[0].text.mn.length > 20,
        found: C.get('own-live-1') === null}));""")
    r = json.loads(out)
    assert r["id"] == "own-live-1" and r["own"] and r["n"] == 5 and r["first"]["scene"] == "live-1"
    assert r["last"] == "function" and r["ev"] and "T2M" in r["en"] and r["mn"]
    assert r["found"], "a template is not registered until openOwn runs"


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_glossary_has_the_same_entries_in_both_languages():
    out = _node("""
      require('./web/js/i18n.js'); const I = globalThis.TDI18N;
      I.setLang('en'); const en = I.t('glossary'); I.setLang('mn'); const mn = I.t('glossary');
      console.log(JSON.stringify({en: Object.keys(en), mn: Object.keys(mn),
        ok: Object.keys(en).every((k) => en[k].length === 2 && mn[k] && mn[k].length === 2 && en[k][1] !== mn[k][1])}));""")
    r = json.loads(out)
    assert r["en"] == r["mn"] and r["ok"] and {"fdr", "sen", "pmk", "phi", "mdt", "detect", "step"} <= set(r["en"])


def test_interface_strings_exist_in_both_languages():
    src = (ROOT / "web/js/i18n.js").read_text(encoding="utf-8")
    en, mn = src.split("const MN = {")
    for key in ["m_cases", "cases_btn", "cases_title", "cases_intro", "cases_step", "cases_next", "cases_prev", "cases_exit", "cases_evidence",
                "cases_what", "cases_where", "cases_howmuch", "cases_sig", "cases_when", "cases_caveats", "cases_link", "cases_nextcase",
                "cases_tag_global", "cases_tag_mongolia", "cases_tag_trap", "cases_tag_hazard", "cases_tag_method",
                "cases_own", "cases_own_q", "cases_png", "cases_qr", "wi_label", "wi_out", "wi_never", "help_glossary"]:
        assert f"{key}:" in en and f"{key}:" in mn, key


def test_single_file_build_includes_the_case_files():
    assert '"cases.js"' in (ROOT / "scripts/make_artifact.py").read_text()
    html = (ROOT / "web/index.html").read_text(encoding="utf-8")
    assert 'src="js/cases.js"' in html and 'id="casebar"' in html and 'id="casesbtn"' in html
    assert html.index('src="js/qr.js"') < html.index('src="js/cases.js"') < html.index('src="js/app.js"')
    assert '"qr.js"' in (ROOT / "scripts/make_artifact.py").read_text()


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_cases_that_need_the_modis_scenes_wait_for_them():
    modis = [f"{r}-modis-{v}" for r in ("mn", "ub", "gobi", "khovsgol") for v in ("lst-day", "lst-night", "ndvi", "snowdays")]
    # the index without the MODIS scenes, whether or not they have been built
    scenes = [s["id"] for s in read_payload(ROOT / "web/data/index.js")["scenes"] if s["id"] not in modis] + ["fire-risk", "dust-risk"]
    places = [p["en"] for p in read_payload(ROOT / "web/data/places.js")["places"]]
    out = _node(f"""
      require('./web/js/cases.js'); const C = globalThis.TDCases;
      const all = C.list(), now = C.list({json.dumps(scenes)}), later = C.list({json.dumps(scenes + modis)});
      console.log(JSON.stringify({{all: all.map((c) => c.id), now: now.map((c) => c.id), later: later.map((c) => c.id),
        needs: Object.fromEntries(all.filter((c) => c.requires).map((c) => [c.id, c.requires])),
        problems: C.check({json.dumps(scenes + modis)}, {json.dumps(places)}),
        broken: C.check({json.dumps(scenes)}, {json.dumps(places)}).length}}));""")
    r = json.loads(out)
    assert set(r["needs"]) == {"ub-surface", "gobi-mines-1km", "khovsgol-snow", "skin-vs-air"}
    assert all(set(v) <= set(modis) for v in r["needs"].values())
    assert r["now"] == [c for c in r["all"] if c not in r["needs"]] and r["later"] == r["all"]   # order kept, nothing else hidden
    assert r["problems"] == [] and r["broken"] == 0                                              # valid with and without the scenes
