const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(`${__dirname}/app.js`, 'utf8');

function extract(name) {
  const match = new RegExp(`(?:async )?function ${name}\\(`).exec(source);
  assert.ok(match, name);
  const tail = source.slice(match.index + 1);
  const next = /\n(?:async )?function /.exec(tail);
  return source.slice(match.index, next ? match.index + 1 + next.index : source.length);
}

function fixture() {
  let now = 100000;
  const timers = new Map();
  const intervals = [];
  const renders = [];
  const vehicle = { vehicle_id: 'child_01', role: 'child', name: 'Child' };
  const runtimeState = { vehicleConnections: {}, lastTriggerSeenAtMs: {}, status: 'BACKEND ONLINE',
    backendUrl: 'http://test', droneRefreshInFlight: false, consecutiveDronePollingFailures: 0 };
  const context = vm.createContext({
    Date: { now: () => now }, DRONE_CONTACT_STALE_MS: 5000,
    runtimeState, AbortController, getVehicles: () => [vehicle],
    updateLiveDroneMarkers() {}, checkBackendHealth() {},
    renderRuntimeConnection: () => renders.push('connections'),
    renderEmergencyControls() {}, renderCompanionTestPrep() {}, renderMissionSummary() {}, renderMissionMonitor() {},
    validateAllVehicleConnections: () => [], buildDroneConnectionPayload: () => [vehicle],
    window: {
      setInterval(fn, ms) { intervals.push({ fn, ms }); return intervals.length; },
      setTimeout(fn, ms) { const id = timers.size + 1; timers.set(id, { fn, ms }); return id; },
      clearTimeout(id) { timers.delete(id); },
    },
  });
  const functions = ['isKnownRuntimeConnectionState', 'normalizeRuntimeConnectionState', 'normalizeRuntimeFcState',
    'getDroneHealth', 'getDroneStatusValue', 'getDroneStatusType', 'getCompanionConnectionState',
    'mergeDroneConnectionResult', 'buildUnknownDroneConnection', 'getDisplayedCompanionState',
    'getDisplayedFcState', 'hasFreshDroneContact', 'expireStaleDroneConnections', 'normalizeDroneStatusResponse',
    'getDroneConnectionSummary', 'applyDroneStatusResults', 'fetchDroneStatusResults',
    'requestDroneConnectionSnapshot', 'refreshDroneConnections', 'startBackendHealthMonitor'];
  vm.runInContext(functions.map(extract).join('\n'), context);
  const success = (stamp = now) => ({ vehicle_id: 'child_01', type: 'STATUS', timestamp_ms: stamp,
    connection_state: 'CONNECTED', companion_state: 'CONNECTED', companion_alive: true,
    fc_connected: 'CONNECTED', last_seen_ms: stamp, last_fc_heartbeat_ms: 1234 });
  const merge = result => {
    const id = vehicle.vehicle_id;
    const value = context.mergeDroneConnectionResult(id, result, runtimeState.vehicleConnections[id] || {});
    runtimeState.vehicleConnections[id] = value;
    return value;
  };
  return { context, runtimeState, timers, intervals, renders, success, merge, advance: ms => { now += ms; } };
}

test('new OFFLINE overrides the old STATUS alive flag and cannot claim FC disconnection', () => {
  const f = fixture();
  f.merge(f.success());
  f.advance(1000);
  const c = f.merge({ type: 'STATUS', timestamp_ms: 101000, companion_state: 'OFFLINE',
    connection_state: 'OFFLINE', companion_alive: null, fc_connected: 'UNKNOWN', reason: 'status_timeout', last_seen_ms: null });
  assert.equal(f.context.getDisplayedCompanionState(c), 'OFFLINE');
  assert.equal(c.companion_alive, false);
  assert.equal(f.context.getDisplayedFcState(c), 'UNKNOWN');
  assert.equal(c.last_seen_ms, 100000);
});

test('CM4 still reachable but reporting FC loss is distinct from PC-CM4 loss', () => {
  const f = fixture();
  const c = f.merge({ ...f.success(), fc_connected: 'DISCONNECTED' });
  assert.equal(f.context.getDisplayedCompanionState(c), 'CONNECTED');
  assert.equal(f.context.getDisplayedFcState(c), 'DISCONNECTED');
});

test('ERROR and PONG without health never reuse an old green FC status', () => {
  const f = fixture();
  f.merge(f.success());
  f.advance(1000);
  let c = f.merge({ timestamp_ms: 101000, companion_state: 'ERROR', type: 'STATUS' });
  assert.equal(f.context.getDisplayedCompanionState(c), 'ERROR');
  assert.equal(f.context.getDisplayedFcState(c), 'UNKNOWN');
  f.advance(1000);
  c = f.merge({ timestamp_ms: 102000, companion_state: 'CONNECTED', type: 'PONG' });
  assert.equal(f.context.getDisplayedCompanionState(c), 'CONNECTED');
  assert.equal(f.context.getDisplayedFcState(c), 'UNKNOWN');
});

