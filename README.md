
# README.md

# Fleet Mission Editor

Fleet Mission Editor는 여러 대의 드론 mission을 하나의 UI에서 작성하고 관리하기 위한 브라우저 기반 mission editor이다.

현재 단계의 목표는 실제 FC 연결이나 MAVLink upload가 아니라, mission editor의 기본 형태를 만들고 QGroundControl에서 열 수 있는 `.plan` 파일을 내보내 검증하는 것이다.

## 프로젝트 목표

이 프로젝트는 특정 구성에 고정되지 않는다.

초기 샘플은 다음 구조를 사용한다.

```text
Carrier-01
├─ Child-01
├─ Child-02
├─ Child-03
└─ Child-04
```

이 구조는 샘플일 뿐이며, 내부 구조는 더 많은 드론을 관리할 수 있어야 한다.

## 현재 지원 기능

* 브라우저에서 직접 실행
* 빌드 과정 없음
* vehicle 목록 표시
* `parent_vehicle_id` 기반 Carrier-Child 계층 표시
* Carrier 접기/펼치기
* vehicle 선택
* 선택된 vehicle별 waypoint 작성
* 지도 클릭으로 waypoint 생성
* waypoint 고도 입력
* 첫 waypoint 기본 고도 적용
* 다음 waypoint는 이전 waypoint 고도 상속
* waypoint 삭제
* Mission Package JSON export
* Mission Package JSON import
* 선택된 vehicle의 QGC `.plan` export
* 간단한 local sanity check

## 아직 지원하지 않는 기능

* 실제 MAVLink 연결
* UDP 통신
* FC mission upload
* FC mission read-back 검증
* 실시간 telemetry 표시
* vehicle 추가/삭제 UI
* relationship 편집 UI
* 실제 사출 명령 실행
* 여러 vehicle mission 동시 upload
* QGC `.plan` import

## 실행 방법

`index.html` 파일을 Chrome 또는 Edge에서 직접 연다.

설치 과정은 없다.

```text
index.html 더블클릭
```

## 개발 원칙

현재 skeleton 단계에서는 `npm`, `React`, `Vite`, bundler, build tool을 도입하지 않는다.

아래 구조를 유지한다.

```text
fleet-mission-editor/
├─ index.html
├─ src/
│  ├─ app.js
│  └─ style.css
├─ docs/
│  ├─ mission-editor-requirements.md
│  ├─ qgc-plan-export-spec.md
│  └─ validation-checklist.md
├─ AGENTS.md
└─ README.md
```

## 기본 사용 흐름

```text
1. index.html 실행
2. vehicle 선택
3. 지도 클릭으로 waypoint 생성
4. waypoint 고도 수정
5. 선택 vehicle의 .plan export
6. QGroundControl에서 .plan 열기
7. waypoint / altitude / command 확인
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
