"""The QR encoder (web/js/qr.js) produces symbols an independent decoder reads back, for every version and mask."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
NODE = shutil.which("node")
cv2 = pytest.importorskip("cv2")

TEXTS = ["Hi", "0123456789abcdefg", "https://buyja047.github.io/earth_trending/#case/antarctic-ice/2",
         "A" * 106, "B" * 30, "C" * 50, "Монгол ✓", "https://buyja047.github.io/earth_trending/#case/when-will-we-know/4"]


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_every_version_and_mask_decodes(tmp_path):
    script = """
      const Q = require('./web/js/qr.js'), fs = require('fs'), texts = JSON.parse(process.argv[1]), out = process.argv[2];
      texts.forEach((t, i) => { for (let m = 0; m < 8; m++) {
        const q = Q.make(t, m), sc = 8, mg = 4, n = (q.size + 2 * mg) * sc, rows = [];
        for (let y = 0; y < n; y++) { const r = []; for (let x = 0; x < n; x++) {
          const qx = Math.floor(x / sc) - mg, qy = Math.floor(y / sc) - mg;
          r.push(qx >= 0 && qy >= 0 && qx < q.size && qy < q.size && q.get(qx, qy) ? 0 : 255); } rows.push(r.join(' ')); }
        fs.writeFileSync(`${out}/qr_${i}_${m}.pgm`, `P2\\n${n} ${n}\\n255\\n` + rows.join('\\n') + '\\n'); } });
      console.log(JSON.stringify(texts.map((t) => Q.make(t).version)));"""
    versions = json.loads(subprocess.run([NODE, "-e", script, json.dumps(TEXTS), str(tmp_path)], cwd=ROOT, capture_output=True, text=True, check=True).stdout)
    assert versions == [1, 1, 4, 5, 2, 3, 1, 4]
    det = cv2.QRCodeDetector()
    for i, text in enumerate(TEXTS):
        for m in range(8):
            img = cv2.imread(str(tmp_path / f"qr_{i}_{m}.pgm"), cv2.IMREAD_GRAYSCALE)
            data, _, _ = det.detectAndDecode(img)
            assert data == text, (text[:30], m, data[:30])


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_too_long_is_refused_and_svg_is_well_formed():
    out = subprocess.run([NODE, "-e", """
      const Q = require('./web/js/qr.js');
      let err = null; try { Q.make('x'.repeat(107)); } catch (e) { err = e.message; }
      const svg = Q.svg('https://example.org/#case/x/1', 3, 2);
      console.log(JSON.stringify({ err, ok: svg.startsWith('<svg') && svg.includes('<path') && svg.endsWith('</svg>') }));"""],
                         cwd=ROOT, capture_output=True, text=True, check=True).stdout
    r = json.loads(out)
    assert "too long" in r["err"] and r["ok"]
