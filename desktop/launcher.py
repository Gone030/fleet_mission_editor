import os
import logging
import socket
import sys
import threading
import traceback
import time
from pathlib import Path
from urllib.request import urlopen

import uvicorn
import webview


APP_TITLE = "Fleet Mission Editor"
HOST = "127.0.0.1"
PORT = 8000
APP_URL = f"http://{HOST}:{PORT}/"


def get_log_dir():
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Logs" / "FleetMissionEditor"
    if sys.platform.startswith("win"):
        base = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA") or str(Path.home())
        return Path(base) / "FleetMissionEditor" / "logs"
    return Path.home() / ".local" / "state" / "FleetMissionEditor" / "logs"


def get_log_path():
    return get_log_dir() / "launcher.log"


def setup_logging():
    log_dir = get_log_dir()
    log_dir.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        filename=str(get_log_path()),
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )


def get_resource_root():
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS)
    return Path(__file__).resolve().parents[1]


def get_data_dir():
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "FleetMissionEditor" / "backend" / "data"
    if sys.platform.startswith("win"):
        base = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
        return Path(base) / "FleetMissionEditor" / "backend" / "data"
    return Path.home() / ".local" / "share" / "FleetMissionEditor" / "backend" / "data"


def ensure_import_paths(resource_root):
    resource_path = str(resource_root)
    if resource_path not in sys.path:
        sys.path.insert(0, resource_path)


def wait_for_backend(timeout_sec=15.0):
    deadline = time.monotonic() + timeout_sec
    last_error = None
    while time.monotonic() < deadline:
        try:
            with urlopen(f"{APP_URL}api/health", timeout=0.5) as response:
                if response.status == 200:
                    return
        except Exception as error:
            last_error = error
            time.sleep(0.15)
    raise RuntimeError(f"Backend did not start on {APP_URL}: {last_error}")


def assert_port_available():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        if sock.connect_ex((HOST, PORT)) == 0:
            raise RuntimeError(f"Port {PORT} is already in use.")


def make_error_html(message):
    escaped = (
        str(message)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )
    log_path = str(get_log_path())
    escaped_log_path = (
        log_path
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )
    return f"""
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body {{
            margin: 0;
            padding: 24px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            background: #0f172a;
            color: #e5e7eb;
          }}
          h1 {{ color: #f87171; font-size: 20px; }}
          pre {{
            white-space: pre-wrap;
            padding: 12px;
            border: 1px solid #374151;
            border-radius: 8px;
            background: #111827;
          }}
          .muted {{ color: #9ca3af; }}
        </style>
      </head>
      <body>
        <h1>Fleet Mission Editor 시작 실패</h1>
        <p>Backend를 시작하지 못했습니다.</p>
        <pre>{escaped}</pre>
        <p class="muted">로그 파일: {escaped_log_path}</p>
      </body>
    </html>
    """


def show_startup_error(error):
    logging.exception("Fleet Mission Editor startup failed")
    webview.create_window(
        f"{APP_TITLE} - Startup Error",
        html=make_error_html(error),
        width=720,
        height=420,
        min_size=(560, 320),
    )
    webview.start()


def run_app():
    resource_root = get_resource_root()
    ensure_import_paths(resource_root)
    logging.info("Resource root: %s", resource_root)

    data_dir = get_data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("FLEET_MISSION_EDITOR_DATA_DIR", str(data_dir))
    logging.info("Data dir: %s", data_dir)

    assert_port_available()

    from backend.server import app

    config = uvicorn.Config(
        app,
        host=HOST,
        port=PORT,
        log_level="info",
        access_log=False,
    )
    server = uvicorn.Server(config)
    server_thread = threading.Thread(target=server.run, name="fleet-runtime-backend", daemon=True)
    server_thread.start()
    logging.info("Backend thread started on %s", APP_URL)

    try:
        wait_for_backend()
        logging.info("Backend ready")
        webview.create_window(APP_TITLE, APP_URL, width=1440, height=920, min_size=(1100, 720))
        webview.start()
    finally:
        logging.info("Stopping backend")
        server.should_exit = True
        server_thread.join(timeout=5)
        logging.info("Backend stopped")


def main():
    setup_logging()
    try:
        run_app()
    except Exception as error:
        logging.error("Startup traceback:\n%s", traceback.format_exc())
        show_startup_error(error)


if __name__ == "__main__":
    main()
