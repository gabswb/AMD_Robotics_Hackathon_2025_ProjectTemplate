#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

MODE="${1:-server}"

PYTHON="${PYTHON:-python3}"
if ! command -v "$PYTHON" >/dev/null 2>&1; then
  echo "$PYTHON not found"
  exit 1
fi

# Demo wrapper only: assumes dependencies are already installed.
# If you see ModuleNotFoundError, run:
#   python3 -m pip install -r host/requirements.txt

case "$MODE" in
  server)
    exec "$PYTHON" -u host/robot_vision_beacon_server.py
    ;;
  interactive)
    exec "$PYTHON" -u host/interactive_demo.py
    ;;
  barcode-map)
    exec "$PYTHON" -u host/barcode_color_map_demo.py
    ;;
  *)
    echo "Usage: $0 {server|interactive|barcode-map}"
    exit 2
    ;;
esac
