
# Fleet Mission Editor

Fleet Mission Editor는 여러 대의 드론 미션을 하나의 UI에서 작성하고 관리하기 위한 브라우저 기반 미션 편집기다.

현재 목표는 QGroundControl에서 사용할 수 있는 `.plan` 내보내기와 미션 패키지 관리를 유지하면서,
로컬 런타임 백엔드를 통해 컴패니언 런타임 상태 확인, 실시간 GPS 위치 표시, 긴급 명령 전송까지 연결하는 것이다.

## 프로젝트 목표

이 프로젝트는 특정 구성에 고정되지 않는다.

예시 기체 편대 구성은 다음과 같다.

```text
Carrier-01
├─ Child-01
├─ Child-02
├─ Child-03
└─ Child-04
```

처음 실행 시 기체는 비어 있으며, Add Vehicle(기체 추가)로 실제 기체 정보를 등록해서 사용한다.
위 구성은 샘플일 뿐이며, 실제 운용에서는 UI에서 모드론 / 자드론 기체를 직접 등록해서 사용한다.

## 현재 지원 기능

* 브라우저에서 직접 실행
* 빌드 과정 없음
* 기본 기체 없이 Add Vehicle(기체 추가)부터 시작
* macOS `.command` / Windows `.bat` 원클릭 실행
* 기체 목록 표시
* `parent_vehicle_id` 기반 모드론-자드론 계층 표시
* 모드론 접기/펼치기
* 기체 선택
* 기체 추가/삭제
* 역할을 모드론 / 자드론 중 선택
* 선택된 기체의 이름/역할/SYSID/IP/UDP 포트/펌웨어 프로필 수정
* 기체 설정을 백엔드 JSON 파일에 저장하고 재시작 후 복원
* 선택된 기체별 경유점 작성
* 지도 클릭으로 경유점 생성
* 경유점 고도 입력
* 첫 경유점 기본 고도 적용
* 다음 경유점은 이전 경유점 고도 상속
* 경유점 삭제
* 미션 패키지 JSON 내보내기
* 미션 패키지 JSON 가져오기
* 선택된 기체의 QGC `.plan` 내보내기
* 모드론 경유점을 RELEASE(릴리즈) 단계로 지정하고 대상 자드론 선택
* QGC 비행 계획 설정 편집
* 미션의 로컬·백엔드 검증
* 선택 기체의 FC 미션 업로드 및 다시 읽기 검증
* FC 미션 다시 읽기 결과를 UI 경유점으로 불러오기
* FC 미션 삭제
* 모드론 액션 플랜 업로드
* 모드론 미션 시작 확인 및 실행
* 컴패니언 런타임 상태 초기화
* 로컬 런타임 백엔드 상태 확인 연결 패널
* 백엔드 자동 상태 감시
* 로컬 런타임 백엔드를 통한 컴패니언 UDP PING/PONG 연결 확인
* 드론 상태 자동 주기 조회
* 컴패니언 상태와 FC 상태 분리 표시
* 모드론 / 자드론 트리거 상태 라벨 분리 표시
* 컴패니언 GPS 기반 실시간 기체 위치 표시
* 선택 기체 위치로 지도 이동
* 전체 실시간 기체 표시 영역 맞춤
* 긴급 명령 수동 실행
  * `LAND`
  * `DISARM`
  * `FORCE_DISARM`
* 간단한 로컬 점검
* 모드론·자드론 컴패니언 통신 시험
* 모드론 수동 릴리즈·트리거 실행
* 모드론 없이 선택한 자드론에 PREPARE → 모의 릴리즈 → 즉시 트리거 실행
  * 실제 릴리즈 액추에이터는 구동하지 않음
  * 자드론 자세 텔레메트리의 롤·피치 허용각은 UI에서 ±2~10°로 조정 가능하며 기본값은 ±5°
  * 선택한 허용각은 브라우저에 저장되고 백엔드 최종검사에도 동일하게 적용
  * 자드론 FC의 `NAV_G_ARM_DLY` 이후 실제 아밍/BOOST가 발생할 수 있음
* 릴리즈·트리거 세션 요약과 GPS/기수 방향/EKF/NAV_GATE 진단 상시 표시

## 지도 타일 요청

