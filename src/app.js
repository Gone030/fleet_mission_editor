const INITIAL_MISSION_PACKAGE = {
  version: 1,
  vehicles: [],
  missions: [],
  relationships: [],
  qgcPlanSettings: {
    firmwareType: 12,
    vehicleType: 2,
    hoverSpeed: 5,
    cruiseSpeed: 15,
    useFirstAsTakeoff: true,
    globalPlanAltitudeMode: 1,
  },
};

let state = JSON.parse(JSON.stringify(INITIAL_MISSION_PACKAGE));
state.selectedVehicleId = null;

const runtimeState = {
  backendUrl: getDefaultBackendUrl(),
  status: 'BACKEND OFFLINE',
  service: '',
  version: '',
  message: 'Local runtime backend health check only. MAVLink, UDP companion, trigger send are not implemented here.',
  vehicleConnections: {},
  dronesConnecting: false,
  backendCheckInFlight: false,
  healthMonitorId: null,
  dronePollingTimer: null,
  droneRefreshInFlight: false,
  consecutiveDronePollingFailures: 0,
  emergencyInFlight: false,
  emergencyResult: null,
  vehicleSaveStatus: 'Vehicles not loaded',
  vehicleSaveStatusKind: '',
  vehicleSaveInFlight: false,
};

function getDefaultBackendUrl() {
  if (window.location.origin.startsWith('http://') || window.location.origin.startsWith('https://')) {
    return window.location.origin;
  }

  return 'http://127.0.0.1:8000';
}

function getVehicles() {
  return state.vehicles;
}

function getSelectedVehicle() {
  if (!state.selectedVehicleId) return null;
  return state.vehicles.find((vehicle) => vehicle.vehicle_id === state.selectedVehicleId);
}

function getMissionByVehicleId(vehicleId) {
  if (!vehicleId) return null;

  let mission = state.missions.find((item) => item.vehicle_id === vehicleId);

  if (!mission) {
    mission = {
      mission_id: `mission_${vehicleId}`,
      vehicle_id: vehicleId,
      waypoints: [],
    };
    state.missions.push(mission);
  }

  if (!mission.uploadState){
    mission.uploadState = 'Editing';
  }

  return mission;
}

function getSelectedMission() {
  return getMissionByVehicleId(state.selectedVehicleId);
}

function getTopLevelVehicles() {
  return getVehicles()
    .filter((vehicle) => vehicle.parent_vehicle_id === null)
    .sort((a, b) => a.sort_order - b.sort_order);
}

function getChildVehicles(parentVehicleId) {
  return getVehicles()
    .filter((vehicle) => vehicle.parent_vehicle_id === parentVehicleId)
    .sort((a, b) => a.sort_order - b.sort_order);
}

function toggleVehicleCollapsed(vehicleId, event) {
  event.stopPropagation();

  const vehicle = getVehicles().find((item) => item.vehicle_id === vehicleId);
  if (!vehicle) return;

  vehicle.collapsed = !vehicle.collapsed;
  renderAll();
  saveVehicleConfigs({ silent: true });
}

const COMMAND = {
  MAV_CMD_NAV_WAYPOINT: 16,
  MAV_CMD_NAV_TAKEOFF: 22,
  MAV_FRAME_GLOBAL_RELATIVE_ALT: 3,
};

const RELATIONSHIP_ACTION_TYPES = [
  'START_MISSION',
  'RELEASE',
  'HOLD',
  'RTL',
  'LAND',
];

const FIRMWARE_PROFILES = [
  'standard_px4',
  'px4_nav_ready_gate',
];

const VEHICLE_ROLES = [
  'carrier',
  'child',
];

const EMERGENCY_ACTIONS = [
  'LAND',
  'DISARM',
  'FORCE_DISARM',
];

const VEHICLE_CONFIG_FIELDS = [
  'vehicle_id',
  'name',
  'role',
  'sysid',
  'ip',
  'udp_port',
  'parent_vehicle_id',
  'sort_order',
  'color',
  'collapsed',
  'firmware_profile',
];

const VEHICLE_COLORS = [
  '#0891b2',
  '#4f46e5',
  '#c026d3',
  '#ea580c',
  '#65a30d',
  '#0d9488',
];

let markers = {};
let polylines = {};
const liveDroneMarkers = new Map();


const map = L.map('map').setView([36.3504, 127.3845], 14);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 20,
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

map.on('click', (e) => addWaypoint(e.latlng.lat, e.latlng.lng));

document.getElementById('exportPackageBtn').addEventListener('click', exportPackageJson);
document.getElementById('importPackageInput').addEventListener('change', importPackageJson);
document.getElementById('addVehicleBtn').addEventListener('click', showVehicleForm);
document.getElementById('deleteVehicleBtn').addEventListener('click', deleteSelectedVehicle);
document.getElementById('vehicleForm').addEventListener('submit', addVehicleFromForm);
document.getElementById('cancelVehicleBtn').addEventListener('click', hideVehicleForm);
document.getElementById('vehicleRole').addEventListener('change', syncFirmwareProfileForRole);
document.getElementById('resetBtn').addEventListener('click', () => {
  if (confirm('모든 mission 데이터를 초기화할까요?')) {
    state = JSON.parse(JSON.stringify(INITIAL_MISSION_PACKAGE));
    state.selectedVehicleId = null;
    hideVehicleForm();
    syncSettingsToForm();
    renderAll();
  }
});
document.getElementById('saveConnBtn').addEventListener('click', saveConnectionForm);
document.getElementById('executeEmergencyBtn').addEventListener('click', executeEmergencyAction);
document.getElementById('connectBackendBtn').addEventListener('click', connectBackend);
document.getElementById('refreshDroneStatusBtn').addEventListener('click', () => refreshDroneConnections());
document.getElementById('connectDronesBtn').addEventListener('click', connectDrones);
document.getElementById('backendUrl').addEventListener('change', saveBackendUrl);
document.getElementById('exportQgcBtn').addEventListener('click', exportSelectedQgcPlan);
document.getElementById('clearMissionBtn').addEventListener('click', clearSelectedMission);
document.getElementById('focusSelectedBtn').addEventListener('click', focusSelectedLiveDrone);
document.getElementById('fitLiveDronesBtn').addEventListener('click', fitLiveDroneMarkers);
document.getElementById('relationshipForm').addEventListener('submit', addRelationshipFromForm);

for (const id of ['firmwareType', 'vehicleType', 'hoverSpeed', 'cruiseSpeed', 'useFirstAsTakeoff']) {
  document.getElementById(id).addEventListener('change', saveQgcSettingsFromForm);
}

function renderAll() {
  renderDroneList();
  renderConnectionForm();
  renderWaypointRows();
  renderMapItems();
  updateLiveDroneMarkers();
  renderMissionSummary();
  renderEmergencyControls();
  renderRelationshipEditor();
  renderRelationshipList();
  renderSanityCheck();
  renderRuntimeConnection();
}

function setVehicleSaveStatus(text, kind = '') {
  runtimeState.vehicleSaveStatus = text;
  runtimeState.vehicleSaveStatusKind = kind;
  const el = document.getElementById('vehicleSaveStatus');
  if (!el) return;
  el.textContent = text;
  el.className = `save-status${kind ? ` is-${kind}` : ''}`;
}

function stripRuntimeFieldsFromVehicle(vehicle) {
  const clean = {};
  for (const field of VEHICLE_CONFIG_FIELDS) {
    if (field in vehicle) clean[field] = vehicle[field];
  }
  clean.role = normalizeVehicleRole(clean.role);
  return clean;
}

function normalizeVehicleRole(role) {
  const normalized = String(role || '').trim().toLowerCase();
  return VEHICLE_ROLES.includes(normalized) ? normalized : 'child';
}

function formatVehicleRole(role) {
  const normalized = normalizeVehicleRole(role);
  return normalized === 'carrier' ? 'Carrier' : 'Child';
}

function ensureMissionsForVehicles() {
  const vehicleIds = new Set(getVehicles().map((vehicle) => vehicle.vehicle_id));
  state.missions = state.missions.filter((mission) => vehicleIds.has(mission.vehicle_id));

  for (const vehicle of getVehicles()) {
    getMissionByVehicleId(vehicle.vehicle_id);
  }
}

function applyLoadedVehicles(vehicles) {
  state.vehicles = vehicles.map(stripRuntimeFieldsFromVehicle);
  state.selectedVehicleId = state.vehicles[0]?.vehicle_id || null;
  ensureMissionsForVehicles();
  runtimeState.emergencyResult = null;
}

