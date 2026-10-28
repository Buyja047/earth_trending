"""Data files the viewer reads: ``TD_DATA("key", {...json...});``

One format serves both ways of opening the viewer. Opened from disk
(file://, e.g. after unzipping the repository) the page loads each file with
a <script> tag, which browsers allow; served over HTTP it fetches the text and
parses the JSON between the first comma and the last parenthesis.
"""

from __future__ import annotations

import json
from pathlib import Path


def write_payload(path: Path, key: str, obj) -> None:
    body = json.dumps(obj, separators=(",", ":"), allow_nan=False)
    Path(path).write_text(f"TD_DATA({json.dumps(key)},{body});\n", encoding="utf-8")


def read_payload(path: Path):
    text = Path(path).read_text(encoding="utf-8")
    return json.loads(text[text.index(",") + 1 : text.rindex(")")])