인터넷 없이 시작해도 UI와 기체 연결 기능은 지도와 독립적으로 동작한다.
인터넷 재연결·화면 복귀·타이머에 따른 지도 자동 재다운로드는 하지 않는다.
실패한 타일은 오류 안내만 표시하며, 필요한 경우 사용자가 UI를 새로고침한다.
지도 이동·확대/축소 때 필요한 새 타일은 일반적인 방식으로 요청한다.
기존에 표시된 타일과 백엔드 디스크 캐시는 유지하며, 저장되지 않은 지역은 인터넷이 필요하다.
백엔드 타일 작업은 동시 2개로 제한하고, 타일 HTTP 응답 대기는 최대 2초로 제한한다.
느린 지도 요청으로 브라우저 연결을 모두 점유해 백엔드 상태 확인·기체 명령이 대기하지 않도록 한다.

회귀 테스트: `node --test src/map-tiles-no-auto-retry.test.cjs`, `.venv/bin/python -m unittest backend.test_map_cache`.

## 아직 지원하지 않는 기능

* 여러 기체 미션 동시 업로드
* QGC `.plan` 가져오기
* WebSocket 기반 실시간 전송
* 백엔드의 FC 직접 MAVLink 연결

## 실행 방법

권장 실행 방식은 아래 원클릭 실행기를 사용하는 것이다.

실행기는 백엔드를 켜고 브라우저에서 `http://127.0.0.1:8000`을 자동으로 연다.

`index.html` 직접 열기도 가능하지만, 백엔드 JSON 저장, 런타임 상태, 실시간 GPS 표시, 긴급 명령은 백엔드가 켜져 있어야 동작한다.

macOS 원클릭 실행:

```text
chmod +x "desktop/macos/Start Fleet Mission Editor.command"
```

그 뒤 Finder에서 `desktop/macos/Start Fleet Mission Editor.command`를 더블클릭한다.
백엔드가 켜지고 브라우저에서 `http://127.0.0.1:8000`이 자동으로 열린다.

Windows 원클릭 실행:

```text
desktop\windows\Start Fleet Mission Editor.bat
```

파일 탐색기에서 `desktop\windows\Start Fleet Mission Editor.bat`를 더블클릭한다.
`.venv`가 없으면 자동으로 만들고, 백엔드 의존성을 설치한 뒤
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

로컬 런타임 백엔드를 별도 터미널에서 직접 실행하려면 다음 명령을 사용한다.

```text
python -m pip install -r backend/requirements.txt
python -m uvicorn backend.server:app --host 127.0.0.1 --port 8000
```

브라우저 UI의 Runtime Connection(런타임 연결) 패널은 `/api/health`로 백엔드 상태를 확인한다.
Connect Drones(기체 연결)는 현재 기체 목록을 `/api/drones/connect`로 보내고, 백엔드가 각 `ip:udp_port`로 UDP PING JSON을 보낸 뒤 PONG 응답을 기다린다.
백엔드가 ONLINE이고 기체가 1개 이상 있으면 UI는 드론 상태를 자동 주기 조회한다.
UI가 HTTP(S)에서 로드되면 현재 페이지의 출처 주소를 백엔드 URL로 사용하고, `file://`로 직접 열리면 `http://127.0.0.1:8000`을 사용한다.
백엔드 상태 확인은 UI 로드 후 자동 실행되며 3초마다 반복된다.

## 런타임 백엔드 API

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
POST /api/drones/{vehicle_id}/simulated-release-trigger
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

`/api/runtime/status`는 현재 기존 진단 응답으로 `mock`/`not_implemented` 값을 반환하며 UI에서는 사용하지 않는다.
실제 연결 상태는 `/api/health`와 `/api/drones/status`를 기준으로 표시한다.

`/api/vehicles`는 기체 설정만 저장한다.
런타임 상태, GPS 위치, 긴급 명령 결과, 트리거 상태는 저장하지 않는다.

기체 설정 저장 위치:

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

## 런타임 상태 표시

기체 카드는 런타임 상태를 미션 패키지와 분리해서 표시한다.

모드론 트리거 라벨:

```text
Release Input: 릴리즈 입력
RC Latched: 조종기 입력 래치 상태
Carrier Trigger: 모드론 트리거
Child Delivery Result: 자드론 전달 결과
Reason: 사유
Seq: 요청 순번
Target: 대상
```

