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
