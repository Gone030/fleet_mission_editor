#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

APP_NAME="FleetMissionEditor"

select_python() {
  if [ -n "${PYTHON:-}" ]; then
    echo "$PYTHON"
    return
  fi
  for candidate in /opt/homebrew/bin/python3 /usr/bin/python3 python3; do
    if command -v "$candidate" >/dev/null 2>&1; then
      if "$candidate" - <<'PY' >/dev/null 2>&1
import sysconfig
raise SystemExit(0 if sysconfig.get_config_var("PYTHONFRAMEWORK") else 1)
PY
      then
        command -v "$candidate"
        return
      fi
    fi
  done
  command -v python3
}

if [ -n "${PYTHON:-}" ]; then
  PYTHON_BIN="$PYTHON"
else
  BASE_PYTHON="$(select_python)"
  if [ -x ".venv/bin/python" ]; then
    if ! ".venv/bin/python" - <<'PY' >/dev/null 2>&1
import sysconfig
raise SystemExit(0 if sysconfig.get_config_var("PYTHONFRAMEWORK") else 1)
PY
    then
      echo "Existing .venv is not suitable for macOS app build. Recreating .venv..."
      rm -rf .venv
    fi
  fi
  if [ ! -x ".venv/bin/python" ]; then
    echo "Creating .venv with $BASE_PYTHON..."
    "$BASE_PYTHON" -m venv .venv
  fi
  PYTHON_BIN="$PWD/.venv/bin/python"
fi
echo "Using Python: $PYTHON_BIN"
export PYINSTALLER_CONFIG_DIR="$PWD/.pyinstaller"

"$PYTHON_BIN" -m pip install -r backend/requirements.txt

find . \
  \( -name "__pycache__" -o -name "*.pyc" -o -name ".DS_Store" \) \
  -prune -exec rm -rf {} +

"$PYTHON_BIN" -m PyInstaller \
  --noconfirm \
  --clean \
  --windowed \
  --noconsole \
  --name "$APP_NAME" \
  --hidden-import backend.server \
  --add-data "index.html:." \
  --add-data "src:src" \
  --add-data "backend:backend" \
  desktop/launcher.py

echo "Built dist/${APP_NAME}.app"
