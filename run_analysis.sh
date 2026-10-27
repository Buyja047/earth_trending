#!/usr/bin/env bash
# Downloads NASA POWER and NSIDC data and rebuilds web/data (about 20-30 minutes, internet needed).
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  echo "Run: bash install_analysis.sh   first. / Эхлээд bash install_analysis.sh-ыг ажиллуулна уу."
  exit 1
fi
.venv/bin/python -m trend_detective build "$@"
echo "Open TrendDetective.html to see the results. / Үр дүнг харахын тулд TrendDetective.html-ийг нээнэ үү."