async function loadVehicleConfigs() {
  setVehicleSaveStatus('Loading vehicles...', 'saving');

  try {
    const response = await fetch(`${runtimeState.backendUrl}/api/vehicles`, {
      method: 'GET',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    if (!data || data.ok !== true || !Array.isArray(data.vehicles)) {
      throw new Error('Invalid vehicles response');
    }

    applyLoadedVehicles(data.vehicles);
    setVehicleSaveStatus('Vehicles loaded', 'saved');
    renderAll();
  } catch (error) {
    setVehicleSaveStatus(`Vehicle load failed: ${error.message}`, 'error');
  }
}

async function saveVehicleConfigs({ silent = false } = {}) {
  if (runtimeState.vehicleSaveInFlight) return false;
  runtimeState.vehicleSaveInFlight = true;
  setVehicleSaveStatus('Saving vehicles...', 'saving');

  try {
    const response = await fetch(`${runtimeState.backendUrl}/api/vehicles`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({
        vehicles: getVehicles().map(stripRuntimeFieldsFromVehicle),
      }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.ok !== true || !Array.isArray(data.vehicles)) {
      const detail = data?.detail && typeof data.detail === 'object' ? data.detail : data;
      throw new Error(detail?.reason || detail?.message || `HTTP ${response.status}`);
    }

    state.vehicles = data.vehicles.map(stripRuntimeFieldsFromVehicle);
    if (!state.vehicles.some((vehicle) => vehicle.vehicle_id === state.selectedVehicleId)) {
      state.selectedVehicleId = state.vehicles[0]?.vehicle_id || null;
    }
    ensureMissionsForVehicles();
    setVehicleSaveStatus('Vehicles saved', 'saved');
    renderAll();
    return true;
  } catch (error) {
    setVehicleSaveStatus(`Vehicle save failed: ${error.message}`, 'error');
    if (!silent) console.warn('Vehicle config save failed:', error);
    return false;
  } finally {
    runtimeState.vehicleSaveInFlight = false;
  }
}

function getVehicleById(vehicleId) {
  return getVehicles().find((vehicle) => vehicle.vehicle_id === vehicleId);
}

function generateVehicleId() {
  let index = getVehicles().length + 1;
  let vehicleId = `vehicle_${String(index).padStart(2, '0')}`;

  while (getVehicleById(vehicleId)) {
    index += 1;
    vehicleId = `vehicle_${String(index).padStart(2, '0')}`;
  }

  return vehicleId;
}

function getNextSysid() {
  const used = new Set(getVehicles().map((vehicle) => Number(vehicle.sysid)));

  for (let sysid = 1; sysid <= 255; sysid += 1) {
    if (!used.has(sysid)) return sysid;
  }

  return 255;
}

function getNextUdpPort() {
  const ports = getVehicles()
    .map((vehicle) => Number(vehicle.udp_port))
    .filter(Number.isFinite);
  const nextPort = ports.length ? Math.max(...ports) + 1 : 14550;
  return Math.min(nextPort, 65535);
}

function getNextSortOrder(parentVehicleId) {
  const siblings = getVehicles().filter(
    (vehicle) => vehicle.parent_vehicle_id === parentVehicleId
  );
  const orders = siblings.map((vehicle) => Number(vehicle.sort_order)).filter(Number.isFinite);
  return orders.length ? Math.max(...orders) + 1 : 1;
}

function getUniqueMissionId(vehicleId) {
  const baseId = `mission_${vehicleId}`;
  let missionId = baseId;
  let suffix = 2;

  while (state.missions.some((mission) => mission.mission_id === missionId)) {
    missionId = `${baseId}_${suffix}`;
    suffix += 1;
  }

  return missionId;
}

function expandVehicleAncestors(vehicleId) {
  let currentId = vehicleId;

  while (currentId) {
    const vehicle = getVehicleById(currentId);
    if (!vehicle) return;

    vehicle.collapsed = false;
    currentId = vehicle.parent_vehicle_id;
  }
}

function populateVehicleParentOptions() {
  const select = document.getElementById('vehicleParent');
  select.innerHTML = '';

  const topLevelOption = document.createElement('option');
  topLevelOption.value = '';
  topLevelOption.textContent = 'None (top-level)';
  select.appendChild(topLevelOption);

  for (const vehicle of getVehicles()) {
    const option = document.createElement('option');
    option.value = vehicle.vehicle_id;
    option.textContent = `${vehicle.name} (${vehicle.vehicle_id})`;
    select.appendChild(option);
  }
}

function showVehicleForm() {
  const vehicleId = generateVehicleId();

  populateVehicleParentOptions();
  document.getElementById('vehicleId').value = vehicleId;
  document.getElementById('vehicleName').value = `Vehicle-${getVehicles().length + 1}`;
  document.getElementById('vehicleRole').value = 'child';
  document.getElementById('vehicleSysid').value = getNextSysid();
  document.getElementById('vehicleIp').value = '127.0.0.1';
  document.getElementById('vehiclePort').value = getNextUdpPort();
  document.getElementById('vehicleParent').value = '';
  document.getElementById('vehicleColor').value =
    VEHICLE_COLORS[getVehicles().length % VEHICLE_COLORS.length];
  document.getElementById('vehicleFirmwareProfile').value = 'standard_px4';
  document.getElementById('vehicleForm').classList.remove('hidden');
  document.getElementById('vehicleId').focus();
}

function hideVehicleForm() {
  document.getElementById('vehicleForm').classList.add('hidden');
}

function syncFirmwareProfileForRole() {
  const role = document.getElementById('vehicleRole').value.trim().toLowerCase();
  document.getElementById('vehicleFirmwareProfile').value =
    role === 'child' ? 'px4_nav_ready_gate' : 'standard_px4';
}

function addVehicleFromForm(event) {
  event.preventDefault();

  const vehicleId = document.getElementById('vehicleId').value.trim();
  const name = document.getElementById('vehicleName').value.trim();
  const role = normalizeVehicleRole(document.getElementById('vehicleRole').value);
  const sysid = Number(document.getElementById('vehicleSysid').value);
  const ip = document.getElementById('vehicleIp').value.trim();
  const udpPort = Number(document.getElementById('vehiclePort').value);
  const parentValue = document.getElementById('vehicleParent').value;
  const parentVehicleId = parentValue || null;
  const color = document.getElementById('vehicleColor').value;
  const firmwareProfile = document.getElementById('vehicleFirmwareProfile').value;

  if (!/^[A-Za-z0-9_-]+$/.test(vehicleId)) {
    alert('Vehicle ID는 영문, 숫자, 밑줄, 하이픈만 사용할 수 있습니다.');
    return;
  }

  if (getVehicleById(vehicleId)) {
    alert(`Vehicle ID "${vehicleId}"가 이미 존재합니다.`);
    return;
  }

  if (!name || !role || !ip) {
    alert('Name, Role, IP를 입력하세요.');
    return;
  }

  if (!Number.isInteger(sysid) || sysid < 1 || sysid > 255) {
    alert('SYSID는 1부터 255 사이의 정수여야 합니다.');
    return;
  }

  if (!Number.isInteger(udpPort) || udpPort < 1 || udpPort > 65535) {
    alert('UDP Port는 1부터 65535 사이의 정수여야 합니다.');
    return;
  }

  if (parentVehicleId && !getVehicleById(parentVehicleId)) {
    alert('선택한 parent vehicle이 존재하지 않습니다.');
    return;
  }

  if (!FIRMWARE_PROFILES.includes(firmwareProfile)) {
    alert('유효한 firmware profile을 선택하세요.');
    return;
  }

  const vehicle = {
    vehicle_id: vehicleId,
    name,
    role,
    sysid,
    ip,
    udp_port: udpPort,
    firmware_profile: firmwareProfile,
    parent_vehicle_id: parentVehicleId,
    sort_order: getNextSortOrder(parentVehicleId),
    color,
    collapsed: false,
  };

  state.vehicles.push(vehicle);
  state.missions.push({
    mission_id: getUniqueMissionId(vehicleId),
    vehicle_id: vehicleId,
    uploadState: 'Editing',
    waypoints: [],
  });

  if (parentVehicleId) {
    expandVehicleAncestors(parentVehicleId);
  }

  state.selectedVehicleId = vehicleId;
  runtimeState.emergencyResult = null;
  hideVehicleForm();
  renderAll();
  saveVehicleConfigs({ silent: true });
}

function getVehicleRelationships(vehicleId) {
  return state.relationships.filter(
    (relationship) =>
      relationship.trigger_vehicle_id === vehicleId ||
      relationship.target_vehicle_id === vehicleId
  );
}

function getWaypointRelationships(vehicleId, waypointSeq) {
  return state.relationships.filter(
    (relationship) =>
      relationship.trigger_vehicle_id === vehicleId &&
      Number(relationship.trigger_waypoint_id) === Number(waypointSeq)
  );
}

function deleteSelectedVehicle() {
  const vehicle = getSelectedVehicle();
  if (!vehicle) return;

  const children = getChildVehicles(vehicle.vehicle_id);
  if (children.length > 0) {
    alert(`${vehicle.name} 아래에 child vehicle이 있어 삭제할 수 없습니다.`);
    return;
  }

  const relationships = getVehicleRelationships(vehicle.vehicle_id);
  if (relationships.length > 0) {
    alert(`${vehicle.name}에 연결된 relationship이 있어 삭제할 수 없습니다.`);
    return;
  }

  if (getVehicles().length === 1) {
    alert('마지막 vehicle은 삭제할 수 없습니다.');
    return;
  }

  if (!confirm(`${vehicle.name}과 해당 mission을 삭제할까요?`)) return;

  state.vehicles = state.vehicles.filter(
    (item) => item.vehicle_id !== vehicle.vehicle_id
  );
  state.missions = state.missions.filter(
    (mission) => mission.vehicle_id !== vehicle.vehicle_id
  );
  state.selectedVehicleId = state.vehicles[0].vehicle_id;
  runtimeState.emergencyResult = null;
  hideVehicleForm();
  renderAll();
  saveVehicleConfigs({ silent: true });
}

function renderDroneList() {
  const list = document.getElementById('droneList');
  list.innerHTML = '';

  if (getVehicles().length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No vehicles yet. Add a vehicle first.';
    list.appendChild(empty);
    return;
  }

  for (const vehicle of getTopLevelVehicles()) {
    renderVehicleTree(list, vehicle, 0);
  }
}

function renderVehicleTree(list, vehicle, depth) {
  const mission = getMissionByVehicleId(vehicle.vehicle_id);
  const uploadState = mission.uploadState || 'Editing';
  const children = getChildVehicles(vehicle.vehicle_id);
  const hasChildren = children.length > 0;
  const isSelected = vehicle.vehicle_id === state.selectedVehicleId;

  const card = document.createElement('div');
  card.className = 'drone-card' + (isSelected ? ' active' : '') + (depth > 0 ? ' child-card' : '');
  card.style.setProperty('--tree-depth', depth);

  card.onclick = () => {
    if (state.selectedVehicleId !== vehicle.vehicle_id) {
      runtimeState.emergencyResult = null;
    }
    state.selectedVehicleId = vehicle.vehicle_id;
    renderAll();
  };

  const toggleButton = hasChildren
    ? `<button class="tree-toggle" data-toggle="${escapeHtml(vehicle.vehicle_id)}">${vehicle.collapsed ? '▶' : '▼'}</button>`
    : `<span class="tree-spacer"></span>`;

  const childSummary = hasChildren
    ? `<div class="kv"><span>Children</span><span>${children.length}</span></div>`
    : '';

  card.innerHTML = `
    <div class="drone-head">
      <div class="drone-name">
        ${toggleButton}
        <span>${escapeHtml(vehicle.name)}</span>
      </div>
      <div class="badge ${mission.waypoints.length ? 'ok' : 'warn'}">${escapeHtml(uploadState)}</div>
    </div>
    <div class="kv"><span>Role</span><span>${escapeHtml(formatVehicleRole(vehicle.role))}</span></div>
    <div class="kv"><span>SYSID</span><span>${escapeHtml(vehicle.sysid)}</span></div>
    <div class="kv"><span>UDP</span><span>${escapeHtml(vehicle.ip)}:${escapeHtml(vehicle.udp_port)}</span></div>
    <div class="kv"><span>Profile</span><span>${escapeHtml(vehicle.firmware_profile)}</span></div>
    <div class="kv"><span>WP</span><span>${mission.waypoints.length}</span></div>
    ${childSummary}
  `;

  const toggle = card.querySelector('[data-toggle]');
  if (toggle) {
    toggle.addEventListener('click', (event) => {
      toggleVehicleCollapsed(vehicle.vehicle_id, event);
    });
  }

  list.appendChild(card);

  if (!vehicle.collapsed) {
    for (const child of children) {
      renderVehicleTree(list, child, depth + 1);
    }
  }
}

function renderConnectionForm() {
  const vehicle = getSelectedVehicle();
  const ids = ['connName', 'connIp', 'connPort', 'connSysid', 'connRole', 'connFirmwareProfile'];
  const saveButton = document.getElementById('saveConnBtn');

  if (!vehicle) {
    for (const id of ids) {
      const input = document.getElementById(id);
      input.value = '';
      input.disabled = true;
    }
    saveButton.disabled = true;
    clearConnectionWarning();
    return;
  }

  document.getElementById('connName').value = vehicle.name;
  document.getElementById('connIp').value = vehicle.ip;
  document.getElementById('connPort').value = vehicle.udp_port;
  document.getElementById('connSysid').value = vehicle.sysid;
  document.getElementById('connRole').value = normalizeVehicleRole(vehicle.role);
  document.getElementById('connFirmwareProfile').value = vehicle.firmware_profile;
  for (const id of ids) {
    document.getElementById(id).disabled = false;
  }
  saveButton.disabled = false;
  clearConnectionWarning();
}

function getConnectionFormValues() {
  return {
    name: document.getElementById('connName').value.trim(),
    role: normalizeVehicleRole(document.getElementById('connRole').value),
    firmware_profile: document.getElementById('connFirmwareProfile').value,
    sysid: Number(document.getElementById('connSysid').value),
    ip: document.getElementById('connIp').value.trim(),
    udp_port: Number(document.getElementById('connPort').value),
  };
}

function validateVehicleConnectionValues(values, label = 'Selected vehicle') {
  const warnings = [];

  if (!values.name) warnings.push(`${label}: name을 입력하세요.`);
  if (!VEHICLE_ROLES.includes(values.role)) warnings.push(`${label}: role은 carrier 또는 child여야 합니다.`);
  if (!values.ip) warnings.push(`${label}: IP가 비어 있습니다.`);
  if (!Number.isInteger(values.udp_port) || values.udp_port < 1 || values.udp_port > 65535) {
    warnings.push(`${label}: UDP port는 1~65535 사이의 숫자여야 합니다.`);
  }
  if (!Number.isInteger(values.sysid) || values.sysid < 1 || values.sysid > 255) {
    warnings.push(`${label}: SYSID는 1~255 사이의 숫자여야 합니다.`);
  }
  if (!FIRMWARE_PROFILES.includes(values.firmware_profile)) {
    warnings.push(`${label}: 유효한 firmware profile을 선택하세요.`);
  }

  return warnings;
}

function validateVehicleForRuntime(vehicle) {
  return validateVehicleConnectionValues(
    {
      name: String(vehicle.name || '').trim(),
      role: normalizeVehicleRole(vehicle.role),
      firmware_profile: vehicle.firmware_profile,
      sysid: Number(vehicle.sysid),
      ip: String(vehicle.ip || '').trim(),
      udp_port: Number(vehicle.udp_port),
    },
    vehicle.name || vehicle.vehicle_id
  );
}

function showConnectionWarning(warnings) {
  const warning = document.getElementById('connectionWarning');
  warning.textContent = warnings.join('\n');
  warning.classList.remove('hidden');
}

function clearConnectionWarning() {
  const warning = document.getElementById('connectionWarning');
  warning.textContent = '';
  warning.classList.add('hidden');
}

function validateAllVehicleConnections() {
  return getVehicles().flatMap(validateVehicleForRuntime);
}

function saveConnectionForm({ silent = false, persist = true } = {}) {
  const vehicle = getSelectedVehicle();
  if (!vehicle) {
    const warnings = ['No vehicle selected. Add a vehicle first.'];
    showConnectionWarning(warnings);
    if (!silent) alert(warnings[0]);
    return false;
  }

  const values = getConnectionFormValues();
  const warnings = validateVehicleConnectionValues(values, vehicle.name || vehicle.vehicle_id);
  if (warnings.length > 0) {
    showConnectionWarning(warnings);
    if (!silent) alert('Connection 설정을 저장할 수 없습니다:\n- ' + warnings.join('\n- '));
    return false;
  }

  vehicle.name = values.name;
  vehicle.role = normalizeVehicleRole(values.role);
  vehicle.firmware_profile = values.firmware_profile;
  vehicle.sysid = values.sysid;
  vehicle.ip = values.ip;
  vehicle.udp_port = values.udp_port;
  clearConnectionWarning();

  renderAll();
  if (persist) saveVehicleConfigs({ silent: true });
  return true;
}

function renderEmergencyControls() {
  const vehicle = getSelectedVehicle();
  const actionSelect = document.getElementById('emergencyActionSelect');
  const executeButton = document.getElementById('executeEmergencyBtn');
  const resultBox = document.getElementById('emergencyResult');

  actionSelect.disabled = !vehicle || runtimeState.emergencyInFlight;
  executeButton.disabled =
    !vehicle ||
    runtimeState.status !== 'BACKEND ONLINE' ||
    runtimeState.emergencyInFlight;
  executeButton.textContent = runtimeState.emergencyInFlight ? 'Executing...' : 'Execute';

  if (!vehicle) {
    resultBox.textContent = 'Select a vehicle before executing an emergency action.';
    return;
  }

  if (runtimeState.emergencyResult) {
    resultBox.textContent = formatEmergencyResult(runtimeState.emergencyResult);
    return;
  }

  resultBox.textContent = runtimeState.status === 'BACKEND ONLINE'
    ? `Ready for ${vehicle.name} (${vehicle.vehicle_id}).`
    : 'Backend must be online before executing an emergency action.';
}

function formatEmergencyResult(result) {
  if (!result) return '';
  if (result.ok) {
    const ack = result.ack || {};
    return `Emergency result: ${result.action} / ${ack.result || 'ACK'} / ${ack.reason || result.reason || '-'}`;
  }

  return `Emergency failed: ${result.action || '-'} / ${result.reason || result.message || 'unknown_error'}`;
}

function parseEmergencyError(responseBody, fallbackAction) {
  const detail = responseBody?.detail && typeof responseBody.detail === 'object'
    ? responseBody.detail
    : responseBody;

  return {
    ok: false,
    vehicle_id: detail?.vehicle_id || getSelectedVehicle()?.vehicle_id || '',
    action: detail?.action || fallbackAction,
    reason: detail?.reason || detail?.message || 'request_failed',
    message: detail?.message || '',
  };
}

async function executeEmergencyAction() {
  const vehicle = getSelectedVehicle();
  if (!vehicle) {
    runtimeState.emergencyResult = {
      ok: false,
      action: document.getElementById('emergencyActionSelect').value,
      reason: 'vehicle_not_selected',
    };
    renderEmergencyControls();
    return;
  }

  const action = document.getElementById('emergencyActionSelect').value;
  if (!EMERGENCY_ACTIONS.includes(action)) {
    runtimeState.emergencyResult = {
      ok: false,
      vehicle_id: vehicle.vehicle_id,
      action,
      reason: 'unsupported_action',
    };
    renderEmergencyControls();
    return;
  }

  if (!saveConnectionForm({ persist: false })) return;

  saveBackendUrl();
  if (runtimeState.status !== 'BACKEND ONLINE') {
    runtimeState.emergencyResult = {
      ok: false,
      vehicle_id: vehicle.vehicle_id,
      action,
      reason: 'backend_not_online',
    };
    renderEmergencyControls();
    return;
  }

  const saved = await saveVehicleConfigs({ silent: true });
  if (!saved) {
    runtimeState.emergencyResult = {
      ok: false,
      vehicle_id: vehicle.vehicle_id,
      action,
      reason: 'vehicle_config_save_failed',
    };
    renderEmergencyControls();
    return;
  }

  runtimeState.emergencyInFlight = true;
  runtimeState.emergencyResult = {
    ok: false,
    vehicle_id: vehicle.vehicle_id,
    action,
    reason: 'sending',
  };
  renderEmergencyControls();

  try {
    const response = await fetch(
      `${runtimeState.backendUrl}/api/drones/${encodeURIComponent(vehicle.vehicle_id)}/emergency`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ action }),
      }
    );
    const responseBody = await response.json().catch(() => null);

    if (!response.ok) {
      runtimeState.emergencyResult = parseEmergencyError(responseBody, action);
      return;
    }

    runtimeState.emergencyResult = responseBody;
    applyEmergencyResultToConnection(vehicle.vehicle_id, responseBody);
  } catch (error) {
    runtimeState.emergencyResult = {
      ok: false,
      vehicle_id: vehicle.vehicle_id,
      action,
      reason: 'request_failed',
      message: error.message,
    };
  } finally {
    runtimeState.emergencyInFlight = false;
    renderEmergencyControls();
    renderRuntimeConnection();
  }
}