test('five-second display expiry works even when polling/backend has stopped', () => {
  const f = fixture();
  const c = f.merge(f.success());
  f.advance(5000);
  assert.equal(f.context.getDisplayedCompanionState(c), 'CONNECTED');
  f.advance(1);
  assert.equal(f.context.getDisplayedCompanionState(c), 'STALE');
  assert.equal(f.context.getDisplayedFcState(c), 'UNKNOWN');
  assert.equal(f.context.expireStaleDroneConnections(), true);
  assert.equal(c.companion_alive, null);
  assert.equal(c.last_seen_ms, 100000);
  assert.equal(f.context.expireStaleDroneConnections(), false);
});

test('re-reading cached STATUS cannot renew display contact through applyDroneStatusResults', () => {
  const f = fixture();
  const reply = { ok: true, results: { child_01: f.success() }, served_at_ms: 100000 };
  f.context.applyDroneStatusResults(f.context.normalizeDroneStatusResponse(reply));
  f.advance(6000);
  reply.served_at_ms += 6000;
  f.context.applyDroneStatusResults(f.context.normalizeDroneStatusResponse(reply));
  const c = f.runtimeState.vehicleConnections.child_01;
  assert.equal(c.last_confirmed_contact_ms, 100000);
  assert.equal(c.last_status_result_ms, 100000);
  assert.equal(f.context.getDisplayedCompanionState(c), 'STALE');
});

test('a stale cache on first load is not green, even with different browser/server clocks', () => {
  const f = fixture();
  const result = { ...f.success(1000), last_seen_ms: 1000 };
  const normalized = f.context.normalizeDroneStatusResponse({ results: { child_01: result }, served_at_ms: 10000 });
  const c = f.merge(normalized.child_01);
  assert.equal(c.last_confirmed_contact_ms, 91000);
  assert.equal(f.context.getDisplayedCompanionState(c), 'STALE');
});

test('fresh reply restores both badges; older delayed reports cannot overwrite it', () => {
  const f = fixture();
  f.merge(f.success());
  f.advance(6000);
  f.context.expireStaleDroneConnections();
  const recovered = f.merge(f.success(106000));
  assert.equal(f.context.getDisplayedCompanionState(recovered), 'CONNECTED');
  assert.equal(f.context.getDisplayedFcState(recovered), 'CONNECTED');
  const delayed = f.merge({ timestamp_ms: 105000, companion_state: 'OFFLINE', type: 'STATUS' });
  assert.equal(f.context.getDisplayedCompanionState(delayed), 'CONNECTED');
});

test('a corrected backend wall clock does not permanently block reconnection', () => {
  const f = fixture();
  f.merge(f.success());
  f.advance(6000);
  f.context.expireStaleDroneConnections();
  const normalized = f.context.normalizeDroneStatusResponse({
    results: { child_01: f.success(1000) }, served_at_ms: 1000,
  });
  const c = f.merge(normalized.child_01);
  assert.equal(f.context.getDisplayedCompanionState(c), 'CONNECTED');
});

test('the independent expiry timer updates once, not a card rebuild every second', () => {
  const f = fixture();
  f.merge(f.success());
  f.context.startBackendHealthMonitor();
  f.context.startBackendHealthMonitor();
  const timers = f.intervals.filter(timer => timer.ms === 1000);
  assert.equal(timers.length, 1);
  f.runtimeState.status = 'BACKEND OFFLINE';
  f.advance(6000);
  timers[0].fn();
  assert.equal(f.renders.length, 1);
  timers[0].fn();
  assert.equal(f.renders.length, 1);
});

test('stalled HTTP is aborted and the following snapshot can succeed', async () => {
  const f = fixture();
  f.context.fetch = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  });
  const pending = f.context.requestDroneConnectionSnapshot('/api/drones/status', { method: 'GET' });
  const timer = [...f.timers.values()][0];
  assert.equal(timer.ms, 5000);
  timer.fn();
  await assert.rejects(pending, /aborted/);
  assert.equal(f.timers.size, 0);
  f.context.fetch = async () => ({ ok: true, json: async () => ({ ok: true }) });
  assert.equal((await f.context.requestDroneConnectionSnapshot('/api/drones/status', {})).ok, true);
  assert.equal(f.timers.size, 0);
});

test('failed connect plus stale status cache stays stale, then a real poll recovers', async () => {
  const f = fixture();
  f.merge(f.success());
  f.advance(6000);
  f.context.fetch = async url => {
    if (url.endsWith('/connect')) throw new Error('network');
    return { ok: true, json: async () => ({ ok: true, results: { child_01: f.success(100000) }, served_at_ms: 106000 }) };
  };
  await f.context.refreshDroneConnections({ silent: true });
  assert.equal(f.context.getDisplayedCompanionState(f.runtimeState.vehicleConnections.child_01), 'STALE');
  assert.equal(f.runtimeState.droneRefreshInFlight, false);
  f.context.fetch = async () => ({ ok: true,
    json: async () => ({ ok: true, results: { child_01: f.success(106000) }, served_at_ms: 106000 }) });
  await f.context.refreshDroneConnections({ silent: true });
  assert.equal(f.context.getDisplayedCompanionState(f.runtimeState.vehicleConnections.child_01), 'CONNECTED');
});
