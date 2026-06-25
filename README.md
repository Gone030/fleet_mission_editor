
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
* relationship editor
* QGC Plan 설정 편집
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

## 아직 지원하지 않는 기능

* UI에서 FC mission upload 직접 실행
* FC mission read-back 검증
* 여러 vehicle mission 동시 upload
* QGC `.plan` import
* WebSocket 기반 realtime streaming

## 실행 방법

권장 실행 방식은 아래 one-click launcher를 사용하는 것이다.

launcher는 backend를 켜고 브라우저에서 `http://127.0.0.1:8000`을 자동으로 연다.

`index.html` 직접 열기도 가능하지만, backend JSON 저장, runtime status, live GPS marker, Emergency Action은 backend가 켜져 있어야 동작한다.

macOS one-click run:

```text
chmod +x "Start Fleet Mission Editor.command"
```

그 뒤 Finder에서 `Start Fleet Mission Editor.command`를 더블클릭한다.
backend가 켜지고 브라우저에서 `http://127.0.0.1:8000`이 자동으로 열린다.

Windows one-click run:

```text
Start Fleet Mission Editor.bat
```

파일 탐색기에서 `Start Fleet Mission Editor.bat`를 더블클릭한다.
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
```

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

`npm`, `React`, `Vite`, bundler, build tool을 도입하지 않는다.

아래 구조를 유지한다.

```text
fleet-mission-editor/
├─ index.html
├─ Start Fleet Mission Editor.command
├─ Start Fleet Mission Editor.bat
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
7. relationship 필요 시 Relationship Editor에서 추가
8. 선택 vehicle의 `.plan` export
9. QGroundControl에서 `.plan` 열기
10. runtime 상태, live GPS marker, emergency action은 backend UI에서 확인/실행
```

## 데이터 구조 요약

전체 mission package는 아래 구조를 따른다.

```js
{
  version: 1,
  vehicles: [],
  missions: [],
  relationships: [],
  qgcPlanSettings: {}
}
```

`vehicles`는 드론의 정체성, 연결 설정, 계층 정보를 가진다.

`missions`는 각 드론의 mission과 waypoint를 가진다.

`relationships`는 특정 vehicle의 waypoint 도착 시 다른 vehicle에 action을 걸기 위한 관계 정보를 가진다.

`qgcPlanSettings`는 QGC `.plan` export에 필요한 설정을 가진다.

Fleet Mission Package export/import에는 runtime state가 포함되지 않는다.
runtime state는 UI 내부 `runtimeState`와 backend `/api/drones/status` 결과로만 관리한다.