function applyEmergencyResultToConnection(vehicleId, result) {
  if (!result) return;
  const ack = result.ack || {};
  const current = runtimeState.vehicleConnections[vehicleId] || {};

  runtimeState.vehicleConnections[vehicleId] = {
    ...current,
    last_emergency_action: result.action || ack.action || current.last_emergency_action || null,
    last_emergency_result: ack.result || (result.ok ? 'ACK' : 'FAILED'),
    last_emergency_reason: ack.reason || result.reason || current.last_emergency_reason || null,
    last_emergency_seq: ack.seq || result.seq || current.last_emergency_seq || null,
    last_emergency_command_ms: ack.timestamp_ms || current.last_emergency_command_ms || null,
  };
}

function normalizeBackendUrl(value) {
  return value.trim().replace(/\/+$/, '');
}

function saveBackendUrl() {
  runtimeState.backendUrl = normalizeBackendUrl(
    document.getElementById('backendUrl').value
  );
  if (!runtimeState.backendUrl) {
    runtimeState.status = 'ERROR';
    runtimeState.message = 'Backend URL을 입력하세요.';
    runtimeState.service = '';
    runtimeState.version = '';
  }
  renderRuntimeConnection();
  renderEmergencyControls();
}

function setRuntimeStatus(status, message = '') {
  runtimeState.status = status;
  runtimeState.message = message || runtimeState.message;
  renderRuntimeConnection();
  renderEmergencyControls();
}

function shouldPollDroneConnections() {
  return runtimeState.status === 'BACKEND ONLINE' && getVehicles().length > 0;
}

function syncDronePollingTimer() {
  if (shouldPollDroneConnections()) {
    if (runtimeState.dronePollingTimer) return;

    runtimeState.dronePollingTimer = window.setInterval(() => {
      refreshDroneConnections({ silent: true });
    }, 1000);
    return;
  }

  if (runtimeState.dronePollingTimer) {
    window.clearInterval(runtimeState.dronePollingTimer);
    runtimeState.dronePollingTimer = null;
  }
}

async function connectBackend() {
  await checkBackendHealth({ manual: true });
}

