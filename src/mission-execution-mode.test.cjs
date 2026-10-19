const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(`${__dirname}/app.js`, 'utf8');
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  const end = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, end < 0 ? source.length : end);
}
function fixture() {
  const elements = {};
  for (const id of ['childMissionModeControl', 'childMissionExecutionMode', 'childMissionExecutionStatus', 'applyChildMissionModeBtn']) {
    elements[id] = { classList: { toggle() {} }, textContent: '', value: '', disabled: false };
  }
  const mission = { mission_id: 'test', execution_mode: 'OFFBOARD' };
  const vehicle = { vehicle_id: 'child_01', role: 'child' };
  const connection = { companion_state: 'CONNECTED', mission_progress: { armed: false },
    offboard_mission: { mode: 'OFFBOARD', phase: 'LOADED', control_age_ms: 50, control: { yaw_usable: true } } };
  const context = vm.createContext({
    isChildVehicle: value => value?.role === 'child',
    getSelectedVehicle: () => vehicle, getSelectedMission: () => mission, getVehicleConnection: () => connection,
    runtimeState: { status: 'BACKEND ONLINE' }, document: { getElementById: id => elements[id] },
    normalizeVehicleRole: role => role, getMissionProfile: () => 'air_arm_relative', getAltitudeReference: () => 'air_arm_home',
    buildFcMissionItems: () => [{ seq: 0, command: 21, x: 36.4535769, y: 127.4051803, z: 0, waypoint: {} }],
    buildCarrierActionPlanPayload: () => null,
  });
  vm.runInContext(['getMissionExecutionMode', 'buildMissionUploadPayload', 'renderChildMissionMode'].map(extract).join('\n'), context);
  return { context, elements, mission, vehicle, connection };
}
test('OFFBOARD payload explicitly carries trigger-relative height and precise coordinates', () => {
  const { context, mission, vehicle } = fixture();
  const payload = context.buildMissionUploadPayload(mission, vehicle);
  assert.equal(payload.execution_mode, 'OFFBOARD');
  assert.equal(payload.altitude_reference, 'TRIGGER');
  assert.equal(payload.items[0].x, 36.4535769);
  assert.equal(payload.items[0].z, 0);
  assert.equal(payload.items[0].waypoint, undefined);
});
test('legacy child plans and carrier always default to AUTO', () => {
  const { context, mission, vehicle } = fixture();
  assert.equal(context.getMissionExecutionMode({}, vehicle), 'AUTO_MISSION');
  vehicle.role = 'carrier';
  assert.equal(context.getMissionExecutionMode(mission, vehicle), 'AUTO_MISSION');
});
test('applied mode and control yaw are distinct from strict heading diagnostics', () => {
  const { context, elements, connection } = fixture();
  connection.nav_gate = { conditions: { nav_gate_heading_ok: { value: false } } };
  context.renderChildMissionMode();
  assert.match(elements.childMissionExecutionStatus.textContent, /제어용 yaw: 사용 가능/);
  assert.match(elements.childMissionExecutionStatus.textContent, /트리거 당시 고도/);
  connection.offboard_mission.control_age_ms = 701;
  context.renderChildMissionMode();
  assert.match(elements.childMissionExecutionStatus.textContent, /미확인\/오래된 데이터/);
});
test('prepared or armed sessions cannot change mode', () => {
  const { context, elements, connection } = fixture();
  for (const phase of ['PREPARED', 'RECOVERING', 'CLAIMING', 'RUNNING']) {
    connection.offboard_mission.phase = phase;
    context.renderChildMissionMode();
    assert.equal(elements.childMissionExecutionMode.disabled, true);
    assert.equal(elements.applyChildMissionModeBtn.disabled, true);
  }
  connection.offboard_mission.phase = 'TERMINAL';
  connection.mission_progress.armed = true;
  context.renderChildMissionMode();
  assert.equal(elements.childMissionExecutionMode.disabled, true);
});
test('unapplied selection is visibly distinguished from device selection', () => {
  const { context, elements, connection } = fixture();
  connection.offboard_mission.mode = 'AUTO_MISSION';
  context.renderChildMissionMode();
  assert.match(elements.childMissionExecutionStatus.textContent, /적용 또는 업로드 필요/);
});
