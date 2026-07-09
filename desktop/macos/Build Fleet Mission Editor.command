#!/bin/bash
set -u

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$PROJECT_ROOT" || exit 1

echo "Fleet Mission Editor Desktop Build"
echo "Project root: $PROJECT_ROOT"
echo

if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: python3 was not found."
  echo "Install Python 3, then run this command file again."
  echo
  read -r -p "Press Return to close this window..."
  exit 1
fi

select_python() {
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

BASE_PYTHON="$(select_python)"
echo "Using Python: $BASE_PYTHON"

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

if [ ! -d ".venv" ]; then
  echo "Creating .venv..."
  "$BASE_PYTHON" -m venv .venv
  if [ $? -ne 0 ]; then
    echo "ERROR: failed to create .venv."
    echo
    read -r -p "Press Return to close this window..."
    exit 1
  fi
fi

source ".venv/bin/activate"

echo "Installing build requirements and building app..."
PYTHON="$PROJECT_ROOT/.venv/bin/python" bash "$PROJECT_ROOT/desktop/macos/build_desktop_mac.sh"
BUILD_STATUS=$?

echo
if [ $BUILD_STATUS -eq 0 ]; then
  echo "Build complete:"
  echo "$PROJECT_ROOT/dist/FleetMissionEditor.app"
  echo
  read -r -p "Press Return to open build folder..."
  open "$PROJECT_ROOT/dist"
else
  echo "Build failed with status $BUILD_STATUS."
  echo
  read -r -p "Press Return to close this window..."
fi

exit $BUILD_STATUS
