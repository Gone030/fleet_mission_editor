# Fleet Mission Editor Desktop

Fleet Mission Editor는 기존 `index.html` 직접 실행 방식과 별도로 `pywebview + PyInstaller` 기반 로컬 데스크톱 앱으로 실행할 수 있다.

## 개발 실행

```bash
cd "/path/to/Fleet Mission Editor"
python -m pip install -r backend/requirements.txt
python desktop/launcher.py
```

실행 시 Python backend가 `http://127.0.0.1:8000/`에서 시작되고, pywebview 창이 같은 주소를 연다.

기존 개발 방식도 유지된다.

```bash
cd "/path/to/Fleet Mission Editor"
python -m uvicorn backend.server:app --host 127.0.0.1 --port 8000
```

또는 `index.html`을 직접 열어 UI를 확인할 수 있다. 단, backend API가 필요한 기능은 backend가 실행 중이어야 한다.

## 배포 실행

배포 실행 경로에서는 사용자가 `uvicorn`을 직접 실행하지 않는다.

- macOS: `dist/FleetMissionEditor.app` 더블클릭
- Windows: `FleetMissionEditor.exe` 더블클릭

앱 실행 시 backend는 앱 내부에서 자동 시작되고, UI는 외부 브라우저가 아니라 pywebview 앱 창에 표시된다.

PyInstaller 빌드는 `--windowed --noconsole` 옵션을 사용하므로 일반 사용자 실행 시 터미널/콘솔 창이 표시되지 않아야 한다.

앱 종료 시 launcher가 backend 종료 신호를 보내고 backend thread를 함께 정리한다.

## 빌드 원칙

PyInstaller는 OS 간 cross-build를 전제로 하지 않는다.

- macOS 배포본은 macOS에서 빌드한다.
- Windows 배포본은 Windows에서 빌드한다.
- 공통 launcher는 `desktop/launcher.py` 하나만 사용한다.
- 리소스 경로는 `pathlib.Path`와 `sys._MEIPASS` 기반으로 처리한다.

## macOS 앱 빌드

터미널을 직접 열지 않으려면 Finder에서 아래 파일을 더블클릭한다.

```text
desktop/macos/Build Fleet Mission Editor.command
```

터미널에서 직접 실행할 수도 있다.

```bash
cd "/path/to/Fleet Mission Editor"
chmod +x desktop/macos/build_desktop_mac.sh
./desktop/macos/build_desktop_mac.sh
```

`desktop/macos/build_desktop_mac.sh`는 `backend/requirements.txt` 의존성 설치 후 빌드한다.

빌드 결과:

```text
dist/FleetMissionEditor.app
```

`FleetMissionEditor.app`을 더블클릭하면 backend와 UI가 함께 실행된다.

## Windows 앱 빌드

터미널을 직접 열지 않으려면 Explorer에서 아래 파일을 더블클릭한다.

```text
desktop\windows\Build Fleet Mission Editor.bat
```

PowerShell에서 직접 실행할 수도 있다.

```powershell
Set-Location "C:\path\to\Fleet Mission Editor"
powershell -ExecutionPolicy Bypass -File .\desktop\windows\build_desktop_windows.ps1
```

`desktop\windows\build_desktop_windows.ps1`는 `backend\requirements.txt` 의존성 설치 후 빌드한다.

빌드 결과는 PyInstaller 설정과 환경에 따라 아래 중 하나다.

```text
dist/FleetMissionEditor/FleetMissionEditor.exe
dist/FleetMissionEditor.exe
```

`FleetMissionEditor.exe`를 더블클릭하면 backend와 UI가 함께 실행된다.

## 포함 파일

빌드에는 다음 리소스가 포함된다.

- `index.html`
- `src/`
- `src/vendor/leaflet/` (오프라인에서도 UI와 기체 연결을 초기화하기 위한 로컬 지도 라이브러리)
- `backend/`
- `desktop/launcher.py`

OS별 실행/빌드 스크립트는 아래에 둔다.

- macOS: `desktop/macos/`
- Windows: `desktop/windows/`

`__pycache__`, `.pyc`, `.DS_Store`는 빌드 전 정리한다.

