#!/usr/bin/env bash
# Creates a private Python environment in .venv and installs the analysis packages.
set -euo pipefail
cd "$(dirname "$0")"
PY="$(command -v python3 || command -v python || true)"
if [ -z "$PY" ]; then
  echo "Python 3.10 or newer was not found. Install it from https://www.python.org/downloads/ and run this script again."
  echo "Python 3.10+ олдсонгүй. https://www.python.org/downloads/ -оос суулгаад энэ скриптийг дахин ажиллуулна уу."
  exit 1
fi
"$PY" -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements.txt
echo
echo "Done. Run: bash run_analysis.sh   (rebuilds web/data)"
echo "Дууслаа. web/data-г шинээр тооцохын тулд: bash run_analysis.sh"
