
# Fleet Mission Editor

Fleet Mission Editor는 여러 대의 드론 mission을 하나의 UI에서 작성하고 관리하기 위한 브라우저 기반 mission editor이다.

현재 목표는 QGroundControl에서 사용할 수 있는 `.plan` export와 Fleet Mission Package 관리를 유지하면서,
Local Runtime Backend를 통해 companion runtime 상태 확인, live GPS marker 표시, emergency action 전송까지 연결하는 것이다.

## 프로젝트 목표

이 프로젝트는 특정 구성에 고정되지 않는다.

예시 fleet 구성은 다음과 같다.

```text
Carrier-01
├─ Child-01
├─ Child-02
├─ Child-03
└─ Child-04
```

처음 실행 시 vehicle은 비어 있으며, Add Vehicle로 실제 기체 정보를 등록해서 사용한다.
아래 구조는 샘플일 뿐이며, 실제 운용에서는 UI에서 Carrier / Child vehicle을 직접 등록해서 사용한다.

## 현재 지원 기능

* 브라우저에서 직접 실행
* 빌드 과정 없음
* 기본 vehicle 없이 Add Vehicle부터 시작
* macOS `.command` / Windows `.bat` one-click 실행
* vehicle 목록 표시
* `parent_vehicle_id` 기반 Carrier-Child 계층 표시
* Carrier 접기/펼치기
* vehicle 선택
* vehicle 추가/삭제
* Role을 Carrier / Child 중 선택
* 선택된 vehicle의 name/role/SYSID/IP/UDP port/firmware profile 수정
* vehicle 설정을 backend JSON 파일에 저장하고 재시작 후 복원
* 선택된 vehicle별 waypoint 작성
* 지도 클릭으로 waypoint 생성
* waypoint 고도 입력
* 첫 waypoint 기본 고도 적용
* 다음 waypoint는 이전 waypoint 고도 상속
* waypoint 삭제
* Mission Package JSON export
* Mission Package JSON import
* 선택된 vehicle의 QGC `.plan` export
* Carrier waypoint를 RELEASE step으로 지정하고 target Child 선택
* QGC Plan 설정 편집
* mission local/backend validation
* 선택 vehicle의 FC mission upload 및 read-back 검증
* FC mission read-back 결과를 UI waypoint로 불러오기
* FC mission clear
* Carrier action plan upload
* Carrier Mission Start 확인 및 실행
* companion runtime state reset
* Local Runtime Backend health check 연결 패널
* backend 자동 health monitor
* Local Runtime Backend를 통한 companion UDP PING/PONG 연결 확인
* drone status 자동 polling
* Companion state와 FC state 분리 표시
* Carrier / Child trigger 상태 라벨 분리 표시
* companion GPS 기반 live drone marker 표시
* 선택 vehicle 위치로 지도 이동
* 전체 live drone marker bounds 맞춤
* Emergency Action 수동 실행
  * `LAND`
  * `DISARM`
  * `FORCE_DISARM`
* 간단한 local sanity check
* Carrier-Child companion link test
* Carrier manual release + trigger 실행

## 아직 지원하지 않는 기능

* 여러 vehicle mission 동시 upload
* QGC `.plan` import
* WebSocket 기반 realtime streaming
* backend의 FC 직접 MAVLink 연결

## 실행 방법

권장 실행 방식은 아래 one-click launcher를 사용하는 것이다.

launcher는 backend를 켜고 브라우저에서 `http://127.0.0.1:8000`을 자동으로 연다.

`index.html` 직접 열기도 가능하지만, backend JSON 저장, runtime status, live GPS marker, Emergency Action은 backend가 켜져 있어야 동작한다.

macOS one-click run:

```text
chmod +x "desktop/macos/Start Fleet Mission Editor.command"
```

그 뒤 Finder에서 `desktop/macos/Start Fleet Mission Editor.command`를 더블클릭한다.
backend가 켜지고 브라우저에서 `http://127.0.0.1:8000`이 자동으로 열린다.

Windows one-click run:

```text
desktop\windows\Start Fleet Mission Editor.bat
```

파일 탐색기에서 `desktop\windows\Start Fleet Mission Editor.bat`를 더블클릭한다.
`.venv`가 없으면 자동으로 만들고, backend requirements를 설치한 뒤
브라우저에서 `http://127.0.0.1:8000`을 자동으로 연다.

Windows 선행 조건:

```text
Python 3.9 이상 권장
```

설치 확인:

```text
py -3 --version
```

패키지 설치 오류가 나면 다음을 먼저 실행한 뒤 `.bat`를 다시 실행한다.

```text
py -3 -m pip install --upgrade pip
```

Local Runtime Backend를 별도 터미널에서 직접 실행하려면 다음 명령을 사용한다.

```text
python -m pip install -r backend/requirements.txt
python -m uvicorn backend.server:app --host 127.0.0.1 --port 8000
```