async function checkBackendHealth({ manual = false } = {}) {
  if (runtimeState.backendCheckInFlight) return;

  saveBackendUrl();
  if (!runtimeState.backendUrl) return;

  runtimeState.backendCheckInFlight = true;
  if (manual || runtimeState.status !== 'BACKEND ONLINE') {
    setRuntimeStatus('CONNECTING', 'Checking backend health...');
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 3000);

  try {
    const response = await fetch(`${runtimeState.backendUrl}/api/health`, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const health = await response.json();
    if (!health || health.ok !== true) {
      throw new Error('Invalid health response');
    }

    runtimeState.service = health.service || 'unknown service';
    runtimeState.version = health.version || 'unknown version';
    setRuntimeStatus(
      'BACKEND ONLINE',
      `${runtimeState.service} ${runtimeState.version} online.`
    );
  } catch (error) {
    runtimeState.service = '';
    runtimeState.version = '';
    const isAbort = error.name === 'AbortError';
    setRuntimeStatus(
      isAbort ? 'BACKEND OFFLINE' : 'ERROR',
      isAbort
        ? 'Backend health check timed out.'
        : `Backend health check failed: ${error.message}`
    );
  } finally {
    runtimeState.backendCheckInFlight = false;
    window.clearTimeout(timeoutId);
  }
}

function startBackendHealthMonitor() {
  checkBackendHealth();
  runtimeState.healthMonitorId = window.setInterval(() => {
    checkBackendHealth();
  }, 3000);
}

function buildDroneConnectionPayload() {
  return getVehicles().map((vehicle) => ({
    vehicle_id: vehicle.vehicle_id,
    name: vehicle.name,
    role: vehicle.role,
    ip: vehicle.ip,
    udp_port: vehicle.udp_port,
    firmware_profile: vehicle.firmware_profile,
  }));
}

function markVehiclesConnecting() {
  for (const vehicle of getVehicles()) {
    runtimeState.vehicleConnections[vehicle.vehicle_id] = {
      vehicle_id: vehicle.vehicle_id,
      name: vehicle.name,
      role: vehicle.role,
      ip: vehicle.ip,
      udp_port: vehicle.udp_port,
      firmware_profile: vehicle.firmware_profile,
      connection_state: 'CONNECTING',
      companion_state: 'CONNECTING',
      fc_connected: 'UNKNOWN',
      last_seen_ms: null,
      last_fc_heartbeat_ms: null,
      position: null,
      gps: null,
      release_state: null,
      trigger_state: 'UNKNOWN',
      last_trigger_seq: null,
      last_trigger_state: 'UNKNOWN',
      last_trigger_reason: null,
      last_trigger_relationship_id: null,
      last_trigger_target_vehicle_id: null,
      last_trigger_completed_ms: null,
      rc_trigger_channel: null,
      rc_trigger_threshold: null,
      rc_trigger_active: null,
      rc_trigger_latched: null,
      emergency: null,
      last_emergency_action: null,
      last_emergency_result: null,
      last_emergency_reason: null,
      last_emergency_seq: null,
      last_emergency_command_ms: null,
      reason: 'ping_sent',
      message: 'Waiting for UDP PONG...',
    };
  }
}

function applyDroneStatusResults(results) {
  const nextConnections = {};
  const vehiclesById = new Map(getVehicles().map((vehicle) => [vehicle.vehicle_id, vehicle]));

  for (const [vehicleId, result] of Object.entries(results || {})) {
    const vehicle = vehiclesById.get(vehicleId);
    nextConnections[vehicleId] = {
      vehicle_id: vehicleId,
      name: vehicle?.name || result?.name || vehicleId,
      role: vehicle?.role || result?.role || 'unknown',
      ip: vehicle?.ip || result?.ip || '',
      udp_port: vehicle?.udp_port || result?.udp_port || '',
      firmware_profile: vehicle?.firmware_profile || result?.firmware_profile || '',
      connection_state: result?.connection_state || result?.status || 'UNKNOWN',
      companion_state: result?.companion_state || result?.status || 'UNKNOWN',
      fc_connected: result?.fc_connected || 'UNKNOWN',
      last_seen_ms: result?.last_seen_ms ?? null,
      last_fc_heartbeat_ms: result?.last_fc_heartbeat_ms ?? null,
      position: result?.position ?? null,
      gps: result?.gps ?? null,
      release_state: result?.release_state ?? null,
      trigger_state: result?.trigger_state || 'UNKNOWN',
      last_trigger_seq: result?.last_trigger_seq ?? null,
      last_trigger_state: result?.last_trigger_state || 'UNKNOWN',
      last_trigger_reason: result?.last_trigger_reason ?? null,
      last_trigger_relationship_id: result?.last_trigger_relationship_id ?? null,
      last_trigger_target_vehicle_id: result?.last_trigger_target_vehicle_id ?? null,
      last_trigger_completed_ms: result?.last_trigger_completed_ms ?? null,
      rc_trigger_channel: result?.rc_trigger_channel ?? null,
      rc_trigger_threshold: result?.rc_trigger_threshold ?? null,
      rc_trigger_active: result?.rc_trigger_active ?? null,
      rc_trigger_latched: result?.rc_trigger_latched ?? null,
      emergency: result?.emergency ?? null,
      last_emergency_action: result?.last_emergency_action ?? result?.emergency?.last_action ?? null,
      last_emergency_result: result?.last_emergency_result ?? result?.emergency?.last_result ?? null,
      last_emergency_reason: result?.last_emergency_reason ?? result?.emergency?.last_reason ?? null,
      last_emergency_seq: result?.last_emergency_seq ?? result?.emergency?.last_seq ?? null,
      last_emergency_command_ms: result?.last_emergency_command_ms ?? result?.emergency?.last_command_ms ?? null,
      reason: result?.reason || '',
      message: result?.message || '',
      seq: result?.seq,
      latency_ms: result?.latency_ms,
    };
  }

  for (const vehicle of getVehicles()) {
    if (nextConnections[vehicle.vehicle_id]) continue;
    nextConnections[vehicle.vehicle_id] = {
      vehicle_id: vehicle.vehicle_id,
      name: vehicle.name,
      role: vehicle.role,
      ip: vehicle.ip,
      udp_port: vehicle.udp_port,
      firmware_profile: vehicle.firmware_profile,
      connection_state: 'UNKNOWN',
      companion_state: 'UNKNOWN',
      fc_connected: 'UNKNOWN',
      last_seen_ms: null,
      last_fc_heartbeat_ms: null,
      position: null,
      gps: null,
      release_state: null,
      trigger_state: 'UNKNOWN',
      last_trigger_seq: null,
      last_trigger_state: 'UNKNOWN',
      last_trigger_reason: null,
      last_trigger_relationship_id: null,
      last_trigger_target_vehicle_id: null,
      last_trigger_completed_ms: null,
      rc_trigger_channel: null,
      rc_trigger_threshold: null,
      rc_trigger_active: null,
      rc_trigger_latched: null,
      emergency: null,
      last_emergency_action: null,
      last_emergency_result: null,
      last_emergency_reason: null,
      last_emergency_seq: null,
      last_emergency_command_ms: null,
      reason: '',
      message: '',
    };
  }

  runtimeState.vehicleConnections = nextConnections;
  updateLiveDroneMarkers(nextConnections);
  renderMissionSummary();
}

function normalizeDroneStatusResponse(responseBody) {
  if (responseBody?.results && typeof responseBody.results === 'object') {
    return responseBody.results;
  }

  if (Array.isArray(responseBody?.vehicles)) {
    return Object.fromEntries(
      responseBody.vehicles.map((vehicle) => [vehicle.vehicle_id, vehicle])
    );
  }

  return {};
}

async function refreshDroneStatus({ silent = false } = {}) {
  if (!silent) saveBackendUrl();
  if (!runtimeState.backendUrl) return;
  if (runtimeState.status !== 'BACKEND ONLINE') {
    if (!silent) setRuntimeStatus('ERROR', 'Backend is not online. Retry backend check first.');
    return;
  }

  try {
    const response = await fetch(`${runtimeState.backendUrl}/api/drones/status`, {
      method: 'GET',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const statusBody = await response.json();
    if (!statusBody || statusBody.ok !== true) {
      throw new Error('Invalid drone status response');
    }

    applyDroneStatusResults(normalizeDroneStatusResponse(statusBody));
    renderRuntimeConnection();
  } catch (error) {
    if (!silent) setRuntimeStatus('ERROR', `Drone status refresh failed: ${error.message}`);
  }
}

async function connectDrones() {
  await refreshDroneConnections();
}

async function refreshDroneConnections({ silent = false } = {}) {
  if (runtimeState.droneRefreshInFlight) return;

  if (getVehicles().length === 0) {
    const warnings = ['No vehicles yet. Add a vehicle first.'];
    if (!silent) {
      showConnectionWarning(warnings);
      alert(warnings[0]);
    }
    return;
  }

  if (!silent && !saveConnectionForm()) return;

  const connectionWarnings = validateAllVehicleConnections();
  if (connectionWarnings.length > 0) {
    if (!silent) {
      showConnectionWarning(connectionWarnings);
      alert('Connect Drones를 실행할 수 없습니다:\n- ' + connectionWarnings.join('\n- '));
    }
    return;
  }

  if (!silent) saveBackendUrl();
  if (!runtimeState.backendUrl) return;
  if (runtimeState.status !== 'BACKEND ONLINE') {
    if (!silent) setRuntimeStatus('ERROR', 'Backend is not online. Retry backend check first.');
    return;
  }

  runtimeState.droneRefreshInFlight = true;
  if (!silent) {
    runtimeState.dronesConnecting = true;
    markVehiclesConnecting();
    setRuntimeStatus('BACKEND ONLINE', 'Checking drone companion UDP PONG responses...');
  }

  try {
    const response = await fetch(`${runtimeState.backendUrl}/api/drones/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({ vehicles: buildDroneConnectionPayload() }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const connectionResult = await response.json();
    if (!connectionResult || connectionResult.ok !== true || !connectionResult.results) {
      throw new Error('Invalid drone connection response');
    }

    const results = normalizeDroneStatusResponse(connectionResult);
    applyDroneStatusResults(results);
    runtimeState.consecutiveDronePollingFailures = 0;
    const resultValues = Object.values(results);
    const connectedCount = resultValues.filter(
      (vehicle) => vehicle.companion_state === 'CONNECTED'
    ).length;
    if (!silent) {
      setRuntimeStatus(
        'BACKEND ONLINE',
        `Drone companion check complete: ${connectedCount}/${resultValues.length} companion connected.`
      );
      await refreshDroneStatus({ silent: true });
    } else {
      renderRuntimeConnection();
    }
  } catch (error) {
    runtimeState.consecutiveDronePollingFailures += 1;
    if (!silent || runtimeState.consecutiveDronePollingFailures >= 3) {
      for (const vehicle of getVehicles()) {
        runtimeState.vehicleConnections[vehicle.vehicle_id] = {
          vehicle_id: vehicle.vehicle_id,
          name: vehicle.name,
          role: vehicle.role,
          ip: vehicle.ip,
          udp_port: vehicle.udp_port,
          firmware_profile: vehicle.firmware_profile,
          connection_state: 'ERROR',
          companion_state: 'ERROR',
          fc_connected: 'UNKNOWN',
          last_seen_ms: null,
          last_fc_heartbeat_ms: null,
          position: null,
          gps: null,
          release_state: null,
          trigger_state: 'UNKNOWN',
          last_trigger_seq: null,
          last_trigger_state: 'UNKNOWN',
          last_trigger_reason: null,
          last_trigger_relationship_id: null,
          last_trigger_target_vehicle_id: null,
          last_trigger_completed_ms: null,
          rc_trigger_channel: null,
          rc_trigger_threshold: null,
          rc_trigger_active: null,
          rc_trigger_latched: null,
          emergency: null,
          last_emergency_action: null,
          last_emergency_result: null,
          last_emergency_reason: null,
          last_emergency_seq: null,
          last_emergency_command_ms: null,
          reason: 'request_failed',
          message: error.message,
        };
      }
      updateLiveDroneMarkers(runtimeState.vehicleConnections);
      renderMissionSummary();
      renderRuntimeConnection();
    }
    if (!silent) setRuntimeStatus('ERROR', `Drone companion check failed: ${error.message}`);
  } finally {
    runtimeState.droneRefreshInFlight = false;
    if (!silent) {
      runtimeState.dronesConnecting = false;
      renderRuntimeConnection();
    }
  }
}

function getVehicleConnection(vehicle) {
  return runtimeState.vehicleConnections[vehicle.vehicle_id] || {
    vehicle_id: vehicle.vehicle_id,
    name: vehicle.name,
    role: vehicle.role,
    ip: vehicle.ip,
    udp_port: vehicle.udp_port,
    firmware_profile: vehicle.firmware_profile,
    connection_state: 'UNKNOWN',
    companion_state: 'UNKNOWN',
    fc_connected: 'UNKNOWN',
    last_seen_ms: null,
    last_fc_heartbeat_ms: null,
    position: null,
    gps: null,
    release_state: null,
    trigger_state: 'UNKNOWN',
    last_trigger_seq: null,
    last_trigger_state: 'UNKNOWN',
    last_trigger_reason: null,
    last_trigger_relationship_id: null,
    last_trigger_target_vehicle_id: null,
    last_trigger_completed_ms: null,
    rc_trigger_channel: null,
    rc_trigger_threshold: null,
    rc_trigger_active: null,
    rc_trigger_latched: null,
    emergency: null,
    last_emergency_action: null,
    last_emergency_result: null,
    last_emergency_reason: null,
    last_emergency_seq: null,
    last_emergency_command_ms: null,
    reason: '',
    message: '',
  };
}

function isCarrierConnection(connection, vehicle) {
  const role = String(connection?.role || vehicle?.role || '').trim().toLowerCase();
  if (role === 'carrier') return true;

  const hasCarrierRuntimeFields = (
    connection?.release_state !== null && connection?.release_state !== undefined ||
    connection?.rc_trigger_latched !== null && connection?.rc_trigger_latched !== undefined ||
    connection?.rc_trigger_channel !== null && connection?.rc_trigger_channel !== undefined
  );

  if (hasCarrierRuntimeFields) return true;
  if (role === 'child') return false;
  return false;
}

function renderRuntimeConnection() {
  const statusBadge = document.getElementById('backendStatusBadge');
  const version = document.getElementById('backendVersion');
  const message = document.getElementById('backendMessage');
  const backendUrl = document.getElementById('backendUrl');
  const connectButton = document.getElementById('connectBackendBtn');
  const refreshDroneStatusButton = document.getElementById('refreshDroneStatusBtn');
  const connectDronesButton = document.getElementById('connectDronesBtn');
  const vehicleConnectionList = document.getElementById('vehicleConnectionList');
  const statusClass = {
    'BACKEND OFFLINE': 'is-offline',
    'BACKEND ONLINE': 'is-online',
    CONNECTING: 'is-connecting',
    ERROR: 'is-error',
  }[runtimeState.status] || 'is-error';

  statusBadge.className = `runtime-status ${statusClass}`;
  statusBadge.textContent = runtimeState.status;
  version.textContent = runtimeState.version
    ? `${runtimeState.service} ${runtimeState.version}`
    : 'not connected';
  message.textContent = runtimeState.message;
  backendUrl.value = runtimeState.backendUrl;
  backendUrl.disabled = runtimeState.status === 'CONNECTING';
  connectButton.disabled = runtimeState.status === 'CONNECTING';
  refreshDroneStatusButton.disabled = runtimeState.status !== 'BACKEND ONLINE';
  connectDronesButton.disabled =
    runtimeState.status !== 'BACKEND ONLINE' || runtimeState.dronesConnecting;
  syncDronePollingTimer();

  vehicleConnectionList.innerHTML = '';
  if (getVehicles().length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No vehicles yet. Add a vehicle first.';
    vehicleConnectionList.appendChild(empty);
    return;
  }

  for (const vehicle of getVehicles()) {
    const connection = getVehicleConnection(vehicle);
    const companionState = connection.companion_state || connection.connection_state || 'UNKNOWN';
    const fcState = connection.fc_connected || 'UNKNOWN';
    const statusClassName = {
      UNKNOWN: 'is-unknown',
      CONNECTING: 'is-connecting',
      CONNECTED: 'is-connected',
      OFFLINE: 'is-offline',
      ERROR: 'is-error',
    }[companionState] || 'is-error';
    const fcClassName = {
      UNKNOWN: 'is-unknown',
      CONNECTED: 'is-connected',
      DISCONNECTED: 'is-offline',
    }[fcState] || 'is-unknown';
    const detailLines = [
      ['Last seen', formatRuntimeTime(connection.last_seen_ms)],
      ['FC heartbeat', formatRuntimeTime(connection.last_fc_heartbeat_ms)],
    ];
    const gpsState = getGpsDisplayState(connection);

    detailLines.push(['GPS', formatGpsDisplayState(gpsState)]);

    if (gpsState.position) {
      detailLines.push(
        ['Position', `${formatNumber(gpsState.position.lat, 7)}, ${formatNumber(gpsState.position.lon, 7)}`],
        ['Rel Alt', gpsState.position.relative_alt_m === null ? '-' : `${formatNumber(gpsState.position.relative_alt_m, 1)} m`],
        ['Heading', gpsState.position.heading_deg === null ? '-' : `${formatNumber(gpsState.position.heading_deg, 1)} deg`]
      );
    }

    if (isCarrierConnection(connection, vehicle)) {
      detailLines.push(
        ['RC trigger condition', formatRcTriggerCondition(connection)],
        ['Release Input', connection.release_state || 'UNKNOWN'],
        ['RC Latched', formatRuntimeValue(connection.rc_trigger_latched)],
        ['Carrier Trigger', connection.trigger_state || 'UNKNOWN'],
        ['Child Delivery Result', connection.last_trigger_state || 'UNKNOWN'],
        ['Reason', connection.last_trigger_reason || connection.reason || '-'],
        ['Seq', formatRuntimeValue(connection.last_trigger_seq)],
        ['Target', formatRuntimeValue(connection.last_trigger_target_vehicle_id)]
      );
    } else {
      detailLines.push(
        ['Trigger Receive', connection.trigger_state || 'UNKNOWN'],
        ['FC Forward Result', connection.last_trigger_state || 'UNKNOWN'],
        ['Reason', connection.last_trigger_reason || connection.reason || '-'],
        ['Seq', formatRuntimeValue(connection.last_trigger_seq)]
      );
    }

    if (connection.last_emergency_action || connection.emergency?.last_action) {
      detailLines.push(
        ['Emergency', formatEmergencyHealth(connection)]
      );
    }

    const detailHtml = detailLines
      .map(([label, value]) => `<span>${escapeHtml(label)}: ${escapeHtml(value)}</span>`)
      .join('');
    const row = document.createElement('div');
    row.className = 'vehicle-connection-row';
    row.innerHTML = `
      <div class="vehicle-connection-name">
        <div>${escapeHtml(vehicle.name)} (${escapeHtml(vehicle.vehicle_id)})</div>
        <div class="vehicle-connection-meta">${escapeHtml(formatVehicleRole(vehicle.role))} · ${escapeHtml(vehicle.ip)}:${escapeHtml(vehicle.udp_port)}</div>
        <div class="vehicle-connection-details">
          ${detailHtml}
        </div>
      </div>
      <div class="vehicle-connection-badges">
        <span class="vehicle-connection-status ${statusClassName}" title="${escapeHtml(connection.message || '')}">Companion ${escapeHtml(companionState)}</span>
        <span class="vehicle-connection-status ${fcClassName}">FC ${escapeHtml(fcState)}</span>
      </div>
    `;
    vehicleConnectionList.appendChild(row);
  }
}

function syncSettingsToForm() {
  const s = state.qgcPlanSettings;
  document.getElementById('firmwareType').value = s.firmwareType;
  document.getElementById('vehicleType').value = s.vehicleType;
  document.getElementById('hoverSpeed').value = s.hoverSpeed;
  document.getElementById('cruiseSpeed').value = s.cruiseSpeed;
  document.getElementById('useFirstAsTakeoff').checked = !!s.useFirstAsTakeoff;
}

function saveQgcSettingsFromForm() {
  state.qgcPlanSettings.firmwareType = Number(document.getElementById('firmwareType').value);
  state.qgcPlanSettings.vehicleType = Number(document.getElementById('vehicleType').value);
  state.qgcPlanSettings.hoverSpeed = Number(document.getElementById('hoverSpeed').value);
  state.qgcPlanSettings.cruiseSpeed = Number(document.getElementById('cruiseSpeed').value);
  state.qgcPlanSettings.useFirstAsTakeoff = document.getElementById('useFirstAsTakeoff').checked;
  renderSanityCheck();
}

function nextAltitude(m) {
  if (m.waypoints.length > 0) return Number(m.waypoints[m.waypoints.length - 1].alt);
  const v = Number(document.getElementById('defaultAlt').value);
  return Number.isFinite(v) && v > 0 ? v : 10;
}

function addWaypoint(lat, lon) {
  const m = getSelectedMission();
  if (!m) {
    alert('Add a vehicle before adding waypoints.');
    return;
  }

  m.waypoints.push({
    seq: m.waypoints.length + 1,
    lat: round(lat, 7),
    lon: round(lon, 7),
    alt: nextAltitude(m),
    command: 'WAYPOINT',
    action: 'NONE',
  });
  m.uploadState = 'Editing';
  renderAll();
}

function deleteWaypoint(index) {
  const m = getSelectedMission();
  if (!m) return;

  const waypoint = m.waypoints[index];
  const relationships = getWaypointRelationships(m.vehicle_id, waypoint.seq);

  if (relationships.length > 0) {
    alert(`WP${waypoint.seq}를 trigger로 사용하는 relationship이 있어 삭제할 수 없습니다.`);
    return;
  }

  m.waypoints.splice(index, 1);
  for (const relationship of state.relationships) {
    if (
      relationship.trigger_vehicle_id === m.vehicle_id &&
      Number(relationship.trigger_waypoint_id) > waypoint.seq
    ) {
      relationship.trigger_waypoint_id = Number(relationship.trigger_waypoint_id) - 1;
    }
  }
  resequence(m);
  renderAll();
}

function clearSelectedMission() {
  const vehicle = getSelectedVehicle();
  const mission = getSelectedMission();
  if (!vehicle || !mission) return;

  if (mission.waypoints.length === 0) return;

  const relationships = state.relationships.filter(
    (relationship) => relationship.trigger_vehicle_id === vehicle.vehicle_id
  );
  if (relationships.length > 0) {
    alert(`${vehicle.name} waypoint를 trigger로 사용하는 relationship이 있어 삭제할 수 없습니다.`);
    return;
  }

  if (confirm(`${vehicle.name} waypoint를 모두 삭제할까요?`)) {
    mission.waypoints = [];
    mission.uploadState = 'Editing';
    renderAll();
  }
}

function resequence(m) {
  m.waypoints.forEach((wp, idx) => wp.seq = idx + 1);
  m.uploadState = 'Editing';
}

function renderWaypointRows() {
  const tbody = document.getElementById('waypointRows');
  const mission = getSelectedMission();
  const vehicle = getSelectedVehicle();

  tbody.innerHTML = '';

  if (!mission || !vehicle) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="5" class="empty-state">No vehicle selected.</td>';
    tbody.appendChild(tr);
    return;
  }

  mission.waypoints.forEach((wp, idx) => {
    const tr = document.createElement('tr');

    const select = document.createElement('select');
    select.dataset.field = 'action';
    select.dataset.idx = idx;
    select.disabled = normalizeVehicleRole(vehicle.role) !== 'carrier';

    const actionOptions = [
      ['NONE', 'NONE'],
      ['RELEASE', 'RELEASE'],
    ];

    if (wp.action && !actionOptions.some(([value]) => value === wp.action)) {
      actionOptions.push([wp.action, wp.action]);
    }

    for (const [value, label] of actionOptions) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      if (wp.action === value) opt.selected = true;
      select.appendChild(opt);
    }

    tr.innerHTML = `
      <td>${wp.seq}</td>
      <td class="latlon">${wp.lat.toFixed(7)}<br>${wp.lon.toFixed(7)}</td>
      <td><input class="small" type="number" step="1" value="${wp.alt}" data-idx="${idx}" data-field="alt" /></td>
      <td class="action-cell"></td>
      <td><button data-delete="${idx}">삭제</button></td>
    `;

    tr.querySelector('.action-cell').appendChild(select);
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('input[data-field="alt"]').forEach(input => {
    input.addEventListener('change', (e) => {
      const idx = Number(e.target.dataset.idx);
      const alt = Number(e.target.value);

      if (Number.isFinite(alt)) {
        mission.waypoints[idx].alt = alt;
        mission.uploadState = 'Editing';
        renderAll();
      }
    });
  });

  tbody.querySelectorAll('select[data-field="action"]').forEach(sel => {
    sel.addEventListener('change', (e) => {
      const idx = Number(e.target.dataset.idx);
      mission.waypoints[idx].action = e.target.value;
      mission.uploadState = 'Editing';
      renderAll();
    });
  });

  tbody.querySelectorAll('button[data-delete]').forEach(btn => {
    btn.addEventListener('click', (e) => deleteWaypoint(Number(e.target.dataset.delete)));
  });
}


function renderMapItems() {
  for (const layer of Object.values(markers).flat()) map.removeLayer(layer);
  for (const layer of Object.values(polylines)) map.removeLayer(layer);

  markers = {};
  polylines = {};

  for (const vehicle of getVehicles()) {
    const mission = getMissionByVehicleId(vehicle.vehicle_id);
    markers[vehicle.vehicle_id] = [];

    const latlngs = [];

    mission.waypoints.forEach(wp => {
      const ll = [wp.lat, wp.lon];
      latlngs.push(ll);

      const marker = L.circleMarker(ll, {
        radius: vehicle.vehicle_id === state.selectedVehicleId ? 8 : 6,
        color: vehicle.color,
        fillColor: vehicle.color,
        fillOpacity: vehicle.vehicle_id === state.selectedVehicleId ? 0.95 : 0.55,
        weight: vehicle.vehicle_id === state.selectedVehicleId ? 3 : 2,
      }).addTo(map);

      const action = wp.action && wp.action !== 'NONE'
        ? `<br><b>${escapeHtml(wp.action)}</b>`
        : '';
      marker.bindPopup(
        `${escapeHtml(vehicle.name)} WP${wp.seq}<br>Alt ${wp.alt} m${action}`
      );
      markers[vehicle.vehicle_id].push(marker);
    });

    if (latlngs.length >= 2) {
      polylines[vehicle.vehicle_id] = L.polyline(latlngs, {
        color: vehicle.color,
        weight: vehicle.vehicle_id === state.selectedVehicleId ? 4 : 2,
        opacity: vehicle.vehicle_id === state.selectedVehicleId ? 0.95 : 0.45,
      }).addTo(map);
    }
  }
}

function normalizeLivePosition(position) {
  if (!position) return null;

  const lat = Number(position.lat);
  const lon = Number(position.lon);
  const fixType = position.fix_type === null || position.fix_type === undefined
    ? null
    : Number(position.fix_type);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat === 0 || lon === 0) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  if (fixType !== null && !Number.isFinite(fixType)) return null;

  return {
    lat,
    lon,
    alt_m: toOptionalNumber(position.alt_m),
    relative_alt_m: toOptionalNumber(position.relative_alt_m),
    heading_deg: toOptionalNumber(position.heading_deg),
    fix_type: fixType,
    satellites_visible: toOptionalNumber(position.satellites_visible),
    eph: toOptionalNumber(position.eph),
    epv: toOptionalNumber(position.epv),
    timestamp_ms: toOptionalNumber(position.timestamp_ms),
  };
}

function toOptionalNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function getGpsDisplayState(status) {
  const position = normalizeLivePosition(status?.position);
  const gps = status?.gps && typeof status.gps === 'object' ? status.gps : null;

  if (!status?.position) {
    return { state: 'NO POSITION', position: null, gps, reason: 'position_missing' };
  }

  if (!position) {
    return { state: 'INVALID', position: null, gps, reason: 'position_invalid' };
  }

  if (gps?.valid === true) {
    return { state: 'LIVE', position, gps, reason: 'gps_valid' };
  }

  if (gps?.valid === false) {
    return { state: 'STALE', position, gps, reason: getGpsInvalidReason(gps) };
  }

  if (position.fix_type !== null && position.fix_type < 3) {
    return { state: 'INVALID', position: null, gps, reason: 'fix_type_below_3' };
  }

  return { state: 'UNKNOWN', position, gps, reason: 'gps_status_missing' };
}

function getGpsInvalidReason(gps) {
  if (!gps) return 'gps_status_missing';
  if (gps.has_position === false) return 'position_missing';
  if (gps.fix_type !== null && gps.fix_type !== undefined && Number(gps.fix_type) < 3) {
    return 'fix_type_below_3';
  }
  if (
    gps.position_age_ms !== null &&
    gps.position_age_ms !== undefined &&
    gps.stale_ms !== null &&
    gps.stale_ms !== undefined &&
    Number(gps.position_age_ms) > Number(gps.stale_ms)
  ) {
    return 'position_stale';
  }
  return 'gps_invalid';
}

function formatGpsDisplayState(gpsState) {
  const gps = gpsState.gps || {};
  const parts = [
    gpsState.state,
    `FIX ${formatRuntimeValue(gps.fix_type ?? gpsState.position?.fix_type)}`,
    `Sat ${formatRuntimeValue(gps.satellites_visible ?? gpsState.position?.satellites_visible)}`,
  ];

  if (gps.position_age_ms !== null && gps.position_age_ms !== undefined) {
    parts.push(`Age ${formatRuntimeValue(gps.position_age_ms)} ms`);
  }

  if (gpsState.state !== 'LIVE' && gpsState.reason) {
    parts.push(gpsState.reason);
  }

  return parts.join(' / ');
}

function updateLiveDroneMarkers(runtimeStatuses = runtimeState.vehicleConnections) {
  debugLiveMarker('[live] runtimeStatuses', runtimeStatuses);
  const activeVehicleIds = new Set(Object.keys(runtimeStatuses));
  const vehiclesById = new Map(getVehicles().map((vehicle) => [vehicle.vehicle_id, vehicle]));

  for (const [vehicleId, status] of Object.entries(runtimeStatuses)) {
    debugLiveMarker('[live] vehicle', vehicleId, status);
    debugLiveMarker('[live] raw position', status?.position);
    const vehicle = vehiclesById.get(vehicleId) || {
      vehicle_id: vehicleId,
      name: status?.name || vehicleId,
      role: status?.role || 'unknown',
      color: '#60a5fa',
    };
    const gpsState = getGpsDisplayState(status);
    const position = gpsState.position;
    debugLiveMarker('[live] gps state', gpsState);
    const existingMarker = liveDroneMarkers.get(vehicleId);

    if (!position) {
      if (existingMarker) {
        map.removeLayer(existingMarker);
        liveDroneMarkers.delete(vehicleId);
      }
      continue;
    }

    const latLng = [position.lat, position.lon];
    debugLiveMarker('[live] create/update marker', vehicleId, latLng);

    if (existingMarker) {
      existingMarker.setLatLng(latLng);
      existingMarker.setIcon(buildLiveDroneIcon(vehicle, gpsState));
      existingMarker.bindPopup(buildLiveDronePopup(vehicle, gpsState));
    } else {
      const marker = L.marker(latLng, {
        icon: buildLiveDroneIcon(vehicle, gpsState),
        zIndexOffset: 1000,
      }).addTo(map);
      marker.bindPopup(buildLiveDronePopup(vehicle, gpsState));
      liveDroneMarkers.set(vehicleId, marker);
    }
  }

  for (const [vehicleId, marker] of liveDroneMarkers.entries()) {
    if (!activeVehicleIds.has(vehicleId)) {
      map.removeLayer(marker);
      liveDroneMarkers.delete(vehicleId);
    }
  }
  debugLiveMarker('[live] marker count', liveDroneMarkers.size);
}

function getLivePositionForVehicle(vehicleId) {
  const status = runtimeState.vehicleConnections[vehicleId];
  return getGpsDisplayState(status).position;
}

function focusSelectedLiveDrone() {
  const vehicle = getSelectedVehicle();
  if (!vehicle) {
    alert('Select a vehicle first.');
    return;
  }

  const position = getLivePositionForVehicle(vehicle.vehicle_id);
  if (!position) {
    alert(`${vehicle.name} has no usable GPS position yet.`);
    return;
  }

  const marker = liveDroneMarkers.get(vehicle.vehicle_id);
  map.setView([position.lat, position.lon], Math.max(map.getZoom(), 17), {
    animate: true,
  });

  if (marker) {
    marker.openPopup();
  }
}

function fitLiveDroneMarkers() {
  const latLngs = [...liveDroneMarkers.values()]
    .filter((marker) => map.hasLayer(marker))
    .map((marker) => marker.getLatLng());

  if (latLngs.length === 0) {
    alert('No live drone GPS markers to fit.');
    return;
  }

  if (latLngs.length === 1) {
    map.setView(latLngs[0], Math.max(map.getZoom(), 17), {
      animate: true,
    });
    return;
  }

  map.fitBounds(L.latLngBounds(latLngs), {
    padding: [40, 40],
    maxZoom: 18,
  });
}

function debugLiveMarker(...args) {
  if (window.__liveMarkerDebugEnabled === true) {
    console.log(...args);
  }
}

function debugLiveMarkerSnapshot() {
  console.log('[live] debug enabled');
  console.log('[live] backend status', runtimeState.status);
  console.log('[live] vehicles', getVehicles());
  console.log('[live] runtimeState.vehicleConnections', runtimeState.vehicleConnections);
  updateLiveDroneMarkers(runtimeState.vehicleConnections);
  console.log('[live] marker count', liveDroneMarkers.size);
  return {
    backendStatus: runtimeState.status,
    vehicleCount: getVehicles().length,
    connectionKeys: Object.keys(runtimeState.vehicleConnections),
    markerCount: liveDroneMarkers.size,
  };
}

Object.defineProperty(window, 'liveMarkerDebug', {
  configurable: true,
  get() {
    return window.__liveMarkerDebugEnabled === true;
  },
  set(value) {
    window.__liveMarkerDebugEnabled = value === true;
    if (window.__liveMarkerDebugEnabled) {
      debugLiveMarkerSnapshot();
    }
  },
});

window.debugLiveMarkers = debugLiveMarkerSnapshot;

function buildLiveDroneIcon(vehicle, gpsState) {
  const isSelected = vehicle.vehicle_id === state.selectedVehicleId;
  const color = vehicle.color || '#60a5fa';
  const position = gpsState.position;
  const heading = position.heading_deg ?? 0;
  const stateClassName = ` live-drone-marker--${gpsState.state.toLowerCase().replaceAll(' ', '-')}`;
  const className = `live-drone-marker${stateClassName}${isSelected ? ' live-drone-marker--selected' : ''}`;
  const html = `
    <div class="${className}" style="--vehicle-color:${escapeHtml(color)}; transform: rotate(${escapeHtml(heading)}deg);">
      <div class="live-drone-marker-heading"></div>
      <div class="live-drone-marker-state">${escapeHtml(gpsState.state === 'LIVE' ? 'L' : 'S')}</div>
    </div>
  `;

  return L.divIcon({
    className: 'live-drone-marker-icon',
    html,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });
}

function buildLiveDronePopup(vehicle, gpsState) {
  const position = gpsState.position;
  const altitude = position.relative_alt_m !== null
    ? `${formatNumber(position.relative_alt_m, 1)} m rel`
    : position.alt_m !== null
      ? `${formatNumber(position.alt_m, 1)} m`
      : '-';

  return `
    <b>${escapeHtml(vehicle.name || vehicle.vehicle_id)}</b><br>
    GPS: ${escapeHtml(formatGpsDisplayState(gpsState))}<br>
    Lat/Lon: ${escapeHtml(formatNumber(position.lat, 7))}, ${escapeHtml(formatNumber(position.lon, 7))}<br>
    GPS fix: ${escapeHtml(formatRuntimeValue(position.fix_type))}<br>
    Sat: ${escapeHtml(formatRuntimeValue(position.satellites_visible))}<br>
    Alt: ${escapeHtml(altitude)}<br>
    Heading: ${escapeHtml(position.heading_deg === null ? '-' : `${formatNumber(position.heading_deg, 1)} deg`)}
  `;
}

function formatNumber(value, digits) {
  if (!Number.isFinite(Number(value))) return '-';
  return Number(value).toFixed(digits);
}

function renderMissionSummary() {
  const m = getSelectedMission();
  const selectedVehicle = getSelectedVehicle();
  const liveMarkerCount = [...liveDroneMarkers.values()]
    .filter((marker) => map.hasLayer(marker))
    .length;

  document.getElementById('wpCount').value = m ? m.waypoints.length : 0;
  document.getElementById('missionState').value = m ? m.uploadState : 'No vehicle';
  document.getElementById('exportQgcBtn').disabled = !m;
  document.getElementById('clearMissionBtn').disabled = !m || m.waypoints.length === 0;
  document.getElementById('focusSelectedBtn').disabled =
    !selectedVehicle || !getLivePositionForVehicle(selectedVehicle.vehicle_id);
  document.getElementById('fitLiveDronesBtn').disabled = liveMarkerCount === 0;
}

function generateRelationshipId() {
  let index = state.relationships.length + 1;
  let relationshipId = `relationship_${String(index).padStart(2, '0')}`;

  while (
    state.relationships.some(
      (relationship) => relationship.relationship_id === relationshipId
    )
  ) {
    index += 1;
    relationshipId = `relationship_${String(index).padStart(2, '0')}`;
  }

  return relationshipId;
}

function getNextRelationshipOrder(triggerVehicleId, triggerWaypointId, relationships = state.relationships) {
  const orders = relationships
    .filter(
      (relationship) =>
        relationship.trigger_vehicle_id === triggerVehicleId &&
        Number(relationship.trigger_waypoint_id) === Number(triggerWaypointId)
    )
    .map((relationship) => Number(relationship.order))
    .filter(Number.isInteger);

  return orders.length ? Math.max(...orders) + 1 : 1;
}

function requiresReleaseBeforeStart(targetVehicle) {
  return (
    normalizeVehicleRole(targetVehicle.role) === 'child' ||
    targetVehicle.firmware_profile === 'px4_nav_ready_gate'
  );
}

// Gate START_MISSION means a Navigation Ready Gate trigger, not direct AUTO_MISSION entry.
function hasPriorRelease(relationships, candidate) {
  return relationships.some(
    (relationship) =>
      relationship.trigger_vehicle_id === candidate.trigger_vehicle_id &&
      relationship.target_vehicle_id === candidate.target_vehicle_id &&
      relationship.action_type === 'RELEASE' &&
      (
        Number(relationship.trigger_waypoint_id) <
          Number(candidate.trigger_waypoint_id) ||
        (
          Number(relationship.trigger_waypoint_id) ===
            Number(candidate.trigger_waypoint_id) &&
          Number(relationship.order) < Number(candidate.order)
        )
      )
  );
}

function getStartMissionSequenceError(relationships, candidate, vehicles = getVehicles()) {
  if (candidate.action_type !== 'START_MISSION') return null;

  const targetVehicle = vehicles.find(
    (vehicle) => vehicle.vehicle_id === candidate.target_vehicle_id
  );
  if (!targetVehicle || !requiresReleaseBeforeStart(targetVehicle)) return null;

  if (!hasPriorRelease(relationships, candidate)) {
    return `${targetVehicle.name} START_MISSION은 선행 RELEASE 이후에만 추가할 수 있습니다.`;
  }

  return null;
}

function renderRelationshipEditor() {
  const mission = getSelectedMission();
  const selectedVehicle = getSelectedVehicle();
  const waypointSelect = document.getElementById('relationshipTriggerWaypoint');
  const targetSelect = document.getElementById('relationshipTargetVehicle');
  const actionSelect = document.getElementById('relationshipActionType');
  const addButton = document.getElementById('addRelationshipBtn');

  waypointSelect.innerHTML = '';
  targetSelect.innerHTML = '';

  if (!mission || !selectedVehicle) {
    waypointSelect.disabled = true;
    targetSelect.disabled = true;
    actionSelect.disabled = true;
    addButton.disabled = true;
    return;
  }

  for (const waypoint of mission.waypoints) {
    const option = document.createElement('option');
    option.value = waypoint.seq;
    option.textContent = `WP${waypoint.seq}`;
    waypointSelect.appendChild(option);
  }

  for (const vehicle of getVehicles()) {
    if (vehicle.vehicle_id === selectedVehicle.vehicle_id) continue;

    const option = document.createElement('option');
    option.value = vehicle.vehicle_id;
    option.textContent = `${vehicle.name} (${vehicle.vehicle_id})`;
    targetSelect.appendChild(option);
  }

  const canAdd = waypointSelect.options.length > 0 && targetSelect.options.length > 0;
  waypointSelect.disabled = waypointSelect.options.length === 0;
  targetSelect.disabled = targetSelect.options.length === 0;
  actionSelect.disabled = !canAdd;
  addButton.disabled = !canAdd;
}

function addRelationshipFromForm(event) {
  event.preventDefault();

  const triggerVehicle = getSelectedVehicle();
  if (!triggerVehicle) {
    alert('Add a vehicle before adding relationships.');
    return;
  }

  const triggerWaypointId = Number(
    document.getElementById('relationshipTriggerWaypoint').value
  );
  const targetVehicleId = document.getElementById('relationshipTargetVehicle').value;
  const actionType = document.getElementById('relationshipActionType').value;
  const mission = getSelectedMission();
  if (!mission) return;

  if (!mission.waypoints.some((waypoint) => waypoint.seq === triggerWaypointId)) {
    alert('유효한 trigger waypoint를 선택하세요.');
    return;
  }

  if (!targetVehicleId || targetVehicleId === triggerVehicle.vehicle_id) {
    alert('다른 target vehicle을 선택하세요.');
    return;
  }

  if (!getVehicleById(targetVehicleId)) {
    alert('선택한 target vehicle이 존재하지 않습니다.');
    return;
  }

  if (!RELATIONSHIP_ACTION_TYPES.includes(actionType)) {
    alert('유효한 action type을 선택하세요.');
    return;
  }

  const duplicate = state.relationships.some(
    (relationship) =>
      relationship.trigger_vehicle_id === triggerVehicle.vehicle_id &&
      Number(relationship.trigger_waypoint_id) === triggerWaypointId &&
      relationship.action_type === actionType &&
      relationship.target_vehicle_id === targetVehicleId
  );
  if (duplicate) {
    alert('동일한 relationship이 이미 존재합니다.');
    return;
  }

  const relationship = {
    relationship_id: generateRelationshipId(),
    trigger_vehicle_id: triggerVehicle.vehicle_id,
    trigger_waypoint_id: triggerWaypointId,
    order: getNextRelationshipOrder(triggerVehicle.vehicle_id, triggerWaypointId),
    action_type: actionType,
    target_vehicle_id: targetVehicleId,
  };

  const sequenceError = getStartMissionSequenceError(
    state.relationships,
    relationship
  );
  if (sequenceError) {
    alert(sequenceError);
    return;
  }

  state.relationships.push(relationship);

  renderAll();
}

function deleteRelationship(relationshipId) {
  const deleted = state.relationships.find(
    (relationship) => relationship.relationship_id === relationshipId
  );
  state.relationships = state.relationships.filter(
    (relationship) => relationship.relationship_id !== relationshipId
  );

  if (deleted) {
    state.relationships
      .filter(
        (relationship) =>
          relationship.trigger_vehicle_id === deleted.trigger_vehicle_id &&
          Number(relationship.trigger_waypoint_id) ===
            Number(deleted.trigger_waypoint_id)
      )
      .sort((a, b) => Number(a.order) - Number(b.order))
      .forEach((relationship, index) => {
        relationship.order = index + 1;
      });
  }

  renderAll();
}

function renderRelationshipList() {
  const list = document.getElementById('relationshipList');
  list.innerHTML = '';

  if (state.relationships.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = '등록된 relationship이 없습니다.';
    list.appendChild(empty);
    return;
  }

  const relationships = [...state.relationships].sort(
    (a, b) =>
      a.trigger_vehicle_id.localeCompare(b.trigger_vehicle_id) ||
      Number(a.trigger_waypoint_id) - Number(b.trigger_waypoint_id) ||
      Number(a.order) - Number(b.order)
  );

  for (const relationship of relationships) {
    const triggerVehicle = getVehicleById(relationship.trigger_vehicle_id);
    const targetVehicle = getVehicleById(relationship.target_vehicle_id);
    const isNavigationReadyGate =
      relationship.action_type === 'START_MISSION' &&
      targetVehicle?.firmware_profile === 'px4_nav_ready_gate';
    const card = document.createElement('div');
    card.className = 'relationship-card';
    card.innerHTML = `
      <div class="relationship-card-head">
        <div class="relationship-card-title">#${escapeHtml(relationship.order)} ${escapeHtml(relationship.action_type)}</div>
        <button class="danger" type="button">삭제</button>
      </div>
      <div class="kv">
        <span>Trigger</span>
        <span>${escapeHtml(triggerVehicle?.name || relationship.trigger_vehicle_id)} WP${escapeHtml(relationship.trigger_waypoint_id)}</span>
      </div>
      <div class="kv">
        <span>Target</span>
        <span>${escapeHtml(targetVehicle?.name || relationship.target_vehicle_id)}</span>
      </div>
      ${isNavigationReadyGate
        ? '<div class="relationship-meaning">Navigation Ready Gate trigger (AUTO_MISSION 직접 진입 아님)</div>'
        : ''}
    `;

    card.querySelector('button').addEventListener('click', () => {
      deleteRelationship(relationship.relationship_id);
    });
    list.appendChild(card);
  }
}

function sanityCheckMission(mission, vehicle = getSelectedVehicle()) {
  const errors = [];
  const warnings = [];

  if (!mission || !vehicle) {
    errors.push('vehicle이 없습니다. Add Vehicle로 먼저 등록하세요.');
    return { errors, warnings };
  }

  if (mission.waypoints.length === 0) errors.push('waypoint가 없습니다. QGC .plan export 불가.');

  for (const wp of mission.waypoints) {
    if (!Number.isFinite(wp.lat) || wp.lat < -90 || wp.lat > 90) errors.push(`WP${wp.seq}: latitude 범위 오류`);
    if (!Number.isFinite(wp.lon) || wp.lon < -180 || wp.lon > 180) errors.push(`WP${wp.seq}: longitude 범위 오류`);
    if (!Number.isFinite(Number(wp.alt))) errors.push(`WP${wp.seq}: altitude 숫자 아님`);
    if (Number(wp.alt) <= 0) warnings.push(`WP${wp.seq}: altitude가 0 이하입니다.`);
  }

  if (vehicle && normalizeVehicleRole(vehicle.role) === 'carrier') {
    const releases = mission.waypoints.filter(wp => wp.action && wp.action.startsWith('RELEASE'));
    if (releases.length === 0) warnings.push('carrier mission에 release action이 없습니다.');
  }

  return { errors, warnings };
}

function renderSanityCheck() {
  const mission = getSelectedMission();
  const vehicle = getSelectedVehicle();
  const { errors, warnings } = sanityCheckMission(mission, vehicle);

  const lines = [];

  lines.push(`Selected: ${vehicle ? vehicle.name : 'None'}`);
  lines.push(`SYSID: ${vehicle ? vehicle.sysid : '-'}`);
  lines.push(`UDP: ${vehicle ? `${vehicle.ip}:${vehicle.udp_port}` : '-'}`);
  lines.push(`Waypoints: ${mission ? mission.waypoints.length : 0}`);
  lines.push(`QGC export: ${errors.length ? 'BLOCKED' : 'READY'}`);

  if (errors.length) lines.push('\nErrors:\n- ' + errors.join('\n- '));
  if (warnings.length) lines.push('\nWarnings:\n- ' + warnings.join('\n- '));
  if (!errors.length && !warnings.length) lines.push('\nNo local sanity issue. QGC에서 .plan을 열어 최종 확인하십시오.');

  document.getElementById('sanityBox').textContent = lines.join('\n');
}

function buildQgcPlan(m) {
  const settings = state.qgcPlanSettings;
  const items = m.waypoints.map((wp, idx) => {
    const isTakeoff = idx === 0 && settings.useFirstAsTakeoff;
    const command = isTakeoff ? COMMAND.MAV_CMD_NAV_TAKEOFF : COMMAND.MAV_CMD_NAV_WAYPOINT;
    return {
      AMSLAltAboveTerrain: null,
      Altitude: Number(wp.alt),
      AltitudeMode: 0,
      autoContinue: true,
      command,
      doJumpId: idx + 1,
      frame: COMMAND.MAV_FRAME_GLOBAL_RELATIVE_ALT,
      params: [
        0,
        0,
        0,
        null,
        Number(wp.lat),
        Number(wp.lon),
        Number(wp.alt)
      ],
      type: 'SimpleItem'
    };
  });

  const first = m.waypoints[0];
  const home = first ? [Number(first.lat), Number(first.lon), 0] : [0, 0, 0];
  return {
    fileType: 'Plan',
    geoFence: { circles: [], polygons: [], version: 2 },
    groundStation: 'QGroundControl',
    mission: {
      cruiseSpeed: Number(settings.cruiseSpeed),
      firmwareType: Number(settings.firmwareType),
      globalPlanAltitudeMode: Number(settings.globalPlanAltitudeMode),
      hoverSpeed: Number(settings.hoverSpeed),
      items,
      plannedHomePosition: home,
      vehicleType: Number(settings.vehicleType),
      version: 2
    },
    rallyPoints: { points: [], version: 2 },
    version: 1
  };
}

function exportSelectedQgcPlan() {
  const mission = getSelectedMission();
  const vehicle = getSelectedVehicle();
  if (!mission || !vehicle) {
    alert('QGC .plan export 불가: vehicle을 먼저 추가하세요.');
    return;
  }

  const { errors } = sanityCheckMission(mission, vehicle);

  if (errors.length) {
    alert('QGC .plan export 불가:\n- ' + errors.join('\n- '));
    return;
  }

  const plan = buildQgcPlan(mission);
  downloadJson(`${vehicle.name}.plan`, plan);
}

function exportPackageJson() {
  const {
    version,
    vehicles,
    missions,
    relationships,
    qgcPlanSettings,
  } = state;

  downloadJson('fleet_mission_package.json', {
    version,
    vehicles,
    missions,
    relationships,
    qgcPlanSettings,
  });
}

function normalizeImportedMissionPackage(imported) {
  const warnings = [];

  if (!imported || typeof imported !== 'object') return warnings;

  for (const vehicle of Array.isArray(imported.vehicles) ? imported.vehicles : []) {
    if (!vehicle.firmware_profile) {
      vehicle.firmware_profile = 'standard_px4';
      warnings.push(`${vehicle.name || vehicle.vehicle_id}: firmware_profile을 standard_px4로 보정했습니다.`);
    }
  }

  const groups = new Map();
  const relationships = Array.isArray(imported.relationships)
    ? imported.relationships
    : [];
  relationships.forEach((relationship, index) => {
    const key =
      `${relationship.trigger_vehicle_id}::${relationship.trigger_waypoint_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ relationship, index });
  });

  for (const group of groups.values()) {
    group.sort((a, b) => {
      const aOrder = Number(a.relationship.order);
      const bOrder = Number(b.relationship.order);
      const aValid = Number.isInteger(aOrder) && aOrder > 0;
      const bValid = Number.isInteger(bOrder) && bOrder > 0;

      if (aValid && bValid && aOrder !== bOrder) return aOrder - bOrder;
      if (aValid !== bValid) return aValid ? -1 : 1;
      return a.index - b.index;
    });

    group.forEach(({ relationship }, index) => {
      const normalizedOrder = index + 1;
      if (relationship.order !== normalizedOrder) {
        relationship.order = normalizedOrder;
        warnings.push(
          `${relationship.relationship_id || 'relationship'}: order를 ${normalizedOrder}(으)로 보정했습니다.`
        );
      }
    });
  }

  return warnings;
}

function getRelationshipSequenceErrors(relationships, vehicles) {
  return relationships
    .map((relationship) =>
      getStartMissionSequenceError(relationships, relationship, vehicles)
    )
    .filter(Boolean);
}

function isValidMissionPackage(imported) {
  if (
    !imported ||
    !Array.isArray(imported.vehicles) ||
    !Array.isArray(imported.missions) ||
    !Array.isArray(imported.relationships) ||
    !imported.qgcPlanSettings ||
    typeof imported.qgcPlanSettings !== 'object' ||
    Array.isArray(imported.qgcPlanSettings)
  ) {
    return false;
  }

  const vehicleIds = new Set(imported.vehicles.map((vehicle) => vehicle.vehicle_id));
  if (vehicleIds.size !== imported.vehicles.length || vehicleIds.has(undefined)) return false;

  for (const vehicle of imported.vehicles) {
    if (
      Object.prototype.hasOwnProperty.call(vehicle, 'waypoints') ||
      !FIRMWARE_PROFILES.includes(vehicle.firmware_profile) ||
      (vehicle.parent_vehicle_id !== null && !vehicleIds.has(vehicle.parent_vehicle_id))
    ) {
      return false;
    }

    const ancestors = new Set([vehicle.vehicle_id]);
    let parentId = vehicle.parent_vehicle_id;

    while (parentId !== null) {
      if (ancestors.has(parentId)) return false;
      ancestors.add(parentId);
      parentId = imported.vehicles.find((item) => item.vehicle_id === parentId).parent_vehicle_id;
    }
  }

  const missionsAreValid = imported.missions.every((mission) =>
    vehicleIds.has(mission.vehicle_id) &&
    Array.isArray(mission.waypoints) &&
    !['name', 'role', 'ip', 'udp_port', 'sysid'].some((field) =>
      Object.prototype.hasOwnProperty.call(mission, field)
    )
  );
  if (!missionsAreValid) return false;

  const relationshipIds = new Set();
  for (const relationship of imported.relationships) {
    if (
      !relationship.relationship_id ||
      relationshipIds.has(relationship.relationship_id) ||
      !vehicleIds.has(relationship.trigger_vehicle_id) ||
      !vehicleIds.has(relationship.target_vehicle_id) ||
      relationship.trigger_vehicle_id === relationship.target_vehicle_id ||
      !RELATIONSHIP_ACTION_TYPES.includes(relationship.action_type) ||
      !Number.isInteger(Number(relationship.order)) ||
      Number(relationship.order) < 1
    ) {
      return false;
    }

    const triggerMission = imported.missions.find(
      (mission) => mission.vehicle_id === relationship.trigger_vehicle_id
    );
    const triggerWaypointId = Number(relationship.trigger_waypoint_id);
    if (
      !Number.isInteger(triggerWaypointId) ||
      !triggerMission ||
      !triggerMission.waypoints.some(
        (waypoint) => Number(waypoint.seq) === triggerWaypointId
      )
    ) {
      return false;
    }

    relationshipIds.add(relationship.relationship_id);
  }

  return true;
}

function importPackageJson(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      const warnings = normalizeImportedMissionPackage(imported);
      if (!isValidMissionPackage(imported)) throw new Error('mission package 형식이 아닙니다.');

      const sequenceErrors = getRelationshipSequenceErrors(
        imported.relationships,
        imported.vehicles
      );
      if (sequenceErrors.length > 0) {
        throw new Error(
          `Navigation Ready Gate 순서 오류:\n- ${sequenceErrors.join('\n- ')}`
        );
      }

      state = imported;
      state.vehicles = state.vehicles.map(stripRuntimeFieldsFromVehicle);
      state.selectedVehicleId = state.vehicles[0]?.vehicle_id || null;
      syncSettingsToForm();
      renderAll();
      saveVehicleConfigs({ silent: true });
      if (warnings.length > 0) {
        alert(`불러오기 보정:\n- ${warnings.join('\n- ')}`);
      }
    } catch (err) {
      alert('불러오기 실패: ' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function round(value, digits) {
  const f = Math.pow(10, digits);
  return Math.round(value * f) / f;
}

function formatRuntimeTime(value) {
  if (!value) return '-';
  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleTimeString();
}

function formatRuntimeValue(value) {
  return value === null || value === undefined || value === '' ? '-' : value;
}

function formatRcTriggerCondition(connection) {
  const state = connection.rc_trigger_active === true
    ? 'ACTIVE'
    : connection.rc_trigger_active === false
      ? 'IDLE'
      : 'UNKNOWN';
  const channel = connection.rc_trigger_channel;
  const threshold = connection.rc_trigger_threshold;

  if (channel !== null && channel !== undefined && threshold !== null && threshold !== undefined) {
    return `${state} (CH${channel} >= ${threshold})`;
  }

  return state;
}

function formatEmergencyHealth(connection) {
  const emergency = connection.emergency || {};
  const action = connection.last_emergency_action || emergency.last_action || '-';
  const result = connection.last_emergency_result || emergency.last_result || '-';
  const reason = connection.last_emergency_reason || emergency.last_reason || '-';
  const seq = connection.last_emergency_seq || emergency.last_seq;

  return `${action} / ${result} / ${reason}${seq ? ` / seq ${seq}` : ''}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function initializeApp() {
  syncSettingsToForm();
  renderAll();
  startBackendHealthMonitor();
  await loadVehicleConfigs();
}

initializeApp();
