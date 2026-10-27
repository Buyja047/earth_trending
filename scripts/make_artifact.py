"""Inline web/index.html's CSS and JS into one page fragment for publishing.

The fragment omits <!doctype>/<html>/<head>/<body> (the host adds them) and
keeps loading data/*.js relatively, so publish web/data/* alongside it.
Usage: python scripts/make_artifact.py OUT.html
"""

import re
import sys
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent / "web"


def main(out: str) -> None:
    html = (WEB / "index.html").read_text()
    head = html.split("<head>", 1)[1].split("</head>", 1)[0]
    title = re.search(r"<title>.*?</title>", head).group(0)
    metas = re.findall(r'<meta name="claude:[^>]+>', head)
    fonts = [m for m in re.findall(r"<link[^>]+>", head) if "fonts.g" in m]
    body = html.split("<!--BODY-->", 1)[1].split("<!--/BODY-->", 1)[0]
    css = (WEB / "css" / "app.css").read_text()
    js = "\n".join((WEB / "js" / f).read_text()
                   for f in ("stats.js", "i18n.js", "surface.js", "basemap.js", "vendor/fzstd.js", "zarr.js", "live.js",
                             "app.js"))
    page = "\n".join([title, *metas, *fonts, f"<style>\n{css}</style>", body,
                      f"<script>\n{js}</script>"])
    Path(out).write_text(page)
    print(f"wrote {out} ({len(page) / 1024:.0f} KB)")


if __name__ == "__main__":
    main(sys.argv[1])
