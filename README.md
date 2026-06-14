# Fleet Mission Editor Skeleton

모드론 1대 + 자드론 4대를 대상으로 한 Mission Editor 스켈레톤입니다.

## 현재 포함 기능

- 드론 5대 기본 슬롯
  - Mother SYSID 1
  - Child 1 SYSID 11
  - Child 2 SYSID 12
  - Child 3 SYSID 13
  - Child 4 SYSID 14
- 드론별 UDP 연결 설정값 저장
- 지도 클릭 기반 waypoint 생성
- waypoint별 고도 입력
- 첫 waypoint 기본 고도 10m
- 다음 waypoint는 이전 고도 상속
- 모드론 waypoint에 `RELEASE_CHILD_N` action 메타데이터 지정
- Mission Package JSON 저장/불러오기
- 선택 드론 QGroundControl `.plan` 저장

## 실행 방법

`index.html`을 브라우저에서 열면 됩니다.

지도는 Leaflet + OpenStreetMap CDN을 사용하므로 인터넷 연결이 필요합니다.

## 중요한 제한

이 버전은 정적 웹앱입니다.

브라우저는 UDP MAVLink를 직접 열 수 없기 때문에 실제 FC 연결, heartbeat 수신, mission upload는 아직 포함하지 않았습니다.
현재의 `연결 설정`은 이후 backend에서 사용할 설정값을 저장하는 용도입니다.

## QGC 검증 방법

1. 브라우저에서 `index.html` 실행
2. 좌측에서 드론 선택
3. 지도 클릭으로 waypoint 생성
4. 우측에서 고도 수정
5. `선택 드론 .plan 저장` 클릭
6. QGroundControl 실행
7. Plan View에서 저장한 `.plan` 파일 열기
8. QGC에서 waypoint, 고도, command가 정상 표시되는지 확인

## QGC .plan 생성 방식

- QGC Plan JSON 형식 사용
- mission item은 `SimpleItem`으로 생성
- 첫 waypoint는 기본적으로 `MAV_CMD_NAV_TAKEOFF`로 export
- 나머지는 `MAV_CMD_NAV_WAYPOINT`로 export
- frame은 `MAV_FRAME_GLOBAL_RELATIVE_ALT` 사용

## 다음 개발 단위

- 실제 UDP MAVLink backend 추가
- QGC `.plan`을 MAVLink Mission Item으로 변환
- pymavlink 또는 MAVSDK 기반 mission upload
- read-back 검증
- 5대 동시 connection manager