## 검증 명령

macOS:

```bash
cd "/path/to/Fleet Mission Editor"
PYTHONDONTWRITEBYTECODE=1 python3 -m py_compile backend/server.py
PYTHONDONTWRITEBYTECODE=1 python3 -m py_compile desktop/launcher.py
node --check src/app.js
bash desktop/macos/build_desktop_mac.sh
```

Windows:

```powershell
Set-Location "C:\path\to\Fleet Mission Editor"
python -m py_compile backend/server.py
python -m py_compile desktop/launcher.py
node --check src/app.js
powershell -ExecutionPolicy Bypass -File .\desktop\windows\build_desktop_windows.ps1
```

## 데이터 저장 위치

데스크톱 앱 실행 시 vehicle 설정 데이터는 앱 번들 내부가 아니라 사용자 데이터 경로에 저장된다.

- macOS: `~/Library/Application Support/FleetMissionEditor/backend/data`
- Windows: `%APPDATA%/FleetMissionEditor/backend/data`
- Linux: `~/.local/share/FleetMissionEditor/backend/data`

## 로그 위치

backend 시작 실패, 포트 충돌, resource path 오류 등은 터미널 로그에 의존하지 않고 launcher 로그 파일에 남긴다.

- macOS: `~/Library/Logs/FleetMissionEditor/launcher.log`
- Windows: `%LOCALAPPDATA%/FleetMissionEditor/logs/launcher.log`
- Linux: `~/.local/state/FleetMissionEditor/logs/launcher.log`

backend 시작 실패 시 pywebview 오류 창에 실패 원인과 로그 파일 경로가 표시된다.

## 안전 주의

Mission Start는 실제 FC에 `AUTO.MISSION`, `Arm`, `Mission Start` 명령을 전송할 수 있다.

실기체가 움직일 수 있으므로 야외 테스트 준비가 완료되기 전에는 Mission Start를 실행하지 말 것.
# 지도 자동 캐시 (2026-10-02)

지도 화면에서 실제로 요청한 OSM 타일을 Backend가 디스크에 자동 저장합니다.
저장된 지역과 확대 수준은 인터넷 연결 없이도 다시 사용할 수 있습니다.
타일 다운로드는 기체 명령 처리와 별도 스레드에서 수행합니다.
지도 데이터가 없더라도 기체 연결, 트리거, LAND/DISARM 경로는 변경하지 않습니다.

- Windows EXE: `%APPDATA%\FleetMissionEditor\backend\data\map_cache\osm`
- macOS 앱: `~/Library/Application Support/FleetMissionEditor/backend/data/map_cache/osm`
- 소스 Backend: `backend/data/map_cache/osm` (또는 `FLEET_MISSION_EDITOR_DATA_DIR` 아래)

EXE 밖의 데이터 폴더를 사용하므로 재실행·재빌드 후에도 캐시가 유지됩니다.
캐시는 약 512 MiB 한도이며 초과 시 오래 저장된 타일부터 정리합니다.
제공자의 HTTP 캐시 유효기간을 따르고, 해석할 수 없을 때는 7일을 적용합니다.
유효기간이 지난 타일은 갱신을 시도하되 네트워크 실패 시 기존 이미지를 표시합니다.
미저장 지역이나 확대 수준은 오프라인에서 비어 있을 수 있으며 안내 배너가 표시됩니다.
19레벨보다 확대하면 저장된 19레벨 이미지를 확대 표시합니다.

이번 변경은 자동 캐시만 포함합니다. 항공사진 제공자 변경과 지역 전체 사전
다운로드는 포함하지 않습니다. OSM 공개 타일 서버의 영역 일괄 다운로드는 하지 않습니다.

확인 절차: 인터넷이 있는 상태에서 시험 지역을 필요한 확대 수준으로 조회한 후,
인터넷만 끊고 같은 지역을 이동·확대하거나 앱을 재실행합니다. Backend 자체는 켜 두어야 합니다.
와이파이를 끄면 기체 연결도 끊길 수 있으므로 이 검사는 비행하지 않는 상태에서 진행합니다.
