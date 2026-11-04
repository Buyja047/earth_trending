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


def test_interface_strings_exist_in_both_languages():
    src = (ROOT / "web/js/i18n.js").read_text(encoding="utf-8")
    en, mn = src.split("const MN = {")
    for key in ["m_cases", "cases_btn", "cases_title", "cases_intro", "cases_step", "cases_next", "cases_prev", "cases_exit", "cases_evidence",
                "cases_what", "cases_where", "cases_howmuch", "cases_sig", "cases_when", "cases_caveats", "cases_link", "cases_nextcase",
                "cases_tag_global", "cases_tag_mongolia", "cases_tag_trap", "cases_tag_hazard", "cases_tag_method"]:
        assert f"{key}:" in en and f"{key}:" in mn, key


def test_single_file_build_includes_the_case_files():
    assert '"cases.js"' in (ROOT / "scripts/make_artifact.py").read_text()
    html = (ROOT / "web/index.html").read_text(encoding="utf-8")
    assert 'src="js/cases.js"' in html and 'id="casebar"' in html and 'id="casesbtn"' in html
    assert html.index('src="js/cases.js"') < html.index('src="js/app.js"')