자드론 트리거 라벨:

```text
Trigger Receive: 트리거 수신
FC Forward Result: FC 전달 결과
Reason: 사유
Seq: 요청 순번
```

GPS 표시는 컴패니언 상태의 `position`과 `gps.valid`를 사용한다.
`gps.valid === true`이면 LIVE, 위치는 있으나 `gps.valid === false`이면 STALE로 표시한다.

긴급 명령은 사용자가 `Execute`를 누른 경우에만 전송한다.
연결 상실, GPS 무효, 트리거 실패 등으로 자동 실행하지 않는다.

## 개발 원칙

프런트엔드는 `npm`, `React`, `Vite`, 번들러 없이 정적 HTML/CSS/JavaScript 구조를 유지한다.
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
1. 원클릭 실행기 실행
2. Add Vehicle(기체 추가)로 모드론 / 자드론 등록
3. 기체 IP / UDP 포트 / 펌웨어 프로필 설정
4. Runtime Connection(런타임 연결)에서 백엔드 ONLINE 상태 확인
5. Connect Drones(기체 연결) 또는 자동 주기 조회로 컴패니언 상태 확인
6. 지도 클릭으로 경유점 생성
7. 모드론 릴리즈 지점을 경유점 목록에서 RELEASE로 변경하고 대상 자드론 선택
8. 미션 검증 후 FC 미션 업로드 및 다시 읽기 검증
9. 모드론 액션 플랜 업로드 후 Mission Start(미션 시작) 준비 상태 확인
10. 필요하면 선택 기체의 .plan을 내보내 QGroundControl에서 확인
11. 런타임 상태, 실시간 GPS 위치, 긴급 명령은 백엔드 UI에서 확인/실행
```

## 데이터 구조 요약

전체 미션 패키지는 아래 구조를 따른다.

```js
{
  version: 1,
  vehicles: [],
  missions: [],
  qgcPlanSettings: {}
}
```

`vehicles`는 드론의 정체성, 연결 설정, 계층 정보를 가진다.

`missions`는 각 드론의 미션과 경유점을 가진다.

모드론 → 자드론 릴리즈·트리거 대상은 모드론 미션의 RELEASE 경유점 `target_vehicle_id`에 저장된다.

`qgcPlanSettings`는 QGC `.plan` 내보내기에 필요한 설정을 가진다.

미션 패키지 내보내기·가져오기에는 런타임 상태가 포함되지 않는다.
런타임 상태는 UI 내부 `runtimeState`와 백엔드 `/api/drones/status` 결과로만 관리한다.

## 자드론 OFFBOARD 미션 선택 기능 (2026-10-19)

미션 제어 패널에서 `AUTO_MISSION`과 `OFFBOARD`를 선택하고 명시적으로 적용할 수 있다.
선택만으로 기체 설정이 바뀌지는 않는다. 미션 없이도 모드를 적용할 수 있으며,
미션 업로드 시에도 선택한 실행 모드를 적용한다. 실제 기체의 모드·단계와 제어용 방위각의
유효성은 엄격한 기수 방향 진단과 별도로 표시한다. 아밍 상태이거나 준비·실행 중인
세션에서는 편집을 거부한다. 기존 동작과의 호환을 위해 AUTO를 기본값으로 사용한다.

AUTO의 업로드·다시 읽기·삭제는 FC 저장소를 사용하고, OFFBOARD는 자드론 컴패니언의
메모리를 사용한다. 모드를 바꿔도 기존 FC 미션은 삭제되지 않는다. OFFBOARD 계획은
컴패니언 재시작 시 사라지며 자동으로 재개되지 않는다. 고도 0의 기준은 FC 홈이나
지면이 아니라 트리거 시점의 고도다. LAND 항목의 고도 0은 지면 기준 고도 0까지
비행하라는 명령이 아니다.

이 기능을 적용할 때는 대응하는 펌웨어와 자드론 런타임의 Python 파일 두 개를 함께
배포해야 한다. 해당 변경 당시에는 VM 펌웨어 빌드, 데스크톱 배포본 생성, 기체 업로드와
비행 검증을 수행하지 않았다. 자세한 내용은 작업공간의
`companion_runtime/OFFBOARD_MISSION_DESIGN.md`를 참고한다.