브라우저 UI의 Runtime Connection 패널은 `/api/health`로 backend 상태를 확인한다.
Connect Drones는 현재 vehicle 목록을 `/api/drones/connect`로 보내고, backend가 각 `ip:udp_port`로 UDP PING JSON을 보낸 뒤 PONG 응답을 기다린다.
backend가 ONLINE이고 vehicle이 1개 이상 있으면 UI는 drone status를 자동 polling한다.
UI가 HTTP(S)에서 로드되면 현재 origin을 backend URL로 사용하고, `file://`로 직접 열리면 `http://127.0.0.1:8000`을 사용한다.
backend health check는 UI 로드 후 자동 실행되며 3초마다 반복된다.

## Runtime Backend API

주요 API는 다음과 같다.

```text
GET  /api/health
GET  /api/runtime/status
GET  /api/vehicles
PUT  /api/vehicles
POST /api/drones/connect
GET  /api/drones/status
POST /api/drones/{vehicle_id}/emergency
POST /api/drones/{vehicle_id}/manual-release-trigger
POST /api/drone/runtime-reset
POST /api/drone/mission-clear
POST /api/drone/mission-start
POST /api/drone/action-plan-upload
POST /api/companion/link-test
POST /api/missions/validate
POST /api/missions/upload-dry-run
POST /api/missions/upload
POST /api/missions/download
POST /api/missions/upload-and-verify
```

`/api/runtime/status`는 현재 legacy 진단 응답으로 `mock`/`not_implemented` 값을 반환하며 UI에서는 사용하지 않는다.
실제 연결 상태는 `/api/health`와 `/api/drones/status`를 기준으로 표시한다.

`/api/vehicles`는 vehicle config만 저장한다.
runtime status, GPS position, emergency result, trigger state는 저장하지 않는다.

vehicle config 저장 위치:

```text
backend/data/vehicles.json
```

저장 대상 필드:

```js
{
  vehicle_id,
  name,
  role,              // "carrier" | "child"
  sysid,
  ip,
  udp_port,
  parent_vehicle_id,
  sort_order,
  color,
  collapsed,
  firmware_profile
}
```

## Runtime 상태 표시

Drone card는 runtime 상태를 mission package와 분리해서 표시한다.

Carrier trigger 라벨:

```text
Release Input
RC Latched
Carrier Trigger
Child Delivery Result
Reason
Seq
Target
```

Child trigger 라벨:

```text
Trigger Receive
FC Forward Result
Reason
Seq
```

GPS marker는 companion status의 `position`과 `gps.valid`를 사용한다.
`gps.valid === true`이면 LIVE, position은 있으나 `gps.valid === false`이면 STALE로 표시한다.

Emergency Action은 사용자가 `Execute`를 누른 경우에만 전송한다.
connection lost, GPS invalid, trigger 실패 등으로 자동 실행하지 않는다.

## 개발 원칙

프런트엔드는 `npm`, `React`, `Vite`, bundler 없이 정적 HTML/CSS/JavaScript 구조를 유지한다.
데스크톱 배포본은 `pywebview + PyInstaller`로 빌드한다.

아래 구조를 유지한다.

```text
fleet-mission-editor/
├─ index.html
├─ desktop/
│  ├─ launcher.py
│  ├─ macos/
│  │  ├─ Start Fleet Mission Editor.command
│  │  ├─ Build Fleet Mission Editor.command
│  │  └─ build_desktop_mac.sh
│  └─ windows/
│     ├─ Start Fleet Mission Editor.bat
│     ├─ Build Fleet Mission Editor.bat
│     └─ build_desktop_windows.ps1
├─ backend/
│  ├─ server.py
│  ├─ requirements.txt
│  └─ data/
│     └─ vehicles.json
├─ src/
│  ├─ app.js
│  └─ style.css
└─ README.md
```

## 기본 사용 흐름

```text
1. one-click launcher 실행
2. Add Vehicle로 Carrier / Child 등록
3. vehicle IP / UDP port / firmware profile 설정
4. Runtime Connection에서 backend ONLINE 확인
5. Connect Drones 또는 자동 polling으로 companion 상태 확인
6. 지도 클릭으로 waypoint 생성
7. Carrier release 지점은 waypoint 목록에서 RELEASE로 변경하고 target Child 선택
8. 미션 검증 후 FC 미션 업로드 및 read-back 검증
9. Carrier는 액션 플랜 업로드 후 Mission Start 준비 상태 확인
10. 필요하면 선택 vehicle의 `.plan`을 export하여 QGroundControl에서 확인
11. runtime 상태, live GPS marker, emergency action은 backend UI에서 확인/실행
```

## 데이터 구조 요약

전체 mission package는 아래 구조를 따른다.

```js
{
  version: 1,
  vehicles: [],
  missions: [],
  qgcPlanSettings: {}
}
```

`vehicles`는 드론의 정체성, 연결 설정, 계층 정보를 가진다.

`missions`는 각 드론의 mission과 waypoint를 가진다.

Carrier → Child release/trigger 대상은 Carrier mission의 RELEASE waypoint `target_vehicle_id`에 저장된다.

`qgcPlanSettings`는 QGC `.plan` export에 필요한 설정을 가진다.

Fleet Mission Package export/import에는 runtime state가 포함되지 않는다.
runtime state는 UI 내부 `runtimeState`와 backend `/api/drones/status` 결과로만 관리한다.
