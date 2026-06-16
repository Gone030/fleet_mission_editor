#!/bin/bash
set -u

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_ROOT" || exit 1

echo "Fleet Mission Editor"
echo "Project root: $PROJECT_ROOT"
echo

if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: python3 was not found."
  echo "Install Python 3, then run this command file again."
  echo
  read -r -p "Press Return to close this window..."
  exit 1
fi

if [ ! -d ".venv" ]; then
  echo "Creating .venv..."
  python3 -m venv .venv
  if [ $? -ne 0 ]; then
    echo "ERROR: failed to create .venv."
    echo
    read -r -p "Press Return to close this window..."
    exit 1
  fi
fi

source ".venv/bin/activate"

echo "Installing backend requirements..."
python -m pip install -r backend/requirements.txt
if [ $? -ne 0 ]; then
  echo "ERROR: failed to install backend requirements."
  echo
  read -r -p "Press Return to close this window..."
  exit 1
fi

URL="http://127.0.0.1:8000"
echo
echo "Opening $URL ..."
(sleep 1; open "$URL" >/dev/null 2>&1) &

echo "Starting FastAPI backend. Keep this Terminal window open."
echo "Stop server: Control-C"
echo
python -m uvicorn backend.server:app --host 127.0.0.1 --port 8000
SERVER_STATUS=$?

echo
echo "Backend stopped with status $SERVER_STATUS."
read -r -p "Press Return to close this window..."
