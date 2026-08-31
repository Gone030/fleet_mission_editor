const INITIAL_MISSION_PACKAGE = {
  version: 1,
  vehicles: [],
  missions: [],
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
  message: 'Backend status, companion UDP status, mission control, trigger, and emergency actions are available when configured.',
  vehicleConnections: {},
  lastTriggerSeenAtMs: {},
  dronesConnecting: false,
  backendCheckInFlight: false,
  healthMonitorId: null,
  dronePollingTimer: null,
  droneRefreshInFlight: false,
  consecutiveDronePollingFailures: 0,
  emergencyInFlight: false,
  emergencyResult: null,
  debugChildKillInFlight: false,
  debugChildKillResult: null,
  debugChildKillTargetVehicleId: null,
  debugChildLandInFlight: false,
  debugChildLandResult: null,
  manualReleaseTriggerState: 'IDLE',
  manualReleaseTriggerResult: null,
  runtimeResetState: 'IDLE',
  runtimeResetResult: null,
  missionClearState: 'IDLE',
  missionClearResult: null,
  actionPlanUploadState: 'IDLE',
  actionPlanUploadResult: null,
  missionStartState: 'IDLE',
  missionStartResult: null,
  vehicleSaveStatus: 'Vehicles not loaded',
  vehicleSaveStatusKind: '',
  vehicleSaveInFlight: false,
  linkTestRunning: false,
  lastLinkTestResult: null,
  missionResultVehicleId: null,
  missionResultHtml: '',
};

const NAV_GATE_DIAGNOSTIC_LABELS = {
  attitude_stable: 'Attitude stable',
  armed: 'Armed',
  offboard_active: 'Offboard active',
  z_valid: 'Z valid',
  v_z_valid: 'VZ valid',
  vertical_speed_stable: '|VZ| < 0.3 m/s',
  local_velocity_valid: 'Local velocity valid',
  v_xy_valid: 'VXY valid',
  xy_valid: 'XY position valid',
  no_dead_reckoning: 'No dead reckoning',
  velocity_finite: 'Velocity finite',
  velocity_estimate_usable: 'Velocity estimate usable',
  horizontal_speed_stable: 'VXY speed < 0.5 m/s',
  position_global_valid: 'Local/global reference valid',
  heading_valid: 'Heading valid',
  global_position_valid: 'Global position valid',
  ekf_ready: 'EKF ready',
  velocity_control_allowed: 'Velocity control allowed',
  recovery_boost_active: 'Recovery BOOST (MAX thrust)',
  attitude_failure_deferred: 'Roll/Pitch FD deferred',
};

const NAV_GATE_TIMING_LABELS = {
  offboard_stream_ms: 'Offboard stream',
  first_attitude_setpoint_ms: 'First attitude setpoint',
  arm_request_ms: 'Arm request',
  armed_ms: 'Armed true',
  first_actuator_output_ms: 'First actuator output',
  boost_exit_ms: 'BOOST exit',
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

function getSectionCollapseStorageKey(sectionId) {
  return `fleetMissionEditor.sectionCollapsed.${sectionId}`;
}

function getStoredSectionCollapsed(sectionId) {
  try {
    return window.localStorage.getItem(getSectionCollapseStorageKey(sectionId)) === 'true';
  } catch {
    return false;
  }
}

function setStoredSectionCollapsed(sectionId, collapsed) {
  try {
    window.localStorage.setItem(getSectionCollapseStorageKey(sectionId), String(collapsed));
  } catch {
    // Ignore localStorage failures; collapse still works for the current session.
  }
}

function setSectionCollapsed(section, sectionId, collapsed) {
  const button = section.querySelector('.section-collapse-toggle');
  section.classList.toggle('is-collapsed', collapsed);
  if (button) {
    button.textContent = collapsed ? '▸' : '▾';
    button.setAttribute('aria-expanded', String(!collapsed));
    button.title = collapsed ? '펼치기' : '접기';
  }
  setStoredSectionCollapsed(sectionId, collapsed);
}

function setupCollapsibleSections() {
  for (const section of document.querySelectorAll('.section')) {
    const heading = section.querySelector(':scope h2');
    if (!heading) continue;

    const title = heading.textContent.trim();
    const sectionId = COLLAPSIBLE_SECTION_IDS[title];
    if (!sectionId || section.dataset.collapsibleSection === sectionId) continue;

    let header = section.querySelector(':scope > .section-head');
    if (!header) {
      header = document.createElement('div');
      header.className = 'section-head collapsible-section-head';
      section.insertBefore(header, heading);
      header.appendChild(heading);
    } else {
      header.classList.add('collapsible-section-head');
    }

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'section-collapse-toggle';
    toggle.setAttribute('aria-label', `${title} 접기/펼치기`);
    header.appendChild(toggle);

    const body = document.createElement('div');
    body.className = 'collapsible-section-body';
    while (header.nextSibling) {
      body.appendChild(header.nextSibling);
    }
    section.appendChild(body);

    section.dataset.collapsibleSection = sectionId;
    header.addEventListener('click', (event) => {
      if (
        event.target.closest('button') &&
        !event.target.classList.contains('section-collapse-toggle')
      ) {
        return;
      }
      setSectionCollapsed(section, sectionId, !section.classList.contains('is-collapsed'));
    });
    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      setSectionCollapsed(section, sectionId, !section.classList.contains('is-collapsed'));
    });

    setSectionCollapsed(section, sectionId, getStoredSectionCollapsed(sectionId));
  }
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
  MAV_CMD_NAV_LAND: 21,
  MAV_CMD_NAV_TAKEOFF: 22,
  MAV_FRAME_GLOBAL_RELATIVE_ALT: 3,
};

const CARRIER_STEP_TYPES = [
  'TAKEOFF',
  'WAYPOINT',
  'RELEASE',
  'LAND',
];

const CHILD_STEP_TYPES = [
  'TAKEOFF',
  'WAYPOINT',
  'LAND',
];

const DEFAULT_RELEASE_ACTUATOR = {
  method: 'MAV_CMD_DO_SET_ACTUATOR',
  actuator_index: 1,
  value: 0.4,
  hold_ms: 800,
  reset_value: -0.7,
};

const DEFAULT_RELEASE_TRIGGER = {
  type: 'CHILD_NAV_GATE_TRIGGER',
};

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

const COLLAPSIBLE_SECTION_IDS = {
  '선택 드론 MISSION': 'selected-drone-mission',
  'MISSION CONTROL': 'mission-control',
  'Vehicle Connection Settings': 'vehicle-connection-settings',
  'Runtime Connection': 'runtime-connection',
  'DEBUG TOOLS': 'debug-tools',
  'Waypoint 목록': 'waypoint-list',
  'WAYPOINT 목록': 'waypoint-list',
  '지도 보기': 'map-view',
  'Sanity Check': 'sanity-check',
};

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

setupCollapsibleSections();

function onElement(id, eventName, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(eventName, handler);
}

onElement('exportPackageBtn', 'click', exportPackageJson);
onElement('importPackageInput', 'change', importPackageJson);
onElement('addVehicleBtn', 'click', showVehicleForm);
onElement('deleteVehicleBtn', 'click', deleteSelectedVehicle);
onElement('vehicleForm', 'submit', addVehicleFromForm);
onElement('cancelVehicleBtn', 'click', hideVehicleForm);
onElement('vehicleRole', 'change', syncFirmwareProfileForRole);
onElement('resetBtn', 'click', () => {
  if (confirm('모든 mission 데이터를 초기화할까요?')) {
    state = JSON.parse(JSON.stringify(INITIAL_MISSION_PACKAGE));
    state.selectedVehicleId = null;
    clearCompanionCommandResults();
    hideVehicleForm();
    syncSettingsToForm();
    renderAll();
  }
});
onElement('saveConnBtn', 'click', saveConnectionForm);
onElement('executeEmergencyBtn', 'click', executeEmergencyAction);
onElement('manualReleaseTriggerBtn', 'click', executeManualReleaseTrigger);
onElement('debugChildKillBtn', 'click', executeDebugChildKill);
onElement('debugChildLandBtn', 'click', executeDebugChildLand);
onElement('resetRuntimeStateBtn', 'click', resetRuntimeState);
onElement('clearFcMissionBtn', 'click', clearFcMission);
onElement('uploadActionPlanBtn', 'click', uploadActionPlan);
onElement('connectBackendBtn', 'click', connectBackend);
onElement('refreshDroneStatusBtn', 'click', () => refreshDroneConnections());
onElement('connectDronesBtn', 'click', connectDrones);
onElement('backendUrl', 'change', saveBackendUrl);
onElement('exportQgcBtn', 'click', exportSelectedQgcPlan);
onElement('validateMissionBtn', 'click', validateSelectedMission);
onElement('missionStartBtn', 'click', openMissionStartModal);
onElement('cancelMissionStartBtn', 'click', closeMissionStartModal);
onElement('confirmMissionStartBtn', 'click', confirmMissionStart);
onElement('loadFcMissionBtn', 'click', loadFcMissionToMap);
onElement('uploadVerifyMissionBtn', 'click', uploadAndVerifySelectedMission);
onElement('clearMissionBtn', 'click', clearSelectedMission);
onElement('focusSelectedBtn', 'click', focusSelectedLiveDrone);
onElement('fitLiveDronesBtn', 'click', fitLiveDroneMarkers);
onElement('runLinkTestBtn', 'click', runCompanionLinkTest);

for (const id of ['firmwareType', 'vehicleType', 'hoverSpeed', 'cruiseSpeed', 'useFirstAsTakeoff']) {
  onElement(id, 'change', saveQgcSettingsFromForm);
}

function renderAll() {
  renderDroneList();
  renderConnectionForm();
  renderWaypointRows();
  renderMapItems();
  updateLiveDroneMarkers();
  renderMissionSummary();
  renderEmergencyControls();
  renderCompanionLinkTest();
  renderCompanionTestPrep();
  renderSanityCheck();
  renderRuntimeConnection();
  renderMissionMonitor();
}

function clearCompanionCommandResults() {
  runtimeState.manualReleaseTriggerState = 'IDLE';
  runtimeState.manualReleaseTriggerResult = null;
  runtimeState.runtimeResetState = 'IDLE';
  runtimeState.runtimeResetResult = null;
  runtimeState.missionClearState = 'IDLE';
  runtimeState.missionClearResult = null;
  runtimeState.actionPlanUploadState = 'IDLE';
  runtimeState.actionPlanUploadResult = null;
  runtimeState.missionStartState = 'IDLE';
  runtimeState.missionStartResult = null;
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
  clearCompanionCommandResults();
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
  clearCompanionCommandResults();
  hideVehicleForm();
  renderAll();
  saveVehicleConfigs({ silent: true });
}

function deleteSelectedVehicle() {
  const vehicle = getSelectedVehicle();
  if (!vehicle) return;

  const children = getChildVehicles(vehicle.vehicle_id);
  if (children.length > 0) {
    alert(`${vehicle.name} 아래에 child vehicle이 있어 삭제할 수 없습니다.`);
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
  clearCompanionCommandResults();
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
      clearCompanionCommandResults();
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
  const ids = ['connVehicleId', 'connName', 'connIp', 'connPort', 'connSysid', 'connRole', 'connFirmwareProfile'];
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

  document.getElementById('connVehicleId').value = vehicle.vehicle_id;
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
    vehicle_id: document.getElementById('connVehicleId').value.trim(),
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

  if (!values.vehicle_id) warnings.push(`${label}: vehicle_id를 입력하세요.`);
  if (values.vehicle_id && !/^[A-Za-z0-9_-]+$/.test(values.vehicle_id)) {
    warnings.push(`${label}: vehicle_id는 영문, 숫자, 밑줄, 하이픈만 사용할 수 있습니다.`);
  }
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
      vehicle_id: String(vehicle.vehicle_id || '').trim(),
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

function migrateVehicleId(oldVehicleId, newVehicleId) {
  if (!oldVehicleId || !newVehicleId || oldVehicleId === newVehicleId) return;

  if (state.selectedVehicleId === oldVehicleId) {
    state.selectedVehicleId = newVehicleId;
  }
  if (runtimeState.missionResultVehicleId === oldVehicleId) {
    runtimeState.missionResultVehicleId = newVehicleId;
  }

  for (const vehicle of state.vehicles) {
    if (vehicle.vehicle_id === oldVehicleId) {
      vehicle.vehicle_id = newVehicleId;
    }
    if (vehicle.parent_vehicle_id === oldVehicleId) {
      vehicle.parent_vehicle_id = newVehicleId;
    }
  }

  for (const mission of state.missions) {
    if (mission.vehicle_id === oldVehicleId) {
      mission.vehicle_id = newVehicleId;
      if (!mission.mission_id || mission.mission_id === `mission_${oldVehicleId}`) {
        mission.mission_id = `mission_${newVehicleId}`;
      }
    }
    for (const waypoint of mission.waypoints || []) {
      if (waypoint.target_vehicle_id === oldVehicleId) {
        waypoint.target_vehicle_id = newVehicleId;
      }
      if (waypoint.trigger?.target_vehicle_id === oldVehicleId) {
        waypoint.trigger.target_vehicle_id = newVehicleId;
      }
    }
  }

  if (runtimeState.vehicleConnections[oldVehicleId]) {
    runtimeState.vehicleConnections[newVehicleId] = {
      ...runtimeState.vehicleConnections[oldVehicleId],
      vehicle_id: newVehicleId,
    };
    delete runtimeState.vehicleConnections[oldVehicleId];
  }
  if (runtimeState.lastTriggerSeenAtMs[oldVehicleId]) {
    runtimeState.lastTriggerSeenAtMs[newVehicleId] = runtimeState.lastTriggerSeenAtMs[oldVehicleId];
    delete runtimeState.lastTriggerSeenAtMs[oldVehicleId];
  }

  const marker = liveDroneMarkers.get(oldVehicleId);
  if (marker) {
    liveDroneMarkers.set(newVehicleId, marker);
    liveDroneMarkers.delete(oldVehicleId);
  }
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
  const oldVehicleId = vehicle.vehicle_id;
  const newVehicleId = values.vehicle_id;
  if (
    newVehicleId !== oldVehicleId &&
    getVehicles().some((item) => item.vehicle_id === newVehicleId)
  ) {
    warnings.push(`${vehicle.name || oldVehicleId}: vehicle_id "${newVehicleId}"가 이미 존재합니다.`);
  }
  if (warnings.length > 0) {
    showConnectionWarning(warnings);
    if (!silent) alert('Connection 설정을 저장할 수 없습니다:\n- ' + warnings.join('\n- '));
    return false;
  }

  migrateVehicleId(oldVehicleId, newVehicleId);
  const updatedVehicle = getVehicleById(newVehicleId);
  if (!updatedVehicle) {
    const migrationWarnings = [`Vehicle ID migration failed: ${oldVehicleId} → ${newVehicleId}`];
    showConnectionWarning(migrationWarnings);
    if (!silent) alert(migrationWarnings[0]);
    return false;
  }

  updatedVehicle.name = values.name;
  updatedVehicle.role = normalizeVehicleRole(values.role);
  updatedVehicle.firmware_profile = values.firmware_profile;
  updatedVehicle.sysid = values.sysid;
  updatedVehicle.ip = values.ip;
  updatedVehicle.udp_port = values.udp_port;
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
  if (!actionSelect || !executeButton || !resultBox) return;

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

function formatNavGateDuration(ms) {
  if (!Number.isFinite(Number(ms))) return '-';
  const seconds = Math.max(0, Number(ms)) / 1000;
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
}

function renderNavGateDiagnostics(selectedVehicle, manualTarget) {
  const stateBadge = document.getElementById('navGateDiagnosticsState');
  const meta = document.getElementById('navGateDiagnosticsMeta');
  const grid = document.getElementById('navGateDiagnosticsGrid');
  const timingBox = document.getElementById('navGateTiming');
  if (!stateBadge || !meta || !grid || !timingBox) return;

  const pinnedTarget = getVehicles().find(
    (item) => item.vehicle_id === runtimeState.debugChildKillTargetVehicleId
  );
  const selectedIsChild = selectedVehicle && normalizeVehicleRole(selectedVehicle.role) === 'child';
  const target = selectedIsChild ? selectedVehicle : (pinnedTarget || manualTarget);
  const connection = target ? runtimeState.vehicleConnections[target.vehicle_id] : null;
  const diagnostic = connection?.nav_gate;

  grid.innerHTML = '';
  timingBox.innerHTML = '';

  if (!target) {
    stateBadge.textContent = 'NO TARGET';
    stateBadge.className = 'badge warn';
    meta.textContent = 'Select a Child or a Carrier with a target Child.';
    return;
  }

  if (!diagnostic?.available) {
    stateBadge.textContent = 'NO DATA';
    stateBadge.className = 'badge warn';
    meta.textContent = `${target.vehicle_id}: NAV_GATE diagnostic telemetry not received.`;
    return;
  }

  const valid = diagnostic.valid === true && diagnostic.stale !== true;
  stateBadge.textContent = valid ? (diagnostic.state || 'UNKNOWN') : 'STALE';
  stateBadge.className = valid && diagnostic.state !== 'FAILED' ? 'badge ok' : 'badge warn';

  const metaParts = [
    target.vehicle_id,
    `age ${formatNavGateDuration(diagnostic.age_ms)}`,
  ];
  if (diagnostic.trigger_seq !== null && diagnostic.trigger_seq !== undefined) {
    metaParts.push(`trigger ${diagnostic.trigger_seq}`);
  }
  if (diagnostic.state_since_ms !== null && diagnostic.state_since_ms !== undefined) {
    metaParts.push(`state ${formatNavGateDuration(diagnostic.state_since_ms)}`);
  }
  meta.textContent = metaParts.join(' · ');

  for (const [key, label] of Object.entries(NAV_GATE_DIAGNOSTIC_LABELS)) {
    const condition = diagnostic.conditions?.[key];
    const value = valid && typeof condition?.value === 'boolean' ? condition.value : null;
    const row = document.createElement('div');
    row.className = `nav-gate-diagnostic-row ${value === true ? 'is-true' : value === false ? 'is-false' : 'is-stale'}`;

    const dot = document.createElement('span');
    dot.className = 'nav-gate-diagnostic-dot';

    const name = document.createElement('span');
    name.textContent = label;

    const timing = document.createElement('span');
    timing.className = 'nav-gate-diagnostic-value';
    if (value === null) {
      timing.textContent = 'STALE';
    } else {
      const parts = [value ? 'ON' : 'OFF', formatNavGateDuration(condition?.since_ms)];
      if (condition?.first_true_after_trigger_ms !== null && condition?.first_true_after_trigger_ms !== undefined) {
        parts.push(`T+${formatNavGateDuration(condition.first_true_after_trigger_ms)}`);
      }
      timing.textContent = parts.join(' · ');
    }

    row.append(dot, name, timing);
    grid.appendChild(row);
  }

  const timing = diagnostic.timing || {};
  const timingTitle = document.createElement('strong');
  timingTitle.textContent = 'FC trigger-relative timeline';
  timingBox.appendChild(timingTitle);

  for (const [key, label] of Object.entries(NAV_GATE_TIMING_LABELS)) {
    const row = document.createElement('div');
    row.className = 'nav-gate-timing-row';
    const name = document.createElement('span');
    name.textContent = label;
    const value = document.createElement('span');
    const timingValueAvailable = timing[key] !== null
      && timing[key] !== undefined
      && Number.isFinite(Number(timing[key]));
    value.textContent = timingValueAvailable
      ? `T+${Number(timing[key]).toFixed(1)} ms`
      : '-';
    row.append(name, value);
    timingBox.appendChild(row);
  }

  const attitudeTitle = document.createElement('strong');
  attitudeTitle.textContent = 'Carrier-aligned attitude guard';
  attitudeTitle.className = 'nav-gate-attitude-title';
  timingBox.appendChild(attitudeTitle);

  const attitudeChecks = [
    ['PREPARE ACK', timing.prepare_acked],
    ['Gyro valid', timing.gyro_valid],
    ['Raw attitude recovered', timing.attitude_reference_recovered],
  ];
  for (const [label, status] of attitudeChecks) {
    const row = document.createElement('div');
    row.className = `nav-gate-diagnostic-row ${status === true ? 'is-true' : status === false ? 'is-false' : 'is-stale'}`;
    const dot = document.createElement('span');
    dot.className = 'nav-gate-diagnostic-dot';
    const name = document.createElement('span');
    name.textContent = label;
    const value = document.createElement('span');
    value.className = 'nav-gate-diagnostic-value';
    value.textContent = status === true ? 'ON' : status === false ? 'OFF' : 'NO DATA';
    row.append(dot, name, value);
    timingBox.appendChild(row);
  }

  const attitudeLive = document.createElement('div');
  attitudeLive.className = 'nav-gate-timing-live';
  const attitudeParts = [];
  if (timing.attitude_source) attitudeParts.push(`source ${timing.attitude_source}`);
  if (typeof timing.attitude_suspect === 'boolean') {
    attitudeParts.push(timing.attitude_suspect ? 'RAW SUSPECT' : 'RAW AGREED');
  }
  if (timing.attitude_disagreement_deg !== null && timing.attitude_disagreement_deg !== undefined
      && Number.isFinite(Number(timing.attitude_disagreement_deg))) {
    attitudeParts.push(`diff ${Number(timing.attitude_disagreement_deg).toFixed(1)}°`);
  }
  if (timing.attitude_blend_progress !== null && timing.attitude_blend_progress !== undefined
      && Number.isFinite(Number(timing.attitude_blend_progress))) {
    attitudeParts.push(`blend ${(Number(timing.attitude_blend_progress) * 100).toFixed(0)}%`);
  }
  if (timing.prepare_token !== null && timing.prepare_token !== undefined) {
    attitudeParts.push(`token ${timing.prepare_token}`);
  }
  const anglePairs = [
    ['raw', timing.raw_roll_deg, timing.raw_pitch_deg],
    ['control', timing.control_roll_deg, timing.control_pitch_deg],
    ['reference', timing.reference_roll_deg, timing.reference_pitch_deg],
  ];
  for (const [label, roll, pitch] of anglePairs) {
    if (roll !== null && roll !== undefined && pitch !== null && pitch !== undefined
        && Number.isFinite(Number(roll)) && Number.isFinite(Number(pitch))) {
      attitudeParts.push(`${label} R${Number(roll).toFixed(1)}° P${Number(pitch).toFixed(1)}°`);
    }
  }
  attitudeLive.textContent = attitudeParts.length ? attitudeParts.join(' · ') : 'Attitude reference telemetry not received.';
  timingBox.appendChild(attitudeLive);

  const live = document.createElement('div');
  live.className = 'nav-gate-timing-live';
  const liveParts = [];
  if (timing.vz_m_s !== null && timing.vz_m_s !== undefined && Number.isFinite(Number(timing.vz_m_s))) {
    liveParts.push(`VZ ${Number(timing.vz_m_s).toFixed(2)} m/s`);
  }
  if (timing.base_thrust !== null && timing.base_thrust !== undefined && Number.isFinite(Number(timing.base_thrust))) {
    liveParts.push(`base thrust ${Number(timing.base_thrust).toFixed(3)}`);
  }
  if (typeof timing.boost_active === 'boolean') {
    liveParts.push(timing.boost_active ? 'BOOST' : 'REGULATION');
  }
  live.textContent = liveParts.length ? liveParts.join(' · ') : 'Timing telemetry not received.';
  timingBox.appendChild(live);
}

function renderCompanionTestPrep() {
  const vehicle = getSelectedVehicle();
  const isCarrier = vehicle && normalizeVehicleRole(vehicle.role) === 'carrier';
  const manualButton = document.getElementById('manualReleaseTriggerBtn');
  const manualResultBox = document.getElementById('manualReleaseTriggerResult');
  const debugKillButton = document.getElementById('debugChildKillBtn');
  const debugKillResultBox = document.getElementById('debugChildKillResult');
  const debugLandButton = document.getElementById('debugChildLandBtn');
  const debugLandResultBox = document.getElementById('debugChildLandResult');
  const resetButton = document.getElementById('resetRuntimeStateBtn');
  const resetResultBox = document.getElementById('runtimeResetResult');
  const clearButton = document.getElementById('clearFcMissionBtn');
  const clearResultBox = document.getElementById('missionClearResult');
  const uploadActionPlanButton = document.getElementById('uploadActionPlanBtn');
  const uploadActionPlanResultBox = document.getElementById('actionPlanUploadResult');
  const manualTarget = vehicle ? getManualReleaseTarget(vehicle) : null;
  const backendOnline = runtimeState.status === 'BACKEND ONLINE';

  if (resetButton && resetResultBox) {
    const isBusy = runtimeState.runtimeResetState === 'SENDING';
    resetButton.disabled = !vehicle || !backendOnline || isBusy;
    resetButton.textContent = isBusy ? '초기화 중...' : '런타임 상태 초기화';
    resetResultBox.textContent = formatRuntimeResetResult(vehicle);
  }

  if (clearButton && clearResultBox) {
    const isBusy = runtimeState.missionClearState === 'SENDING';
    clearButton.disabled = !vehicle || !backendOnline || isBusy;
    clearButton.textContent = isBusy ? '삭제 중...' : 'FC 미션 삭제';
    clearResultBox.textContent = formatMissionClearResult(vehicle);
  }

  if (uploadActionPlanButton) {
    const isBusy = runtimeState.actionPlanUploadState === 'SENDING';
    uploadActionPlanButton.classList.toggle('hidden', Boolean(vehicle && !isCarrier));
    uploadActionPlanButton.disabled = !vehicle || !backendOnline || !isCarrier || isBusy;
    uploadActionPlanButton.textContent = isBusy ? '액션 플랜 업로드 중...' : '액션 플랜 업로드';
  }

  if (uploadActionPlanResultBox) {
    uploadActionPlanResultBox.classList.toggle('hidden', Boolean(vehicle && !isCarrier));
    uploadActionPlanResultBox.textContent = formatActionPlanUploadResult(vehicle);
  }

  if (manualButton && manualResultBox) {
    const isBusy = runtimeState.manualReleaseTriggerState === 'SENDING';
    manualButton.disabled =
      !vehicle ||
      !isCarrier ||
      !manualTarget ||
      runtimeState.status !== 'BACKEND ONLINE' ||
      isBusy;
    manualButton.textContent = isBusy ? '수동 릴리즈 + 트리거 중...' : '수동 릴리즈 + 트리거';

    if (!vehicle) {
      manualResultBox.textContent = 'Select a Carrier before manual release trigger.';
    } else if (!isCarrier) {
      manualResultBox.textContent = 'Manual release trigger requires selected vehicle role=carrier.';
    } else if (!manualTarget) {
      manualResultBox.textContent = 'No target child found. Set a RELEASE target child or add a child vehicle.';
    } else if (runtimeState.manualReleaseTriggerResult) {
      manualResultBox.textContent = formatManualReleaseTriggerResult(runtimeState.manualReleaseTriggerResult);
    } else if (runtimeState.status === 'BACKEND ONLINE') {
      manualResultBox.textContent = `Ready: ${vehicle.vehicle_id} → ${manualTarget.vehicle_id} using AUX1 actuator release.`;
    } else {
      manualResultBox.textContent = 'Backend must be online before manual release trigger.';
    }
  }

  if (debugKillButton && debugKillResultBox) {
    const pinnedTarget = getVehicles().find(
      (item) => item.vehicle_id === runtimeState.debugChildKillTargetVehicleId
    );
    const killTarget = pinnedTarget || manualTarget;
    const isBusy = runtimeState.debugChildKillInFlight;
    debugKillButton.disabled = !isCarrier || !killTarget || !backendOnline || isBusy;
    debugKillButton.textContent = isBusy
      ? `${killTarget?.vehicle_id || 'Child'} Force Disarm 전송 중...`
      : `${killTarget?.vehicle_id || '대상 자드론'} 킬스위치 (Force Disarm)`;

    if (runtimeState.debugChildKillResult) {
      debugKillResultBox.textContent = formatEmergencyResult(runtimeState.debugChildKillResult);
    } else if (!vehicle || !isCarrier) {
      debugKillResultBox.textContent = 'Select a Carrier before using the Child kill switch.';
    } else if (!killTarget) {
      debugKillResultBox.textContent = 'No target Child found for the selected Carrier.';
    } else if (!backendOnline) {
      debugKillResultBox.textContent = 'Backend must be online before using the kill switch.';
    } else {
      debugKillResultBox.textContent = `Ready to force-disarm ${killTarget.vehicle_id}.`;
    }
  }

  if (debugLandButton && debugLandResultBox) {
    const pinnedTarget = getVehicles().find(
      (item) => item.vehicle_id === runtimeState.debugChildKillTargetVehicleId
    );
    const landTarget = pinnedTarget || manualTarget;
    const isBusy = runtimeState.debugChildLandInFlight;
    debugLandButton.disabled = !isCarrier || !landTarget || !backendOnline || isBusy;
    debugLandButton.textContent = isBusy
      ? `${landTarget?.vehicle_id || 'Child'} LAND 전송 중...`
      : `${landTarget?.vehicle_id || '대상 자드론'} LAND`;

    if (runtimeState.debugChildLandResult) {
      debugLandResultBox.textContent = formatEmergencyResult(runtimeState.debugChildLandResult);
    } else if (!vehicle || !isCarrier) {
      debugLandResultBox.textContent = 'Select a Carrier before using Child LAND.';
    } else if (!landTarget) {
      debugLandResultBox.textContent = 'No target Child found for the selected Carrier.';
    } else if (!backendOnline) {
      debugLandResultBox.textContent = 'Backend must be online before using LAND.';
    } else {
      debugLandResultBox.textContent = `Ready to land ${landTarget.vehicle_id}.`;
    }
  }

  renderNavGateDiagnostics(vehicle, manualTarget);
}

function renderCompanionLinkTest() {
  const sourceSelect = document.getElementById('linkTestSource');
  const targetSelect = document.getElementById('linkTestTarget');
  const countInput = document.getElementById('linkTestCount');
  const timeoutInput = document.getElementById('linkTestTimeoutMs');
  const runButton = document.getElementById('runLinkTestBtn');
  const resultBox = document.getElementById('linkTestResult');
  const badge = document.getElementById('linkTestStatusBadge');
  if (!sourceSelect || !targetSelect || !runButton || !resultBox || !badge) return;
  runButton.textContent = '통신 테스트';

  const vehicles = getVehicles();
  const previousSource = sourceSelect.value;
  const previousTarget = targetSelect.value;
  sourceSelect.innerHTML = '';
  targetSelect.innerHTML = '';

  for (const vehicle of vehicles) {
    const label = `${vehicle.name} (${vehicle.vehicle_id}) · ${vehicle.ip}:${vehicle.udp_port}`;
    const sourceOption = document.createElement('option');
    sourceOption.value = vehicle.vehicle_id;
    sourceOption.textContent = label;
    sourceSelect.appendChild(sourceOption);

    const targetOption = document.createElement('option');
    targetOption.value = vehicle.vehicle_id;
    targetOption.textContent = label;
    targetSelect.appendChild(targetOption);
  }

  const defaultSource = vehicles.find((vehicle) => normalizeVehicleRole(vehicle.role) === 'carrier') || vehicles[0];
  const defaultTarget = vehicles.find((vehicle) => normalizeVehicleRole(vehicle.role) === 'child') || vehicles[1] || vehicles[0];
  sourceSelect.value = vehicles.some((vehicle) => vehicle.vehicle_id === previousSource)
    ? previousSource
    : defaultSource?.vehicle_id || '';
  targetSelect.value = vehicles.some((vehicle) => vehicle.vehicle_id === previousTarget)
    ? previousTarget
    : defaultTarget?.vehicle_id || '';

  const runnable =
    runtimeState.status === 'BACKEND ONLINE' &&
    !runtimeState.linkTestRunning &&
    !!sourceSelect.value &&
    !!targetSelect.value &&
    sourceSelect.value !== targetSelect.value;
  runButton.disabled = !runnable;
  countInput.disabled = runtimeState.linkTestRunning;
  timeoutInput.disabled = runtimeState.linkTestRunning;

  if (runtimeState.linkTestRunning) {
    badge.textContent = 'RUNNING';
    badge.className = 'badge warn';
    resultBox.textContent = 'Running companion link test...';
    return;
  }

  const result = runtimeState.lastLinkTestResult;
  if (!result) {
    badge.textContent = 'IDLE';
    badge.className = 'badge';
    resultBox.textContent = vehicles.length < 2
      ? 'Add at least two vehicles to run a link test.'
      : 'No link test yet.';
    return;
  }

  badge.textContent = result.ok ? 'OK' : 'FAIL';
  badge.className = result.ok ? 'badge ok' : 'badge warn';
  resultBox.innerHTML = formatLinkTestResult(result);
}

function formatLinkTestResult(result) {
  const source = escapeHtml(result.source_vehicle_id || '-');
  const target = escapeHtml(result.target_vehicle_id || '-');
  const sent = Number(result.sent ?? 0);
  const received = Number(result.received ?? 0);
  const lost = Number(result.lost ?? Math.max(0, sent - received));
  const reason = escapeHtml(result.reason || '-');
  const duration = result.duration_ms !== null && result.duration_ms !== undefined
    ? `${escapeHtml(result.duration_ms)} ms`
    : '-';
  const rows = Array.isArray(result.results)
    ? result.results.map((item) => {
        const status = item.ok ? 'OK' : 'FAIL';
        const rtt = item.rtt_ms !== null && item.rtt_ms !== undefined ? `${item.rtt_ms} ms` : '-';
        const responder = escapeHtml(item.responder_vehicle_id || '-');
        const reasonText = escapeHtml(item.reason || '');
        return `<div class="link-test-row">#${escapeHtml(item.index)} ${status} · rtt ${escapeHtml(rtt)} · ${responder}${reasonText ? ` · ${reasonText}` : ''}</div>`;
      }).join('')
    : '';

  return `
    <div class="link-test-summary">
      <strong>${source} → ${target}</strong><br />
      ${received} / ${sent} ${result.ok ? 'OK' : 'received'} · lost ${lost}<br />
      duration: ${duration}<br />
      reason: ${reason}
    </div>
    <div class="link-test-details">${rows}</div>
  `;
}

function parseLinkTestError(responseBody, sourceVehicleId, targetVehicleId, count) {
  const detail = responseBody?.detail && typeof responseBody.detail === 'object'
    ? responseBody.detail
    : responseBody;

  return {
    type: 'COMPANION_LINK_TEST_RESULT',
    ok: false,
    accepted: false,
    source_vehicle_id: detail?.source_vehicle_id || sourceVehicleId,
    target_vehicle_id: detail?.target_vehicle_id || targetVehicleId,
    sent: count,
    received: 0,
    lost: count,
    reason: detail?.reason || detail?.message || 'request_failed',
    detail: responseBody,
    timestamp_ms: Date.now(),
  };
}

async function runCompanionLinkTest() {
  const sourceVehicleId = document.getElementById('linkTestSource').value;
  const targetVehicleId = document.getElementById('linkTestTarget').value;
  const count = Number(document.getElementById('linkTestCount').value || 5);
  const timeoutMs = Number(document.getElementById('linkTestTimeoutMs').value || 500);

  if (!sourceVehicleId || !targetVehicleId) {
    alert('Sender와 Receiver를 선택하세요.');
    return;
  }
  if (sourceVehicleId === targetVehicleId) {
    alert('Sender와 Receiver는 달라야 합니다.');
    return;
  }
  if (!Number.isInteger(count) || count < 1 || count > 20) {
    alert('Count는 1~20 사이의 숫자여야 합니다.');
    return;
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 5000) {
    alert('Timeout은 100~5000 ms 사이의 숫자여야 합니다.');
    return;
  }

  saveBackendUrl();
  if (runtimeState.status !== 'BACKEND ONLINE') {
    runtimeState.lastLinkTestResult = {
      ok: false,
      source_vehicle_id: sourceVehicleId,
      target_vehicle_id: targetVehicleId,
      sent: count,
      received: 0,
      lost: count,
      reason: 'backend_not_online',
      timestamp_ms: Date.now(),
    };
    renderCompanionLinkTest();
    return;
  }

  const saved = await saveVehicleConfigs({ silent: true });
  if (!saved) {
    runtimeState.lastLinkTestResult = {
      ok: false,
      source_vehicle_id: sourceVehicleId,
      target_vehicle_id: targetVehicleId,
      sent: count,
      received: 0,
      lost: count,
      reason: 'vehicle_config_save_failed',
      timestamp_ms: Date.now(),
    };
    renderCompanionLinkTest();
    return;
  }

  runtimeState.linkTestRunning = true;
  runtimeState.lastLinkTestResult = null;
  renderCompanionLinkTest();

  try {
    const response = await fetch(`${runtimeState.backendUrl}/api/companion/link-test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({
        source_vehicle_id: sourceVehicleId,
        target_vehicle_id: targetVehicleId,
        count,
        timeout_ms: timeoutMs,
      }),
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      runtimeState.lastLinkTestResult = parseLinkTestError(payload, sourceVehicleId, targetVehicleId, count);
    } else {
      runtimeState.lastLinkTestResult = payload;
    }
  } catch (error) {
    runtimeState.lastLinkTestResult = {
      type: 'COMPANION_LINK_TEST_RESULT',
      ok: false,
      accepted: false,
      source_vehicle_id: sourceVehicleId,
      target_vehicle_id: targetVehicleId,
      sent: count,
      received: 0,
      lost: count,
      reason: 'frontend_fetch_error',
      message: String(error),
      timestamp_ms: Date.now(),
    };
  } finally {
    runtimeState.linkTestRunning = false;
    renderCompanionLinkTest();
  }
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

function getManualReleaseTarget(carrierVehicle) {
  if (!carrierVehicle || normalizeVehicleRole(carrierVehicle.role) !== 'carrier') return null;
  const mission = getMissionByVehicleId(carrierVehicle.vehicle_id);
  const releaseTargetId = mission?.waypoints?.find(
    (waypoint) => waypoint.kind === 'release' && waypoint.target_vehicle_id
  )?.target_vehicle_id;
  if (releaseTargetId) {
    const releaseTarget = getVehicles().find((vehicle) => vehicle.vehicle_id === releaseTargetId);
    if (releaseTarget && normalizeVehicleRole(releaseTarget.role) === 'child') return releaseTarget;
  }
  return getChildVehiclesForCarrier(carrierVehicle)[0] || null;
}

function formatManualReleaseTriggerResult(result) {
  if (!result) return 'Manual release trigger has not run.';
  const accepted = result.accepted === true ? 'true' : 'false';
  const ok = result.ok === true ? 'true' : 'false';
  const rawResponse = result.result || result.response || {};
  const actionStatus = rawResponse.action_status || result.action_status || {};
  const lines = [
    `State: ${runtimeState.manualReleaseTriggerState}`,
    `accepted: ${accepted}`,
    `ok: ${ok}`,
    `reason: ${result.reason || result.message || '-'}`,
    `relationship_id: ${result.relationship_id || result.result?.relationship_id || '-'}`,
    `seq: ${result.seq || '-'}`,
  ];
  if (rawResponse.type || rawResponse.vehicle_id) {
    lines.push(`response: ${rawResponse.type || '-'} / ${rawResponse.vehicle_id || '-'} / seq ${rawResponse.seq ?? '-'}`);
  }
  if (rawResponse.type === 'CHILD_NAV_GATE_TRIGGER_ACK') {
    lines.push('status: Unexpected child trigger ACK received during manual release request');
  }
  if (actionStatus.state || actionStatus.release_result || actionStatus.trigger_result || actionStatus.ack_state) {
    lines.push(
      `action_status: state=${actionStatus.state || '-'}, release=${actionStatus.release_result || '-'}, trigger=${actionStatus.trigger_result || '-'}, ack=${actionStatus.ack_state || '-'}`
    );
  }
  const displayStatus = getManualReleaseDisplayStatus(result);
  if (displayStatus) {
    lines.push(`status: ${displayStatus}`);
  }
  if (result.sent_to) {
    lines.push(`sent_to: ${result.sent_to.vehicle_id || '-'} / ${result.sent_to.ip || '-'}:${result.sent_to.udp_port || '-'}`);
  }
  if (Array.isArray(result.warnings) && result.warnings.length > 0) {
    lines.push(`warnings: ${result.warnings.join(', ')}`);
  }
  return lines.join(' / ');
}

function getManualReleaseDisplayStatus(result) {
  const actionStatus = result?.result?.action_status || result?.action_status || {};
  const triggerResult = actionStatus.trigger_result;
  const state = actionStatus.state;
  const reason = result?.reason || result?.message || '';
  const relationshipId = result?.relationship_id || result?.result?.relationship_id || '';
  const carrierConnection = runtimeState.vehicleConnections[result?.vehicle_id || getSelectedVehicle()?.vehicle_id] || {};
  const statusConfirmsForwarded = (
    relationshipId &&
    carrierConnection.last_trigger_relationship_id === relationshipId &&
    carrierConnection.last_trigger_state === 'FORWARDED_TO_FC'
  );

  if (statusConfirmsForwarded || triggerResult === 'FORWARDED_TO_FC' || state === 'FORWARDED_TO_FC') {
    return '릴리즈 명령 전송 완료 / 자드론 FC 전달 완료';
  }
  if (isManualReleaseIntermediateState(state) || isManualReleaseIntermediateState(triggerResult) || isManualReleaseIntermediateState(actionStatus.ack_state)) {
    return '자드론 ACK 수신 / 최종 전달 상태 확인 중';
  }
  if (result?.ok === false || state === 'FAILED') {
    return `릴리즈/트리거 실패: ${reason || state || 'unknown_error'}`;
  }
  if (result?.ok === true) {
    return '릴리즈/트리거 명령 처리됨';
  }
  return '';
}

function isManualReleaseIntermediateState(value) {
  return [
    'TRIGGER_SENT_RELEASE_CLOSE_COMMAND_SENT',
    'ACK_RECEIVED',
    'TRIGGER_RECEIVED',
  ].includes(value);
}

function getManualReleaseStateFromResult(responseBody) {
  const actionStatus = responseBody?.result?.action_status || responseBody?.action_status || {};
  if (responseBody?.reason === 'timeout') return 'TIMEOUT';
  if (responseBody?.ok === true) return 'EXECUTED';
  if (
    isManualReleaseIntermediateState(actionStatus.state) ||
    isManualReleaseIntermediateState(actionStatus.trigger_result) ||
    isManualReleaseIntermediateState(actionStatus.ack_state)
  ) {
    return 'EXECUTED';
  }
  return 'FAILED';
}

function parseManualReleaseTriggerError(responseBody, carrierVehicle, targetVehicle, seq) {
  const detail = responseBody?.detail && typeof responseBody.detail === 'object'
    ? responseBody.detail
    : responseBody;
  return {
    ok: false,
    accepted: false,
    vehicle_id: carrierVehicle?.vehicle_id || '',
    target_vehicle_id: targetVehicle?.vehicle_id || '',
    seq,
    reason: detail?.reason || detail?.message || 'request_failed',
    message: detail?.message || '',
  };
}

function formatRuntimeResetResult(vehicle) {
  if (!vehicle) return 'Select a vehicle and connect backend before reset.';
  if (!runtimeState.runtimeResetResult) {
    return runtimeState.status === 'BACKEND ONLINE'
      ? `Ready to reset runtime state for ${vehicle.vehicle_id}.`
      : 'Backend must be online before runtime reset.';
  }

  const result = runtimeState.runtimeResetResult;
  if (runtimeState.runtimeResetState === 'OK') return 'Runtime state reset complete';
  if (runtimeState.runtimeResetState === 'TIMEOUT') return 'Runtime state reset timeout';
  if (runtimeState.runtimeResetState === 'SENDING') return 'Runtime state reset sending...';
  return `Runtime state reset failed: ${result.reason || result.message || 'unknown_error'}`;
}

function formatMissionClearResult(vehicle) {
  if (!vehicle) return 'Select a vehicle and connect backend before mission clear.';
  if (!runtimeState.missionClearResult) {
    return runtimeState.status === 'BACKEND ONLINE'
      ? `Ready to clear FC mission for ${vehicle.vehicle_id}.`
      : 'Backend must be online before mission clear.';
  }

  const result = runtimeState.missionClearResult;
  if (runtimeState.missionClearState === 'OK') return 'Mission clear complete';
  if (runtimeState.missionClearState === 'WARNING') return 'Mission clear command sent, ACK timeout';
  if (runtimeState.missionClearState === 'TIMEOUT') return 'Mission clear timeout';
  if (runtimeState.missionClearState === 'SENDING') return 'Mission clear sending...';
  return `Mission clear failed: ${result.reason || result.message || 'unknown_error'}`;
}

function formatActionPlanUploadResult(vehicle) {
  if (!vehicle) return 'Select a Carrier and connect backend before action plan upload.';
  if (isChildVehicle(vehicle)) return 'Action Plan upload requires selected vehicle role=carrier.';
  if (!runtimeState.actionPlanUploadResult) {
    return runtimeState.status === 'BACKEND ONLINE'
      ? `Ready to upload action plan for ${vehicle.vehicle_id}.`
      : 'Backend must be online before action plan upload.';
  }

  const result = runtimeState.actionPlanUploadResult;
  if (runtimeState.actionPlanUploadState === 'OK') return 'Action Plan uploaded';
  if (runtimeState.actionPlanUploadState === 'TIMEOUT') return 'Action Plan upload timeout';
  if (runtimeState.actionPlanUploadState === 'SENDING') return 'Action Plan upload sending...';
  if (result.reason === 'no_waypoint_actions_configured') return 'No waypoint actions configured';
  return `Action Plan upload failed: ${result.reason || result.message || 'unknown_error'}`;
}

function getCommandResultDetail(responseBody) {
  return responseBody?.result && typeof responseBody.result === 'object'
    ? responseBody.result
    : responseBody?.response && typeof responseBody.response === 'object'
      ? responseBody.response
      : responseBody;
}

function isExpectedCommandResult(responseBody, expectedType) {
  const detail = getCommandResultDetail(responseBody);
  return detail?.type === expectedType;
}

function getRuntimeResetStateFromResult(responseBody) {
  if (responseBody?.reason === 'timeout') return 'TIMEOUT';
  if (
    isExpectedCommandResult(responseBody, 'RUNTIME_STATE_RESET_RESULT') &&
    responseBody?.accepted === true &&
    responseBody?.ok === true
  ) {
    return 'OK';
  }
  return 'FAILED';
}

function getMissionClearStateFromResult(responseBody) {
  const detail = getCommandResultDetail(responseBody);
  const reason = responseBody?.reason || detail?.reason || '';
  if (responseBody?.reason === 'timeout') return 'TIMEOUT';
  if (
    isExpectedCommandResult(responseBody, 'MISSION_CLEAR_RESULT') &&
    responseBody?.ok === true &&
    reason === 'clear_sent_ack_timeout'
  ) {
    return 'WARNING';
  }
  if (
    isExpectedCommandResult(responseBody, 'MISSION_CLEAR_RESULT') &&
    responseBody?.accepted === true &&
    responseBody?.ok === true
  ) {
    return 'OK';
  }
  return 'FAILED';
}

function getActionPlanUploadStateFromResult(responseBody) {
  if (responseBody?.reason === 'timeout') return 'TIMEOUT';
  if (
    isExpectedCommandResult(responseBody, 'ACTION_PLAN_UPLOAD_RESULT') &&
    responseBody?.accepted === true &&
    responseBody?.ok === true
  ) {
    return 'OK';
  }
  return 'FAILED';
}

function getMissionStartStateFromResult(responseBody) {
  if (responseBody?.reason === 'timeout') return 'TIMEOUT';
  if (
    isExpectedCommandResult(responseBody, 'MISSION_START_RESULT') &&
    responseBody?.accepted === true &&
    responseBody?.ok === true
  ) {
    return 'OK';
  }
  return 'FAILED';
}

function getMissionStartReadiness(vehicle = getSelectedVehicle()) {
  if (!vehicle) return { ready: false, reason: 'vehicle_not_selected' };
  if (normalizeVehicleRole(vehicle.role) !== 'carrier') {
    return { ready: false, reason: 'mission_start_carrier_only' };
  }
  if (runtimeState.status !== 'BACKEND ONLINE') {
    return { ready: false, reason: 'backend_not_online' };
  }

  const connection = getVehicleConnection(vehicle);
  if (getDisplayedCompanionState(connection) !== 'CONNECTED') {
    return { ready: false, reason: 'companion_not_connected' };
  }
  if (getDisplayedFcState(connection) !== 'CONNECTED') {
    return { ready: false, reason: 'fc_not_connected' };
  }

  const mission = connection.mission || {};
  if (mission.last_upload_result !== 'MISSION_ACK_ACCEPTED' || Number(mission.last_upload_count || 0) <= 0) {
    return { ready: false, reason: 'mission_not_uploaded' };
  }
  if (mission.last_download_result !== 'OK') {
    return { ready: false, reason: 'mission_not_verified' };
  }

  const actionPlan = connection.action_plan || {};
  const actionCount = Number(actionPlan.action_count ?? actionPlan.actions?.length ?? 0);
  if (actionPlan.loaded !== true || actionCount <= 0) {
    return { ready: false, reason: 'action_plan_not_loaded' };
  }

  return { ready: true, reason: 'ready' };
}

function formatMissionStartResult(vehicle) {
  if (!vehicle) return 'Select a Carrier before Mission Start.';
  if (normalizeVehicleRole(vehicle.role) !== 'carrier') return 'Mission Start는 Carrier 전용입니다.';
  if (!runtimeState.missionStartResult) {
    const readiness = getMissionStartReadiness(vehicle);
    return readiness.ready
      ? 'Mission Start 준비 완료. 버튼을 누르면 확인 창이 표시됩니다.'
      : `Mission Start 대기: ${readiness.reason}`;
  }

  if (runtimeState.missionStartState === 'SENDING') return '미션 시작 명령 전송 중...';
  if (runtimeState.missionStartState === 'OK') return '미션 시작 명령 전송 완료';
  if (runtimeState.missionStartState === 'TIMEOUT') return 'Mission Start timeout';

  const result = runtimeState.missionStartResult;
  return `Mission Start 실패: ${result.reason || result.message || 'unknown_error'}`;
}

async function postDroneCommand(path, body) {
  const response = await fetch(`${runtimeState.backendUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify(body),
  });
  const responseBody = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = responseBody?.detail && typeof responseBody.detail === 'object'
      ? responseBody.detail
      : responseBody;
    return {
      ok: false,
      accepted: false,
      reason: detail?.reason || detail?.message || `HTTP ${response.status}`,
      message: detail?.message || '',
      detail,
    };
  }
  return responseBody;
}

async function prepareSelectedVehicleCommand() {
  const vehicle = getSelectedVehicle();
  if (!vehicle) return { ok: false, reason: 'vehicle_not_selected' };
  if (!saveConnectionForm({ persist: false })) return { ok: false, reason: 'invalid_connection_form' };
  saveBackendUrl();
  if (runtimeState.status !== 'BACKEND ONLINE') return { ok: false, reason: 'backend_not_online' };
  const saved = await saveVehicleConfigs({ silent: true });
  if (!saved) return { ok: false, reason: 'vehicle_config_save_failed' };
  return { ok: true, vehicle };
}

function openMissionStartModal() {
  const vehicle = getSelectedVehicle();
  const readiness = getMissionStartReadiness(vehicle);
  if (!readiness.ready) {
    runtimeState.missionStartState = 'FAILED';
    runtimeState.missionStartResult = {
      ok: false,
      accepted: false,
      vehicle_id: vehicle?.vehicle_id || '',
      reason: readiness.reason,
    };
    renderMissionSummary();
    return;
  }

  document.getElementById('missionStartModal')?.classList.remove('hidden');
}

function closeMissionStartModal() {
  document.getElementById('missionStartModal')?.classList.add('hidden');
}

async function confirmMissionStart() {
  closeMissionStartModal();
  const prepared = await prepareSelectedVehicleCommand();
  const seq = Date.now();
  if (!prepared.ok) {
    runtimeState.missionStartState = 'FAILED';
    runtimeState.missionStartResult = { ok: false, accepted: false, reason: prepared.reason, seq };
    renderMissionSummary();
    return;
  }

  const vehicle = prepared.vehicle;
  const readiness = getMissionStartReadiness(vehicle);
  if (!readiness.ready) {
    runtimeState.missionStartState = 'FAILED';
    runtimeState.missionStartResult = {
      ok: false,
      accepted: false,
      vehicle_id: vehicle.vehicle_id,
      reason: readiness.reason,
      seq,
    };
    renderMissionSummary();
    return;
  }

  runtimeState.missionStartState = 'SENDING';
  runtimeState.missionStartResult = {
    ok: false,
    accepted: false,
    vehicle_id: vehicle.vehicle_id,
    reason: 'sending',
    seq,
  };
  renderMissionSummary();

  try {
    const responseBody = await postDroneCommand('/api/drone/mission-start', {
      vehicle_id: vehicle.vehicle_id,
      start_seq: 0,
      arm: true,
      auto_mission: true,
      mission_start: true,
      confirm_start: true,
      timeout_ms: 5000,
    });
    runtimeState.missionStartResult = responseBody;
    runtimeState.missionStartState = getMissionStartStateFromResult(responseBody);
    if (runtimeState.missionStartState === 'OK') {
      await refreshDroneConnections({ silent: true });
    }
  } catch (error) {
    runtimeState.missionStartState = 'FAILED';
    runtimeState.missionStartResult = {
      ok: false,
      accepted: false,
      vehicle_id: vehicle.vehicle_id,
      reason: 'request_failed',
      message: error.message,
      seq,
    };
  } finally {
    renderMissionSummary();
    renderRuntimeConnection();
  }
}

async function resetRuntimeState() {
  const prepared = await prepareSelectedVehicleCommand();
  const seq = Date.now();
  if (!prepared.ok) {
    runtimeState.runtimeResetState = 'FAILED';
    runtimeState.runtimeResetResult = { ok: false, accepted: false, reason: prepared.reason, seq };
    renderCompanionTestPrep();
    return;
  }

  const vehicle = prepared.vehicle;
  runtimeState.runtimeResetState = 'SENDING';
  runtimeState.runtimeResetResult = { ok: false, accepted: false, reason: 'sending', seq };
  renderCompanionTestPrep();

  try {
    const responseBody = await postDroneCommand('/api/drone/runtime-reset', {
      vehicle_id: vehicle.vehicle_id,
      scope: 'all_runtime',
      reset_trigger_dedupe: true,
      reset_rc_latch: false,
      seq,
    });
    runtimeState.runtimeResetResult = responseBody;
    runtimeState.runtimeResetState = getRuntimeResetStateFromResult(responseBody);
    if (runtimeState.runtimeResetState === 'OK') {
      await refreshDroneConnections({ silent: true });
    }
  } catch (error) {
    runtimeState.runtimeResetState = 'FAILED';
    runtimeState.runtimeResetResult = {
      ok: false,
      accepted: false,
      reason: 'request_failed',
      message: error.message,
      seq,
    };
  } finally {
    renderCompanionTestPrep();
    renderRuntimeConnection();
  }
}

async function clearFcMission() {
  const prepared = await prepareSelectedVehicleCommand();
  const seq = Date.now();
  if (!prepared.ok) {
    runtimeState.missionClearState = 'FAILED';
    runtimeState.missionClearResult = { ok: false, accepted: false, reason: prepared.reason, seq };
    renderCompanionTestPrep();
    return;
  }

  const vehicle = prepared.vehicle;
  runtimeState.missionClearState = 'SENDING';
  runtimeState.missionClearResult = { ok: false, accepted: false, reason: 'sending', seq };
  renderCompanionTestPrep();

  try {
    const responseBody = await postDroneCommand('/api/drone/mission-clear', {
      vehicle_id: vehicle.vehicle_id,
      seq,
    });
    runtimeState.missionClearResult = responseBody;
    runtimeState.missionClearState = getMissionClearStateFromResult(responseBody);
    if (['OK', 'WARNING'].includes(runtimeState.missionClearState)) {
      await refreshDroneConnections({ silent: true });
    }
  } catch (error) {
    runtimeState.missionClearState = 'FAILED';
    runtimeState.missionClearResult = {
      ok: false,
      accepted: false,
      reason: 'request_failed',
      message: error.message,
      seq,
    };
  } finally {
    renderCompanionTestPrep();
    renderRuntimeConnection();
  }
}

async function executeManualReleaseTrigger() {
  const carrierVehicle = getSelectedVehicle();
  const targetVehicle = carrierVehicle ? getManualReleaseTarget(carrierVehicle) : null;
  const seq = Date.now();

  if (!carrierVehicle || normalizeVehicleRole(carrierVehicle.role) !== 'carrier' || !targetVehicle) {
    runtimeState.manualReleaseTriggerState = 'FAILED';
    runtimeState.manualReleaseTriggerResult = {
      ok: false,
      accepted: false,
      vehicle_id: carrierVehicle?.vehicle_id || '',
      target_vehicle_id: targetVehicle?.vehicle_id || '',
      seq,
      reason: !carrierVehicle
        ? 'carrier_not_selected'
        : normalizeVehicleRole(carrierVehicle.role) !== 'carrier'
          ? 'selected_vehicle_not_carrier'
          : 'target_child_not_found',
    };
    renderCompanionTestPrep();
    return;
  }

  runtimeState.debugChildKillTargetVehicleId = targetVehicle.vehicle_id;
  runtimeState.debugChildKillResult = null;

  if (!saveConnectionForm({ persist: false })) return;
  saveBackendUrl();
  if (runtimeState.status !== 'BACKEND ONLINE') {
    runtimeState.manualReleaseTriggerState = 'FAILED';
    runtimeState.manualReleaseTriggerResult = {
      ok: false,
      accepted: false,
      vehicle_id: carrierVehicle.vehicle_id,
      target_vehicle_id: targetVehicle.vehicle_id,
      seq,
      reason: 'backend_not_online',
    };
    renderCompanionTestPrep();
    return;
  }

  const saved = await saveVehicleConfigs({ silent: true });
  if (!saved) {
    runtimeState.manualReleaseTriggerState = 'FAILED';
    runtimeState.manualReleaseTriggerResult = {
      ok: false,
      accepted: false,
      vehicle_id: carrierVehicle.vehicle_id,
      target_vehicle_id: targetVehicle.vehicle_id,
      seq,
      reason: 'vehicle_config_save_failed',
    };
    renderCompanionTestPrep();
    return;
  }

  runtimeState.manualReleaseTriggerState = 'SENDING';
  runtimeState.manualReleaseTriggerResult = {
    ok: false,
    accepted: false,
    vehicle_id: carrierVehicle.vehicle_id,
    target_vehicle_id: targetVehicle.vehicle_id,
    seq,
    reason: 'sending',
  };
  renderCompanionTestPrep();

  try {
    const response = await fetch(
      `${runtimeState.backendUrl}/api/drones/${encodeURIComponent(carrierVehicle.vehicle_id)}/manual-release-trigger`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          seq,
          target_vehicle_id: targetVehicle.vehicle_id,
        }),
      }
    );
    const responseBody = await response.json().catch(() => null);
    if (!response.ok) {
      runtimeState.manualReleaseTriggerResult = parseManualReleaseTriggerError(
        responseBody,
        carrierVehicle,
        targetVehicle,
        seq
      );
      runtimeState.manualReleaseTriggerState =
        runtimeState.manualReleaseTriggerResult.reason === 'timeout' ? 'TIMEOUT' : 'FAILED';
      return;
    }

    runtimeState.manualReleaseTriggerResult = responseBody;
    const manualResponse = responseBody?.result || responseBody?.response || responseBody;
    if (manualResponse?.type === 'MANUAL_RELEASE_TRIGGER_RESULT') {
      markRuntimeSeen(carrierVehicle.vehicle_id, manualResponse);
    }
    runtimeState.manualReleaseTriggerState = getManualReleaseStateFromResult(responseBody);
  } catch (error) {
    runtimeState.manualReleaseTriggerState = 'FAILED';
    runtimeState.manualReleaseTriggerResult = {
      ok: false,
      accepted: false,
      vehicle_id: carrierVehicle.vehicle_id,
      target_vehicle_id: targetVehicle.vehicle_id,
      seq,
      reason: 'request_failed',
      message: error.message,
    };
  } finally {
    renderCompanionTestPrep();
    renderRuntimeConnection();
  }
}

async function executeDebugChildKill() {
  const carrierVehicle = getSelectedVehicle();
  const pinnedTarget = getVehicles().find(
    (item) => item.vehicle_id === runtimeState.debugChildKillTargetVehicleId
  );
  const targetVehicle = pinnedTarget || (carrierVehicle ? getManualReleaseTarget(carrierVehicle) : null);
  const action = 'FORCE_DISARM';

  if (!carrierVehicle || normalizeVehicleRole(carrierVehicle.role) !== 'carrier' || !targetVehicle) {
    runtimeState.debugChildKillResult = {
      ok: false,
      accepted: false,
      vehicle_id: targetVehicle?.vehicle_id || '',
      action,
      reason: !carrierVehicle
        ? 'carrier_not_selected'
        : normalizeVehicleRole(carrierVehicle.role) !== 'carrier'
          ? 'selected_vehicle_not_carrier'
          : 'target_child_not_found',
    };
    renderCompanionTestPrep();
    return;
  }

  if (runtimeState.status !== 'BACKEND ONLINE') {
    runtimeState.debugChildKillResult = {
      ok: false,
      accepted: false,
      vehicle_id: targetVehicle.vehicle_id,
      action,
      reason: 'backend_not_online',
    };
    renderCompanionTestPrep();
    return;
  }

  runtimeState.debugChildKillTargetVehicleId = targetVehicle.vehicle_id;
  runtimeState.debugChildKillInFlight = true;
  runtimeState.debugChildKillResult = {
    ok: false,
    vehicle_id: targetVehicle.vehicle_id,
    action,
    reason: 'sending',
  };
  renderCompanionTestPrep();

  try {
    const response = await fetch(
      `${runtimeState.backendUrl}/api/drones/${encodeURIComponent(targetVehicle.vehicle_id)}/emergency`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ action }),
      }
    );
    const responseBody = await response.json().catch(() => null);

    if (!response.ok) {
      runtimeState.debugChildKillResult = parseEmergencyError(responseBody, action);
      return;
    }

    runtimeState.debugChildKillResult = responseBody;
    applyEmergencyResultToConnection(targetVehicle.vehicle_id, responseBody);
  } catch (error) {
    runtimeState.debugChildKillResult = {
      ok: false,
      vehicle_id: targetVehicle.vehicle_id,
      action,
      reason: 'request_failed',
      message: error.message,
    };
  } finally {
    runtimeState.debugChildKillInFlight = false;
    renderCompanionTestPrep();
    renderRuntimeConnection();
  }
}

async function executeDebugChildLand() {
  const carrierVehicle = getSelectedVehicle();
  const pinnedTarget = getVehicles().find(
    (item) => item.vehicle_id === runtimeState.debugChildKillTargetVehicleId
  );
  const targetVehicle = pinnedTarget || (carrierVehicle ? getManualReleaseTarget(carrierVehicle) : null);
  const action = 'LAND';

  if (!carrierVehicle || normalizeVehicleRole(carrierVehicle.role) !== 'carrier' || !targetVehicle) {
    runtimeState.debugChildLandResult = {
      ok: false,
      accepted: false,
      vehicle_id: targetVehicle?.vehicle_id || '',
      action,
      reason: !carrierVehicle
        ? 'carrier_not_selected'
        : normalizeVehicleRole(carrierVehicle.role) !== 'carrier'
          ? 'selected_vehicle_not_carrier'
          : 'target_child_not_found',
    };
    renderCompanionTestPrep();
    return;
  }

  if (runtimeState.status !== 'BACKEND ONLINE') {
    runtimeState.debugChildLandResult = {
      ok: false,
      accepted: false,
      vehicle_id: targetVehicle.vehicle_id,
      action,
      reason: 'backend_not_online',
    };
    renderCompanionTestPrep();
    return;
  }

  runtimeState.debugChildKillTargetVehicleId = targetVehicle.vehicle_id;
  runtimeState.debugChildLandInFlight = true;
  runtimeState.debugChildLandResult = {
    ok: false,
    vehicle_id: targetVehicle.vehicle_id,
    action,
    reason: 'sending',
  };
  renderCompanionTestPrep();

  try {
    const response = await fetch(
      `${runtimeState.backendUrl}/api/drones/${encodeURIComponent(targetVehicle.vehicle_id)}/emergency`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ action }),
      }
    );
    const responseBody = await response.json().catch(() => null);

    if (!response.ok) {
      runtimeState.debugChildLandResult = parseEmergencyError(responseBody, action);
      return;
    }

    runtimeState.debugChildLandResult = responseBody;
    applyEmergencyResultToConnection(targetVehicle.vehicle_id, responseBody);
  } catch (error) {
    runtimeState.debugChildLandResult = {
      ok: false,
      vehicle_id: targetVehicle.vehicle_id,
      action,
      reason: 'request_failed',
      message: error.message,
    };
  } finally {
    runtimeState.debugChildLandInFlight = false;
    renderCompanionTestPrep();
    renderRuntimeConnection();
  }
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

function markRuntimeSeen(vehicleId, response = {}) {
  if (!vehicleId) return;
  const now = Date.now();
  const current = runtimeState.vehicleConnections[vehicleId] || {};
  const health = response?.health && typeof response.health === 'object' ? response.health : {};
  const responseType = response?.type || current.last_status_type || null;
  runtimeState.vehicleConnections[vehicleId] = {
    ...current,
    vehicle_id: vehicleId,
    last_seen_ms: now,
    last_contact_ms: now,
    last_status_type: responseType,
    companion_alive: health.companion_alive ?? current.companion_alive ?? null,
    fc_connected: health.fc_connected !== undefined
      ? normalizeRuntimeFcState(health.fc_connected)
      : current.fc_connected,
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
  renderCompanionTestPrep();
  renderCompanionLinkTest();
}

function setRuntimeStatus(status, message = '') {
  runtimeState.status = status;
  runtimeState.message = message || runtimeState.message;
  renderRuntimeConnection();
  renderEmergencyControls();
  renderCompanionTestPrep();
  renderCompanionLinkTest();
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
      last_contact_ms: null,
      last_status_type: null,
      companion_alive: null,
      last_fc_heartbeat_ms: null,
      position: null,
      gps: null,
      nav_gate: null,
      mission: null,
      mission_progress: null,
      action_plan: null,
      trigger_feedback_ok: null,
      trigger_forwarded_ok: null,
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

function buildUnknownDroneConnection(vehicle, existing = {}) {
  return {
    vehicle_id: vehicle.vehicle_id,
    name: vehicle.name,
    role: vehicle.role,
    ip: vehicle.ip,
    udp_port: vehicle.udp_port,
    firmware_profile: vehicle.firmware_profile,
    connection_state: existing.connection_state || 'UNKNOWN',
    companion_state: existing.companion_state || 'UNKNOWN',
    fc_connected: existing.fc_connected || 'UNKNOWN',
    last_seen_ms: existing.last_seen_ms ?? null,
    last_contact_ms: existing.last_contact_ms ?? null,
    last_status_type: existing.last_status_type ?? null,
    companion_alive: existing.companion_alive ?? null,
    last_fc_heartbeat_ms: existing.last_fc_heartbeat_ms ?? null,
    position: existing.position ?? null,
    gps: existing.gps ?? null,
    nav_gate: existing.nav_gate ?? null,
    mission: existing.mission ?? null,
    mission_progress: existing.mission_progress ?? null,
    action_plan: existing.action_plan ?? null,
    trigger_feedback_ok: existing.trigger_feedback_ok ?? null,
    trigger_forwarded_ok: existing.trigger_forwarded_ok ?? null,
    release_state: existing.release_state ?? null,
    trigger_state: existing.trigger_state || 'UNKNOWN',
    last_trigger_seq: existing.last_trigger_seq ?? null,
    last_trigger_state: existing.last_trigger_state || 'UNKNOWN',
    last_trigger_reason: existing.last_trigger_reason ?? null,
    last_trigger_relationship_id: existing.last_trigger_relationship_id ?? null,
    last_trigger_target_vehicle_id: existing.last_trigger_target_vehicle_id ?? null,
    last_trigger_completed_ms: existing.last_trigger_completed_ms ?? null,
    last_ack_ms: existing.last_ack_ms ?? null,
    last_status_ms: existing.last_status_ms ?? null,
    rc_trigger_channel: existing.rc_trigger_channel ?? null,
    rc_trigger_threshold: existing.rc_trigger_threshold ?? null,
    rc_trigger_active: existing.rc_trigger_active ?? null,
    rc_trigger_latched: existing.rc_trigger_latched ?? null,
    emergency: existing.emergency ?? null,
    last_emergency_action: existing.last_emergency_action ?? null,
    last_emergency_result: existing.last_emergency_result ?? null,
    last_emergency_reason: existing.last_emergency_reason ?? null,
    last_emergency_seq: existing.last_emergency_seq ?? null,
    last_emergency_command_ms: existing.last_emergency_command_ms ?? null,
    reason: existing.reason || '',
    message: existing.message || '',
  };
}

function isKnownRuntimeConnectionState(value) {
  return ['UNKNOWN', 'CONNECTING', 'CONNECTED', 'OFFLINE', 'ERROR', 'DISCONNECTED'].includes(value);
}

function normalizeRuntimeConnectionState(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return isKnownRuntimeConnectionState(normalized) ? normalized : '';
}

function normalizeRuntimeFcState(value, fallback = 'UNKNOWN') {
  if (value === true) return 'CONNECTED';
  if (value === false) return 'DISCONNECTED';
  return normalizeRuntimeConnectionState(value) || fallback || 'UNKNOWN';
}

function getDroneHealth(result) {
  return result?.health && typeof result.health === 'object' ? result.health : {};
}

function getDroneStatusValue(result, key, fallback = undefined) {
  const health = getDroneHealth(result);
  return result?.[key] ?? health?.[key] ?? fallback;
}

function getDroneStatusType(result, existing = {}) {
  return result?.type || result?.response?.type || result?.status_type || existing.last_status_type || null;
}

function getCompanionConnectionState(result, existing = {}) {
  const statusType = getDroneStatusType(result, existing);
  const companionAlive = getDroneStatusValue(result, 'companion_alive', existing.companion_alive ?? null);
  if (statusType === 'STATUS' && companionAlive === true) return 'CONNECTED';
  if (statusType === 'STATUS' && companionAlive === false) return 'OFFLINE';

  return (
    normalizeRuntimeConnectionState(result?.companion_state) ||
    normalizeRuntimeConnectionState(result?.connection_state) ||
    normalizeRuntimeConnectionState(existing.companion_state) ||
    normalizeRuntimeConnectionState(existing.connection_state) ||
    'UNKNOWN'
  );
}

function mergeDroneConnectionResult(vehicleId, result, existing = {}) {
  const vehicle = getVehicles().find((item) => item.vehicle_id === vehicleId);
  const statusType = getDroneStatusType(result, existing);
  const companionAlive = getDroneStatusValue(result, 'companion_alive', existing.companion_alive ?? null);
  const companionState = getCompanionConnectionState(result, existing);
  const now = Date.now();
  const hasStatusContact = statusType === 'STATUS' && companionAlive === true;
  const lastSeenMs = getDroneStatusValue(
    result,
    'last_seen_ms',
    hasStatusContact ? now : existing.last_seen_ms ?? null
  );
  const connectionState = companionState === 'CONNECTED'
    ? 'CONNECTED'
    : normalizeRuntimeConnectionState(result?.connection_state) ||
      (companionState === 'DISCONNECTED' ? 'OFFLINE' : companionState);
  const fcConnected = normalizeRuntimeFcState(
    getDroneStatusValue(result, 'fc_connected'),
    existing.fc_connected || 'UNKNOWN'
  );
  const lastTriggerSeq = getDroneStatusValue(result, 'last_trigger_seq', existing.last_trigger_seq ?? null);
  if (
    lastTriggerSeq !== null &&
    lastTriggerSeq !== undefined &&
    lastTriggerSeq !== '' &&
    String(lastTriggerSeq) !== String(existing.last_trigger_seq ?? '')
  ) {
    runtimeState.lastTriggerSeenAtMs[vehicleId] = now;
  }
  return {
    ...existing,
    vehicle_id: vehicleId,
    name: vehicle?.name || result?.name || existing.name || vehicleId,
    role: vehicle?.role || result?.role || existing.role || 'unknown',
    ip: vehicle?.ip || result?.ip || existing.ip || '',
    udp_port: vehicle?.udp_port || result?.udp_port || existing.udp_port || '',
    firmware_profile: vehicle?.firmware_profile || result?.firmware_profile || existing.firmware_profile || '',
    connection_state: connectionState,
    companion_state: companionState,
    fc_connected: fcConnected,
    last_seen_ms: lastSeenMs,
    last_contact_ms: result ? now : existing.last_contact_ms ?? null,
    last_status_type: statusType,
    companion_alive: companionAlive,
    last_fc_heartbeat_ms: getDroneStatusValue(result, 'last_fc_heartbeat_ms', existing.last_fc_heartbeat_ms ?? null),
    position: getDroneStatusValue(result, 'position', existing.position ?? null),
    gps: getDroneStatusValue(result, 'gps', existing.gps ?? null),
    nav_gate: getDroneStatusValue(result, 'nav_gate', existing.nav_gate ?? null),
    mission: getDroneStatusValue(result, 'mission', existing.mission ?? null),
    mission_progress: getDroneStatusValue(result, 'mission_progress', existing.mission_progress ?? null),
    action_plan: getDroneStatusValue(result, 'action_plan', existing.action_plan ?? null),
    trigger_feedback_ok: getDroneStatusValue(result, 'trigger_feedback_ok', existing.trigger_feedback_ok ?? null),
    trigger_forwarded_ok: getDroneStatusValue(result, 'trigger_forwarded_ok', existing.trigger_forwarded_ok ?? null),
    release_state: getDroneStatusValue(result, 'release_state', existing.release_state ?? null),
    trigger_state: getDroneStatusValue(result, 'trigger_state', existing.trigger_state || 'UNKNOWN'),
    last_trigger_seq: lastTriggerSeq,
    last_trigger_state: getDroneStatusValue(result, 'last_trigger_state', existing.last_trigger_state || 'UNKNOWN'),
    last_trigger_reason: getDroneStatusValue(result, 'last_trigger_reason', existing.last_trigger_reason ?? null),
    last_trigger_relationship_id: getDroneStatusValue(result, 'last_trigger_relationship_id', existing.last_trigger_relationship_id ?? null),
    last_trigger_target_vehicle_id: getDroneStatusValue(result, 'last_trigger_target_vehicle_id', existing.last_trigger_target_vehicle_id ?? null),
    last_trigger_completed_ms: getDroneStatusValue(result, 'last_trigger_completed_ms', existing.last_trigger_completed_ms ?? null),
    last_ack_ms: getDroneStatusValue(result, 'last_ack_ms', existing.last_ack_ms ?? null),
    last_status_ms: getDroneStatusValue(result, 'last_status_ms', existing.last_status_ms ?? null),
    rc_trigger_channel: getDroneStatusValue(result, 'rc_trigger_channel', existing.rc_trigger_channel ?? null),
    rc_trigger_threshold: getDroneStatusValue(result, 'rc_trigger_threshold', existing.rc_trigger_threshold ?? null),
    rc_trigger_active: getDroneStatusValue(result, 'rc_trigger_active', existing.rc_trigger_active ?? null),
    rc_trigger_latched: getDroneStatusValue(result, 'rc_trigger_latched', existing.rc_trigger_latched ?? null),
    emergency: getDroneStatusValue(result, 'emergency', existing.emergency ?? null),
    last_emergency_action: getDroneStatusValue(result, 'last_emergency_action', result?.emergency?.last_action ?? existing.last_emergency_action ?? null),
    last_emergency_result: getDroneStatusValue(result, 'last_emergency_result', result?.emergency?.last_result ?? existing.last_emergency_result ?? null),
    last_emergency_reason: getDroneStatusValue(result, 'last_emergency_reason', result?.emergency?.last_reason ?? existing.last_emergency_reason ?? null),
    last_emergency_seq: getDroneStatusValue(result, 'last_emergency_seq', result?.emergency?.last_seq ?? existing.last_emergency_seq ?? null),
    last_emergency_command_ms: getDroneStatusValue(result, 'last_emergency_command_ms', result?.emergency?.last_command_ms ?? existing.last_emergency_command_ms ?? null),
    reason: result?.reason || existing.reason || '',
    message: result?.message || existing.message || '',
    seq: result?.seq ?? existing.seq,
    latency_ms: result?.latency_ms ?? existing.latency_ms,
  };
}

function getDroneConnectionSummary(connections = runtimeState.vehicleConnections) {
  const vehicles = getVehicles();
  const connectedCount = vehicles.filter((vehicle) => {
    const connection = connections[vehicle.vehicle_id];
    return getDisplayedCompanionState(connection) === 'CONNECTED';
  }).length;
  return {
    connectedCount,
    totalCount: vehicles.length,
    label: `${connectedCount}/${vehicles.length} companion connected`,
  };
}

function applyDroneStatusResults(results) {
  const nextConnections = {};

  for (const vehicle of getVehicles()) {
    nextConnections[vehicle.vehicle_id] = buildUnknownDroneConnection(
      vehicle,
      runtimeState.vehicleConnections[vehicle.vehicle_id] || {}
    );
  }

  for (const [vehicleId, result] of Object.entries(results || {})) {
    nextConnections[vehicleId] = mergeDroneConnectionResult(
      vehicleId,
      result,
      nextConnections[vehicleId] || {}
    );
  }

  runtimeState.vehicleConnections = nextConnections;
  updateLiveDroneMarkers(nextConnections);
  renderMissionSummary();
  renderEmergencyControls();
  renderCompanionTestPrep();
  renderMissionMonitor();
  renderRuntimeConnection();
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
    const results = await fetchDroneStatusResults();
    applyDroneStatusResults(results);
    const summary = getDroneConnectionSummary();
    runtimeState.message = summary.label;
    renderRuntimeConnection();
  } catch (error) {
    if (!silent) setRuntimeStatus('ERROR', `Drone status refresh failed: ${error.message}`);
  }
}

async function fetchDroneStatusResults() {
  const response = await fetch(`${runtimeState.backendUrl}/api/drones/status`, {
    method: 'GET',
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const statusBody = await response.json();
  if (!statusBody || statusBody.ok !== true) {
    throw new Error('Invalid drone status response');
  }

  return normalizeDroneStatusResponse(statusBody);
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
    const summary = getDroneConnectionSummary();
    if (!silent) {
      setRuntimeStatus(
        'BACKEND ONLINE',
        `Drone companion check complete: ${summary.label}.`
      );
      await refreshDroneStatus({ silent: true });
    } else {
      runtimeState.message = summary.label;
      renderRuntimeConnection();
    }
  } catch (error) {
    runtimeState.consecutiveDronePollingFailures += 1;
    try {
      const fallbackResults = await fetchDroneStatusResults();
      applyDroneStatusResults(fallbackResults);
      const summary = getDroneConnectionSummary();
      runtimeState.consecutiveDronePollingFailures = 0;
      if (!silent) {
        setRuntimeStatus(
          'BACKEND ONLINE',
          `Backend online, partial drone status loaded: ${summary.label}.`
        );
      } else {
        runtimeState.message = summary.label;
        renderRuntimeConnection();
      }
    } catch (fallbackError) {
      if (!silent || runtimeState.consecutiveDronePollingFailures >= 3) {
        renderRuntimeConnection();
      }
      if (!silent) {
        setRuntimeStatus(
          'ERROR',
          `Drone companion check failed: ${error.message}; status fallback failed: ${fallbackError.message}`
        );
      }
    }
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
    last_contact_ms: null,
    last_status_type: null,
    companion_alive: null,
    last_fc_heartbeat_ms: null,
    position: null,
    gps: null,
    nav_gate: null,
    mission: null,
    mission_progress: null,
    action_plan: null,
    trigger_feedback_ok: null,
    trigger_forwarded_ok: null,
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

function getDisplayedCompanionState(connection) {
  if (connection?.last_status_type === 'STATUS' && connection.companion_alive === true) {
    return 'CONNECTED';
  }
  if (connection?.last_status_type === 'STATUS' && connection.companion_alive === false) {
    return 'OFFLINE';
  }
  return connection?.companion_state || connection?.connection_state || 'UNKNOWN';
}

function getDisplayedFcState(connection) {
  return connection?.fc_connected || 'UNKNOWN';
}

function debugRuntimeConnectionCard(vehicle, connection, displayedCompanionState, displayedFcState) {
  if (!vehicle || normalizeVehicleRole(vehicle.role) !== 'carrier') return;
  const lastSeen = connection.last_seen_ms || connection.last_contact_ms || null;
  console.debug('[runtime connection carrier]', {
    vehicleId: vehicle.vehicle_id,
    displayedConnected: displayedCompanionState === 'CONNECTED',
    displayedCompanionState,
    displayedFcState,
    statusType: connection.last_status_type,
    companionAlive: connection.companion_alive,
    fcConnected: connection.fc_connected,
    lastSeen,
    ageMs: lastSeen ? Date.now() - lastSeen : null,
    manualReleaseState: runtimeState.manualReleaseTriggerState,
    reason: connection.reason,
    connectionState: connection.connection_state,
    companionState: connection.companion_state,
  });
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

function formatMissionMonitorBool(value) {
  if (value === true) return 'true';
  if (value === false) return 'false';
  return 'UNKNOWN';
}

function getMissionMonitorItemLabel(seq, mission, vehicle) {
  if (seq === null || seq === undefined || seq === '') return '-';
  const fcMissionItems = buildFcMissionItems(mission, vehicle);
  const missionItem = fcMissionItems.find((item) => Number(item.seq) === Number(seq));
  if (!missionItem) return '알 수 없음';

  if (missionItem.command === COMMAND.MAV_CMD_NAV_TAKEOFF) return 'TAKEOFF';
  if (missionItem.command === COMMAND.MAV_CMD_NAV_LAND) return 'LAND';

  const kind = String(missionItem.kind || '').trim().toLowerCase();
  if (kind === 'release') {
    const target = getVehicleById(missionItem.waypoint?.target_vehicle_id);
    return target ? `RELEASE → ${target.name || target.vehicle_id}` : 'RELEASE';
  }

  if (missionItem.command === COMMAND.MAV_CMD_NAV_WAYPOINT) return 'WAYPOINT';
  return String(missionItem.command_name || missionItem.kind || 'MISSION ITEM').toUpperCase();
}

function formatMissionMonitorActionPlan(actionPlan) {
  if (!actionPlan || typeof actionPlan !== 'object') return 'UNKNOWN';
  if (actionPlan.loaded === false) return 'NOT LOADED';
  if (actionPlan.loaded === true) {
    const count = actionPlan.action_count ?? actionPlan.actions?.length ?? actionPlan.pending_count ?? '-';
    return `LOADED (${count})`;
  }
  return 'UNKNOWN';
}

function getRelativeAgeLabel(timestampMs) {
  if (!timestampMs) return '-';
  const ageMs = Date.now() - Number(timestampMs);
  if (!Number.isFinite(ageMs) || ageMs < 0) return '-';
  if (ageMs < 1500) return '방금 전';
  if (ageMs < 60000) return `${Math.round(ageMs / 1000)}초 전`;
  if (ageMs < 3600000) return `${Math.round(ageMs / 60000)}분 전`;
  return `${Math.round(ageMs / 3600000)}시간 전`;
}

function formatTriggerResultLabel(state) {
  if (state === 'FORWARDED_TO_FC') return 'FC 전달 완료';
  if (state === 'FC_TRIGGER_FAILED') return 'FC 전달 실패';
  if (state === 'TRIGGER_RECEIVED') return '트리거 수신';
  if (state === 'CHILD_REJECTED_TRIGGER') return '자드론 거부';
  if (state === 'PENDING_CHILD_ACK') return '자드론 ACK 대기';
  if (!state || state === 'UNKNOWN') return '기록 없음';
  return state;
}

function formatRecentTrigger(connection, vehicleId) {
  if (!connection?.last_trigger_seq) return '기록 없음';
  const seenAt = runtimeState.lastTriggerSeenAtMs[vehicleId] || connection.last_trigger_completed_ms;
  const age = getRelativeAgeLabel(seenAt);
  const result = formatTriggerResultLabel(connection.last_trigger_state);
  return age === '-' ? result : `${result} · ${age}`;
}

function renderMissionMonitor() {
  const el = document.getElementById('missionMonitorOverlay');
  if (!el) return;

  const vehicle = getSelectedVehicle();
  const mission = getSelectedMission();
  if (!vehicle || !mission) {
    el.innerHTML = `
      <div class="mission-monitor-title">
        <span>미션 진행 상태</span>
      </div>
      <div class="mission-monitor-small">선택된 드론이 없습니다.</div>
    `;
    return;
  }

  const connection = getVehicleConnection(vehicle);
  const missionProgress = connection.mission_progress || {};
  const isCarrier = isCarrierConnection(connection, vehicle);
  const rows = [
    ['현재 목표', getMissionMonitorItemLabel(missionProgress.current_seq, mission, vehicle)],
    ['도달 완료 목표', getMissionMonitorItemLabel(missionProgress.last_reached_seq, mission, vehicle)],
    ['Armed', formatMissionMonitorBool(missionProgress.armed)],
    ['Mode', missionProgress.flight_mode || '-'],
  ];

  let detail = '';
  if (isCarrier) {
    rows.push(['릴리즈 상태', connection.release_state || 'UNKNOWN']);
    rows.push(['트리거 피드백', connection.last_trigger_state || 'UNKNOWN']);
    rows.push(['Action Plan', formatMissionMonitorActionPlan(connection.action_plan)]);
    detail = `Reason: ${connection.last_trigger_reason || '-'} / Target: ${connection.last_trigger_target_vehicle_id || '-'}`;
  } else {
    rows.push(['트리거 동작여부', formatMissionMonitorBool(connection.trigger_feedback_ok)]);
    detail = `Forwarded: ${formatMissionMonitorBool(connection.trigger_forwarded_ok)} / Last: ${connection.last_trigger_state || 'UNKNOWN'} / Reason: ${connection.last_trigger_reason || '-'}`;
  }

  el.innerHTML = `
    <div class="mission-monitor-title">
      <span>미션 진행 상태</span>
      <span class="mission-monitor-subtitle">${escapeHtml(formatVehicleRole(vehicle.role))}</span>
    </div>
    <div class="mission-monitor-grid">
      ${rows.map(([label, value]) => `
        <div class="mission-monitor-row">
          <div class="mission-monitor-label">${escapeHtml(label)}</div>
          <div class="mission-monitor-value" title="${escapeHtml(String(value))}">${escapeHtml(String(value))}</div>
        </div>
      `).join('')}
    </div>
    <div class="mission-monitor-small">${escapeHtml(detail)}</div>
  `;
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
    const companionState = getDisplayedCompanionState(connection);
    const fcState = getDisplayedFcState(connection);
    debugRuntimeConnectionCard(vehicle, connection, companionState, fcState);
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
        ['Release Input', formatReleaseInputState(connection.release_state)],
        ['RC Latched', formatRuntimeValue(connection.rc_trigger_latched)],
        ['Carrier Trigger', connection.trigger_state || 'UNKNOWN'],
        ['Child Delivery Result', connection.last_trigger_state || 'UNKNOWN'],
        ['Reason', connection.last_trigger_reason || connection.reason || '-'],
        ['Seq', formatRuntimeValue(connection.last_trigger_seq)],
        ['Target', formatRuntimeValue(connection.last_trigger_target_vehicle_id)]
      );
    } else {
      detailLines.push(
        ['최근 트리거', formatRecentTrigger(connection, vehicle.vehicle_id)],
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

function isChildVehicle(vehicle) {
  return normalizeVehicleRole(vehicle?.role) === 'child';
}

function getMissionProfile(vehicle) {
  return isChildVehicle(vehicle) ? 'air_arm_relative' : 'ground_home_relative';
}

function getAltitudeReference(vehicle) {
  return isChildVehicle(vehicle) ? 'air_arm_home' : 'ground_home';
}

function normalizeCarrierStepKind(kind) {
  const normalized = String(kind || '').toLowerCase();
  if (normalized === 'takeoff') return 'takeoff';
  if (normalized === 'release') return 'release';
  if (normalized === 'land') return 'land';
  return 'waypoint';
}

function normalizeChildStepKind(kind) {
  const normalized = String(kind || '').toLowerCase();
  if (normalized === 'takeoff') return 'takeoff';
  if (normalized === 'land') return 'land';
  return 'waypoint';
}

function getCarrierStepType(waypoint, vehicle, index) {
  return normalizeCarrierStepKind(waypoint?.kind || getWaypointKind(vehicle, index));
}

function getChildVehiclesForCarrier(vehicle) {
  return getVehicles().filter((candidate) => {
    if (normalizeVehicleRole(candidate.role) !== 'child') return false;
    return !candidate.parent_vehicle_id || candidate.parent_vehicle_id === vehicle?.vehicle_id;
  });
}

function getDefaultTargetChildId(vehicle) {
  return getChildVehiclesForCarrier(vehicle)[0]?.vehicle_id || '';
}

function ensureReleaseDefaults(waypoint, vehicle) {
  if (!waypoint || waypoint.kind !== 'release') return;
  waypoint.action = 'RELEASE';
  waypoint.target_vehicle_id = waypoint.target_vehicle_id || getDefaultTargetChildId(vehicle);
  waypoint.release = {
    ...DEFAULT_RELEASE_ACTUATOR,
  };
  waypoint.trigger = {
    ...DEFAULT_RELEASE_TRIGGER,
    ...(waypoint.trigger || {}),
  };
}

function clearReleaseFields(waypoint) {
  if (!waypoint || waypoint.kind === 'release') return;
  delete waypoint.target_vehicle_id;
  delete waypoint.release;
  delete waypoint.trigger;
  if (waypoint.action === 'RELEASE') waypoint.action = 'NONE';
}

function getWaypointKind(vehicle, index) {
  if (isChildVehicle(vehicle)) return 'waypoint';
  if (!isChildVehicle(vehicle) && index === 0 && state.qgcPlanSettings.useFirstAsTakeoff) return 'takeoff';
  return 'waypoint';
}

function getWaypointCommand(vehicle, index, waypoint = null) {
  const kind = isChildVehicle(vehicle)
    ? normalizeChildStepKind(waypoint?.kind || getWaypointKind(vehicle, index))
    : getCarrierStepType(waypoint, vehicle, index);
  if (kind === 'takeoff') return 'NAV_TAKEOFF';
  if (kind === 'land') return 'NAV_LAND';
  return 'NAV_WAYPOINT';
}

function getMavCommandForWaypoint(vehicle, index, waypoint = null) {
  const command = getWaypointCommand(vehicle, index, waypoint);
  if (command === 'NAV_TAKEOFF') return COMMAND.MAV_CMD_NAV_TAKEOFF;
  if (command === 'NAV_LAND') return COMMAND.MAV_CMD_NAV_LAND;
  return COMMAND.MAV_CMD_NAV_WAYPOINT;
}

function applyWaypointMetadata(mission, vehicle) {
  if (!mission || !vehicle) return;
  mission.role = normalizeVehicleRole(vehicle.role);
  mission.mission_profile = getMissionProfile(vehicle);
  mission.waypoints.forEach((waypoint, index) => {
    if (isChildVehicle(vehicle)) {
      waypoint.kind = normalizeChildStepKind(waypoint.kind || getWaypointKind(vehicle, index));
    } else {
      waypoint.kind = normalizeCarrierStepKind(waypoint.kind || getWaypointKind(vehicle, index));
    }
    waypoint.alt_reference = getAltitudeReference(vehicle);
    ensureReleaseDefaults(waypoint, vehicle);
    clearReleaseFields(waypoint);
    waypoint.command = getWaypointCommand(vehicle, index, waypoint);
  });
}

function assignFcMissionSeqs(mission, vehicle) {
  if (!mission || !vehicle) return;
  applyWaypointMetadata(mission, vehicle);
  mission.waypoints.forEach((waypoint, index) => {
    waypoint.fcMissionSeq = index;
  });
}

function buildFcMissionItems(mission, vehicle) {
  if (!mission || !vehicle) return [];
  assignFcMissionSeqs(mission, vehicle);
  return mission.waypoints.map((waypoint, index) => ({
    seq: waypoint.fcMissionSeq,
    waypoint,
    kind: waypoint.kind,
    alt_reference: waypoint.alt_reference,
    command_name: waypoint.command,
    command: getMavCommandForWaypoint(vehicle, index, waypoint),
    frame: COMMAND.MAV_FRAME_GLOBAL_RELATIVE_ALT,
    current: index === 0 ? 1 : 0,
    autocontinue: 1,
    param1: 0,
    param2: 0,
    param3: 0,
    param4: null,
    x: Number(waypoint.lat),
    y: Number(waypoint.lon),
    z: Number(waypoint.alt),
    action: waypoint.action || 'NONE',
  }));
}

function nearlyEqualNumber(a, b, epsilon = 1e-7) {
  return Number.isFinite(Number(a)) &&
    Number.isFinite(Number(b)) &&
    Math.abs(Number(a) - Number(b)) <= epsilon;
}

function findFcMissionItemForReleaseWaypoint(waypoint, fcMissionItems) {
  return fcMissionItems.find((item) =>
    item.command === COMMAND.MAV_CMD_NAV_WAYPOINT &&
    nearlyEqualNumber(item.x, waypoint.lat) &&
    nearlyEqualNumber(item.y, waypoint.lon) &&
    nearlyEqualNumber(item.z, waypoint.alt, 1e-3)
  ) || null;
}

function getDistanceMeters(a, b) {
  const earthRadiusMeters = 6371000;
  const lat1 = Number(a.lat) * Math.PI / 180;
  const lat2 = Number(b.lat) * Math.PI / 180;
  const dLat = (Number(b.lat) - Number(a.lat)) * Math.PI / 180;
  const dLon = (Number(b.lon) - Number(a.lon)) * Math.PI / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function getReleaseWaypoints(mission, vehicle) {
  if (!mission || !vehicle || isChildVehicle(vehicle)) return [];
  assignFcMissionSeqs(mission, vehicle);
  return mission.waypoints.filter((waypoint, index) =>
    waypoint.kind === 'release' &&
    getMavCommandForWaypoint(vehicle, index, waypoint) === COMMAND.MAV_CMD_NAV_WAYPOINT
  );
}

function buildCarrierActionPlanPayload(mission, vehicle) {
  if (!mission || !vehicle || isChildVehicle(vehicle)) return null;
  const fcMissionItems = buildFcMissionItems(mission, vehicle);
  const vehiclesById = new Map(getVehicles().map((item) => [item.vehicle_id, item]));
  const actions = getReleaseWaypoints(mission, vehicle).map((waypoint) => {
    const target = vehiclesById.get(waypoint.target_vehicle_id);
    const matchedFcItem = findFcMissionItemForReleaseWaypoint(waypoint, fcMissionItems);
    const fcMissionSeq = matchedFcItem?.seq;
    const release = { ...DEFAULT_RELEASE_ACTUATOR };
    const trigger = {
      ...DEFAULT_RELEASE_TRIGGER,
      ...(waypoint.trigger || {}),
      target_ip: target?.ip || '',
      target_port: Number(target?.udp_port) || 50051,
    };

    console.debug('[action plan release seq]', {
      vehicle_id: vehicle.vehicle_id,
      mission_id: mission.mission_id,
      displaySeq: waypoint.seq,
      waypointKind: waypoint.kind,
      waypointCommand: waypoint.command,
      waypointLat: Number(waypoint.lat),
      waypointLon: Number(waypoint.lon),
      waypointAlt: Number(waypoint.alt),
      matchedFcSeq: fcMissionSeq,
      matchedFcCommand: matchedFcItem?.command,
      matchedFcKind: matchedFcItem?.kind,
      fcMissionItems: fcMissionItems.map((item) => ({
        seq: item.seq,
        command: item.command,
        kind: item.kind,
        x: item.x,
        y: item.y,
        z: item.z,
      })),
    });

    return {
      action_id: `wp_${fcMissionSeq ?? 'unmatched'}_release_${waypoint.target_vehicle_id || 'unassigned'}`,
      trigger_waypoint_seq: fcMissionSeq,
      target_vehicle_id: waypoint.target_vehicle_id || '',
      type: 'RELEASE_AND_TRIGGER_CHILD',
      release,
      trigger,
    };
  });

  return {
    type: 'ACTION_PLAN_UPLOAD',
    vehicle_id: vehicle.vehicle_id,
    mission_id: mission.mission_id,
    actions,
  };
}

function validateCarrierActionPlan(mission, vehicle) {
  const errors = [];
  const warnings = [];
  if (!mission || !vehicle || isChildVehicle(vehicle)) return { errors, warnings };

  applyWaypointMetadata(mission, vehicle);
  const fcMissionItems = buildFcMissionItems(mission, vehicle);
  const vehiclesById = new Map(getVehicles().map((item) => [item.vehicle_id, item]));
  const releaseWaypoints = getReleaseWaypoints(mission, vehicle);
  const takeoffIndex = mission.waypoints.findIndex((waypoint) => waypoint.kind === 'takeoff');
  const landIndex = mission.waypoints.findIndex((waypoint) => waypoint.kind === 'land');
  const seenTargets = new Set();

  if (takeoffIndex < 0) errors.push('Carrier mission에 TAKEOFF가 없습니다.');
  if (landIndex < 0) errors.push('Carrier mission에 LAND가 없습니다.');

  for (const waypoint of releaseWaypoints) {
    const index = mission.waypoints.indexOf(waypoint);
    if (!Number.isFinite(Number(waypoint.lat)) || !Number.isFinite(Number(waypoint.lon)) || !Number.isFinite(Number(waypoint.alt))) {
      errors.push(`WP${waypoint.seq}: RELEASE lat/lon/alt가 필요합니다.`);
    }
    const matchedFcItem = findFcMissionItemForReleaseWaypoint(waypoint, fcMissionItems);
    if (!matchedFcItem) {
      errors.push(`WP${waypoint.seq}: RELEASE 좌표와 일치하는 FC NAV_WAYPOINT item을 찾을 수 없습니다.`);
    }
    if (landIndex >= 0 && index > landIndex) {
      errors.push(`WP${waypoint.seq}: RELEASE item이 LAND 이후에 있습니다.`);
    }
    if (!waypoint.target_vehicle_id) {
      errors.push(`WP${waypoint.seq}: RELEASE target child가 없습니다.`);
    } else {
      const target = vehiclesById.get(waypoint.target_vehicle_id);
      if (!target) {
        errors.push(`WP${waypoint.seq}: target child ${waypoint.target_vehicle_id}를 찾을 수 없습니다.`);
      } else if (normalizeVehicleRole(target.role) !== 'child') {
        errors.push(`WP${waypoint.seq}: target ${waypoint.target_vehicle_id} role이 child가 아닙니다.`);
      } else {
        if (!target.ip) errors.push(`WP${waypoint.seq}: target child ${waypoint.target_vehicle_id} IP가 없습니다.`);
        const targetPort = Number(target.udp_port);
        if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) {
          errors.push(`WP${waypoint.seq}: target child ${waypoint.target_vehicle_id} UDP port가 유효하지 않습니다.`);
        }
      }
      if (seenTargets.has(waypoint.target_vehicle_id)) {
        warnings.push(`WP${waypoint.seq}: 같은 child ${waypoint.target_vehicle_id}가 여러 RELEASE item에 지정되었습니다.`);
      }
      seenTargets.add(waypoint.target_vehicle_id);
    }

    const release = waypoint.release || {};
    const trigger = waypoint.trigger || {};
    if (!waypoint.release) warnings.push(`WP${waypoint.seq}: release actuator 설정이 없습니다.`);
    if (!waypoint.trigger) warnings.push(`WP${waypoint.seq}: child trigger 설정이 없습니다.`);
    if (
      release.method !== DEFAULT_RELEASE_ACTUATOR.method ||
      Number(release.actuator_index) !== DEFAULT_RELEASE_ACTUATOR.actuator_index ||
      Number(release.value) !== DEFAULT_RELEASE_ACTUATOR.value ||
      Number(release.hold_ms) !== DEFAULT_RELEASE_ACTUATOR.hold_ms ||
      Number(release.reset_value) !== DEFAULT_RELEASE_ACTUATOR.reset_value
    ) {
      warnings.push(`WP${waypoint.seq}: release actuator 설정이 검증된 AUX1 기본값과 다릅니다.`);
    }
    if (Number(release.value) < -1.0 || Number(release.value) > 1.0) {
      errors.push(`WP${waypoint.seq}: release value는 -1.0~1.0 범위여야 합니다.`);
    }
    if (Number(release.reset_value) < -1.0 || Number(release.reset_value) > 1.0) {
      errors.push(`WP${waypoint.seq}: release reset_value는 -1.0~1.0 범위여야 합니다.`);
    }
    if (!Number.isFinite(Number(release.hold_ms)) || Number(release.hold_ms) < 0) {
      errors.push(`WP${waypoint.seq}: release hold_ms는 0 이상이어야 합니다.`);
    }
    if (Number(waypoint.alt) < 5) {
      warnings.push(`WP${waypoint.seq}: release altitude가 낮습니다.`);
    }
    if (trigger.type && trigger.type !== DEFAULT_RELEASE_TRIGGER.type) {
      warnings.push(`WP${waypoint.seq}: 알 수 없는 trigger type ${trigger.type}입니다.`);
    }
  }

  if (mission.waypoints.length > 0 && takeoffIndex > 0) warnings.push('Carrier TAKEOFF가 첫 item이 아닙니다.');
  if (landIndex >= 0 && landIndex !== mission.waypoints.length - 1) warnings.push('Carrier LAND가 마지막 item이 아닙니다.');

  return { errors, warnings };
}

function validateMissionForVehicle(mission, vehicle) {
  const errors = [];
  const warnings = [];
  if (!mission || !vehicle) {
    errors.push('vehicle이 없습니다. Add Vehicle로 먼저 등록하세요.');
    return { errors, warnings };
  }

  applyWaypointMetadata(mission, vehicle);
  if (mission.waypoints.length === 0) {
    errors.push('waypoint가 없습니다.');
    return { errors, warnings };
  }

  if (isChildVehicle(vehicle)) {
    warnings.push('자드론 미션 고도는 지상 기준 고도가 아니라 공중 Home 기준 offset입니다.');
    const first = mission.waypoints[0];
    if (getMavCommandForWaypoint(vehicle, 0, first) !== COMMAND.MAV_CMD_NAV_TAKEOFF && Number(first.alt) > 2) {
      warnings.push('Child WP1 altitude offset이 2m보다 큽니다. 초기 테스트는 0~1m를 권장합니다.');
    }
    if (mission.waypoints.length >= 2) {
      const distance = getDistanceMeters(mission.waypoints[0], mission.waypoints[1]);
      if (distance > 10) {
        warnings.push(`Child WP1→WP2 거리가 ${distance.toFixed(1)}m입니다. 초기 테스트는 2~5m를 권장합니다.`);
      }
    }
  } else {
    const carrierValidation = validateCarrierActionPlan(mission, vehicle);
    errors.push(...carrierValidation.errors);
    warnings.push(...carrierValidation.warnings);
  }

  return { errors, warnings };
}

function nextAltitude(m) {
  const vehicle = getSelectedVehicle();
  if (vehicle && isChildVehicle(vehicle) && m.waypoints.length === 0) return 0;
  if (m.waypoints.length > 0) return Number(m.waypoints[m.waypoints.length - 1].alt);
  const v = Number(document.getElementById('defaultAlt').value);
  if (vehicle && isChildVehicle(vehicle)) return Number.isFinite(v) && v >= 0 ? v : 0;
  return Number.isFinite(v) && v > 0 ? v : 10;
}

function clearMissionResultLog() {
  runtimeState.missionResultVehicleId = null;
  runtimeState.missionResultHtml = '';
}

function addWaypoint(lat, lon) {
  const m = getSelectedMission();
  const vehicle = getSelectedVehicle();
  if (!m) {
    alert('Add a vehicle before adding waypoints.');
    return;
  }

  const index = m.waypoints.length;
  m.waypoints.push({
    seq: index + 1,
    kind: getWaypointKind(vehicle, index),
    lat: round(lat, 7),
    lon: round(lon, 7),
    alt: nextAltitude(m),
    alt_reference: getAltitudeReference(vehicle),
    command: getWaypointCommand(vehicle, index),
    action: 'NONE',
  });
  applyWaypointMetadata(m, vehicle);
  m.uploadState = 'Editing';
  clearMissionResultLog();
  renderAll();
}

function deleteWaypoint(index) {
  const m = getSelectedMission();
  if (!m) return;

  m.waypoints.splice(index, 1);
  resequence(m);
  clearMissionResultLog();
  renderAll();
}

function clearSelectedMission() {
  const vehicle = getSelectedVehicle();
  const mission = getSelectedMission();
  if (!vehicle || !mission) return;

  if (mission.waypoints.length === 0) return;

  if (confirm(`${vehicle.name} waypoint를 모두 삭제할까요?`)) {
    mission.waypoints = [];
    mission.uploadState = 'Editing';
    clearMissionResultLog();
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
  const altitudeHeader = document.getElementById('waypointAltitudeHeader');

  tbody.innerHTML = '';
  if (altitudeHeader) {
    altitudeHeader.textContent = vehicle && isChildVehicle(vehicle) ? 'Offset' : '고도';
  }

  if (!mission || !vehicle) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="5" class="empty-state">No vehicle selected.</td>';
    tbody.appendChild(tr);
    return;
  }

  assignFcMissionSeqs(mission, vehicle);

  mission.waypoints.forEach((wp, idx) => {
    const tr = document.createElement('tr');
    const isCarrier = !isChildVehicle(vehicle);
    const childOptions = getChildVehiclesForCarrier(vehicle);
    const commandLabel = getWaypointCommand(vehicle, idx, wp);
    const commandValue = getMavCommandForWaypoint(vehicle, idx, wp);

    tr.innerHTML = `
      <td>${escapeHtml(wp.fcMissionSeq ?? idx)}<br><span class="hint">UI WP${escapeHtml(wp.seq)}</span></td>
      <td class="latlon">${wp.lat.toFixed(7)}<br>${wp.lon.toFixed(7)}</td>
      <td><input class="small" type="number" step="1" value="${wp.alt}" data-idx="${idx}" data-field="alt" /></td>
      <td class="action-cell"></td>
      <td><button data-delete="${idx}">삭제</button></td>
    `;

    const actionCell = tr.querySelector('.action-cell');
    if (isCarrier) {
      const stepSelect = document.createElement('select');
      stepSelect.dataset.field = 'stepType';
      stepSelect.dataset.idx = idx;
      for (const stepType of CARRIER_STEP_TYPES) {
        const opt = document.createElement('option');
        opt.value = stepType.toLowerCase();
        opt.textContent = stepType;
        if (wp.kind === opt.value) opt.selected = true;
        stepSelect.appendChild(opt);
      }
      actionCell.appendChild(stepSelect);

      if (wp.kind === 'release') {
        const release = wp.release || DEFAULT_RELEASE_ACTUATOR;
        const target = getVehicles().find((item) => item.vehicle_id === wp.target_vehicle_id);
        const details = document.createElement('div');
        details.className = 'release-controls';
        details.innerHTML = `
          <label>Target Child</label>
          <select data-field="target_vehicle_id" data-idx="${idx}">
            <option value="">Select child</option>
            ${childOptions.map((child) => `
              <option value="${escapeHtml(child.vehicle_id)}" ${child.vehicle_id === wp.target_vehicle_id ? 'selected' : ''}>
                ${escapeHtml(child.name || child.vehicle_id)}
              </option>
            `).join('')}
          </select>
          <div class="release-actuator-summary">
            Release: ${escapeHtml(release.method)} · Actuator ${escapeHtml(release.actuator_index)} · open ${escapeHtml(release.value)} · hold ${escapeHtml(release.hold_ms)}ms · reset ${escapeHtml(release.reset_value)}
          </div>
          <div class="hint">FC export: NAV_WAYPOINT/16 · AUX1 via Actuator Set 1 · Trigger: ${escapeHtml(wp.trigger?.type || DEFAULT_RELEASE_TRIGGER.type)}${target ? ` · ${escapeHtml(target.ip || '-')}:${escapeHtml(target.udp_port || '-')}` : ''}</div>
        `;
        actionCell.appendChild(details);
      } else {
        const hint = document.createElement('div');
        hint.className = 'hint';
        hint.textContent = `FC export: ${commandLabel}/${commandValue}`;
        actionCell.appendChild(hint);
      }
    } else {
      const stepSelect = document.createElement('select');
      stepSelect.dataset.field = 'stepType';
      stepSelect.dataset.idx = idx;
      for (const stepType of CHILD_STEP_TYPES) {
        const opt = document.createElement('option');
        opt.value = stepType.toLowerCase();
        opt.textContent = stepType;
        if (wp.kind === opt.value) opt.selected = true;
        stepSelect.appendChild(opt);
      }
      actionCell.appendChild(stepSelect);

      const hint = document.createElement('div');
      hint.className = 'hint';
      hint.textContent = `FC export: ${commandLabel}/${commandValue} / ${wp.alt_reference || 'air_arm_home'}`;
      actionCell.appendChild(hint);
    }
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('input[data-field="alt"]').forEach(input => {
    input.addEventListener('change', (e) => {
      const idx = Number(e.target.dataset.idx);
      const alt = Number(e.target.value);

      if (Number.isFinite(alt)) {
        mission.waypoints[idx].alt = alt;
        mission.uploadState = 'Editing';
        clearMissionResultLog();
        renderAll();
      }
    });
  });

  tbody.querySelectorAll('select[data-field="action"]').forEach(sel => {
    sel.addEventListener('change', (e) => {
      const idx = Number(e.target.dataset.idx);
      mission.waypoints[idx].action = e.target.value;
      mission.uploadState = 'Editing';
      clearMissionResultLog();
      renderAll();
    });
  });

  tbody.querySelectorAll('select[data-field="stepType"]').forEach(sel => {
    sel.addEventListener('change', (e) => {
      const idx = Number(e.target.dataset.idx);
      const waypoint = mission.waypoints[idx];
      waypoint.kind = isChildVehicle(vehicle)
        ? normalizeChildStepKind(e.target.value)
        : normalizeCarrierStepKind(e.target.value);
      if (waypoint.kind === 'release') {
        ensureReleaseDefaults(waypoint, vehicle);
      } else {
        clearReleaseFields(waypoint);
      }
      waypoint.command = getWaypointCommand(vehicle, idx, waypoint);
      mission.uploadState = 'Editing';
      clearMissionResultLog();
      renderAll();
    });
  });

  tbody.querySelectorAll('select[data-field="target_vehicle_id"]').forEach(sel => {
    sel.addEventListener('change', (e) => {
      const idx = Number(e.target.dataset.idx);
      mission.waypoints[idx].target_vehicle_id = e.target.value;
      ensureReleaseDefaults(mission.waypoints[idx], vehicle);
      mission.uploadState = 'Editing';
      clearMissionResultLog();
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

      const stepLabel = wp.kind === 'release'
        ? `RELEASE ${wp.target_vehicle_id || ''}`.trim()
        : (wp.kind || 'waypoint').toUpperCase();
      marker.bindPopup(
        `${escapeHtml(vehicle.name)} WP${wp.seq}<br>${escapeHtml(stepLabel)}<br>Alt ${wp.alt} m`
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

function buildMissionSummaryLines(mission, vehicle) {
  if (!mission || !vehicle) return [];
  applyWaypointMetadata(mission, vehicle);
  const roleLabel = formatVehicleRole(vehicle.role);
  const profileLabel = isChildVehicle(vehicle)
    ? 'Air-arm home relative'
    : 'Ground-home relative';
  const lines = [
    `Vehicle: ${vehicle.vehicle_id}`,
    `Role: ${roleLabel}`,
    `Profile: ${profileLabel}`,
    `WP count: ${mission.waypoints.length}`,
  ];

  const summaryWaypoints = isChildVehicle(vehicle)
    ? mission.waypoints.slice(0, 2)
    : mission.waypoints;
  summaryWaypoints.forEach((waypoint, index) => {
    const altLabel = isChildVehicle(vehicle) ? 'Altitude offset' : 'Altitude';
    const command = getWaypointCommand(vehicle, index, waypoint);
    let line = `WP${waypoint.seq}: ${(waypoint.kind || 'mission').toUpperCase()} / ${command} / ${altLabel}: ${waypoint.alt}m`;
    if (waypoint.kind === 'release') {
      const target = getVehicles().find((item) => item.vehicle_id === waypoint.target_vehicle_id);
      const release = waypoint.release || {};
      line += ` / target: ${waypoint.target_vehicle_id || '-'} / actuator ${release.actuator_index || '-'} open ${release.value ?? '-'} reset ${release.reset_value ?? '-'} ${release.hold_ms || '-'}ms`;
      if (target) line += ` / trigger: ${target.ip || '-'}:${target.udp_port || '-'}`;
    }
    lines.push(line);
  });

  const actionPlan = buildCarrierActionPlanPayload(mission, vehicle);
  if (actionPlan?.actions?.length) {
    lines.push(`Action plan actions: ${actionPlan.actions.length}`);
  }

  return lines;
}

function formatMissionValidationResult(validation, summaryLines = []) {
  const lines = [...summaryLines];
  if (validation.errors.length) {
    lines.push('', 'Errors:', ...validation.errors.map((item) => `- ${item}`));
  }
  if (validation.warnings.length) {
    lines.push('', 'Warnings:', ...validation.warnings.map((item) => `- ${item}`));
  }
  if (!validation.errors.length && !validation.warnings.length) {
    lines.push('', 'Mission validation OK.');
  }

  return `<pre>${escapeHtml(lines.join('\n'))}</pre>`;
}

function formatActionPlanRows(actionPlan) {
  const actions = (actionPlan?.actions || []).filter(
    (action) => !String(action.action_id || '').startsWith('manual_release_trigger_')
  );
  if (!actions.length) return '';
  const rows = actions.map((action) => {
    const release = action.release || {};
    const trigger = action.trigger || {};
    return `
      <tr>
        <td>${escapeHtml(action.trigger_waypoint_seq ?? '-')}</td>
        <td>RELEASE</td>
        <td>${escapeHtml(action.target_vehicle_id || '-')}</td>
        <td>NAV_WAYPOINT/16</td>
        <td>Act${escapeHtml(release.actuator_index ?? '-')} open ${escapeHtml(release.value ?? '-')} reset ${escapeHtml(release.reset_value ?? '-')} ${escapeHtml(release.hold_ms ?? '-')}ms</td>
        <td>${escapeHtml(trigger.target_ip || '-')}:${escapeHtml(trigger.target_port || '-')}</td>
        <td>${action.target_vehicle_id ? 'OK' : 'Missing target'}</td>
      </tr>
    `;
  }).join('');

  return `
    <div class="hint" style="margin-top:10px;">Carrier ACTION_PLAN_UPLOAD preview</div>
    <table class="mission-result-table">
      <thead>
        <tr><th>Seq</th><th>Step Type</th><th>Target Child</th><th>FC Export Command</th><th>Release</th><th>Trigger Target</th><th>Validation</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function getSelectedActionPlanHtml() {
  const mission = getSelectedMission();
  const vehicle = getSelectedVehicle();
  if (!mission || !vehicle || isChildVehicle(vehicle)) return '';
  return formatActionPlanRows(buildCarrierActionPlanPayload(mission, vehicle));
}

function renderMissionSummary() {
  const m = getSelectedMission();
  const selectedVehicle = getSelectedVehicle();
  const liveMarkerCount = [...liveDroneMarkers.values()]
    .filter((marker) => map.hasLayer(marker))
    .length;
  const defaultAltLabel = document.getElementById('defaultAltLabel');
  const altitudeHelp = document.getElementById('altitudeHelp');
  const validationBox = document.getElementById('missionValidationBox');
  const validateButton = document.getElementById('validateMissionBtn');
  const loadFcMissionButton = document.getElementById('loadFcMissionBtn');
  const uploadVerifyButton = document.getElementById('uploadVerifyMissionBtn');
  const missionStartButton = document.getElementById('missionStartBtn');
  const missionStartResultBox = document.getElementById('missionStartResult');
  const childMissionControlHint = document.getElementById('childMissionControlHint');

  if (m && selectedVehicle) {
    applyWaypointMetadata(m, selectedVehicle);
  }

  if (defaultAltLabel && altitudeHelp) {
    if (selectedVehicle && isChildVehicle(selectedVehicle)) {
      defaultAltLabel.textContent = '기본 Offset m';
      altitudeHelp.textContent = 'Altitude Offset / Air-arm home relative altitude. 0m는 nav_gate 공중 Home 고도 유지를 의미합니다.';
      if (m && m.waypoints.length === 0) {
        document.getElementById('defaultAlt').value = 0;
      }
    } else {
      defaultAltLabel.textContent = '기본 고도 m';
      altitudeHelp.textContent = 'Altitude / Ground-home relative altitude. 지상 Home 기준 상대고도입니다.';
    }
  }

  document.getElementById('wpCount').value = m ? m.waypoints.length : 0;
  document.getElementById('missionState').value = m ? m.uploadState : 'No vehicle';
  document.getElementById('exportQgcBtn').disabled = !m;
  if (validateButton) {
    validateButton.disabled = !m;
    validateButton.textContent = '미션 검증';
  }
  if (loadFcMissionButton) {
    loadFcMissionButton.disabled = !selectedVehicle || runtimeState.status !== 'BACKEND ONLINE';
    loadFcMissionButton.textContent = 'FC 미션 불러오기';
  }
  if (uploadVerifyButton) {
    uploadVerifyButton.disabled = !m || runtimeState.status !== 'BACKEND ONLINE';
    uploadVerifyButton.textContent = '미션 업로드';
  }
  if (missionStartButton) {
    const isCarrier = selectedVehicle && normalizeVehicleRole(selectedVehicle.role) === 'carrier';
    const isBusy = runtimeState.missionStartState === 'SENDING';
    const readiness = getMissionStartReadiness(selectedVehicle);
    missionStartButton.classList.toggle('hidden', Boolean(selectedVehicle && !isCarrier));
    missionStartButton.disabled = !isCarrier || !readiness.ready || isBusy;
    missionStartButton.textContent = isBusy ? '미션 시작 중...' : '미션 시작';
    missionStartButton.title = readiness.ready
      ? 'Carrier mission start confirmation을 엽니다.'
      : `Mission Start 대기: ${readiness.reason}`;
  }
  if (missionStartResultBox) {
    const isCarrier = selectedVehicle && normalizeVehicleRole(selectedVehicle.role) === 'carrier';
    missionStartResultBox.classList.toggle('hidden', Boolean(selectedVehicle && !isCarrier));
    missionStartResultBox.textContent = formatMissionStartResult(selectedVehicle);
  }
  if (childMissionControlHint) {
    childMissionControlHint.classList.toggle('hidden', !(selectedVehicle && isChildVehicle(selectedVehicle)));
  }
  document.getElementById('clearMissionBtn').disabled = !m || m.waypoints.length === 0;
  document.getElementById('clearMissionBtn').textContent = '선택한 웨이포인트 삭제';
  document.getElementById('focusSelectedBtn').disabled =
    !selectedVehicle || !getLivePositionForVehicle(selectedVehicle.vehicle_id);
  document.getElementById('focusSelectedBtn').textContent = '선택 드론으로 이동';
  document.getElementById('fitLiveDronesBtn').disabled = liveMarkerCount === 0;
  document.getElementById('fitLiveDronesBtn').textContent = '전체 드론 보기';

  if (
    validationBox &&
    selectedVehicle &&
    runtimeState.missionResultVehicleId === selectedVehicle.vehicle_id &&
    runtimeState.missionResultHtml
  ) {
    validationBox.innerHTML = runtimeState.missionResultHtml;
  } else if (validationBox && m && selectedVehicle) {
    validationBox.innerHTML = formatMissionValidationResult(
      validateMissionForVehicle(m, selectedVehicle),
      buildMissionSummaryLines(m, selectedVehicle)
    ) + getSelectedActionPlanHtml();
  } else if (validationBox) {
    validationBox.textContent = 'No vehicle selected.';
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
    if (isChildVehicle(vehicle)) {
      if (Number(wp.alt) < 0) warnings.push(`WP${wp.seq}: altitude offset이 0 미만입니다.`);
    } else if (Number(wp.alt) <= 0) {
      warnings.push(`WP${wp.seq}: altitude가 0 이하입니다.`);
    }
  }

  const roleValidation = validateMissionForVehicle(mission, vehicle);
  errors.push(...roleValidation.errors.filter((error) => !errors.includes(error)));
  warnings.push(...roleValidation.warnings.filter((warning) => !warnings.includes(warning)));

  if (vehicle && normalizeVehicleRole(vehicle.role) === 'carrier') {
    const releases = mission.waypoints.filter(wp => wp.action && wp.action.startsWith('RELEASE'));
    if (releases.length === 0) warnings.push('carrier mission에 release action이 없습니다.');
  }

  return { errors, warnings };
}

function buildMissionUploadPayload(mission, vehicle) {
  if (!mission || !vehicle) return null;

  const fcMissionItems = buildFcMissionItems(mission, vehicle);
  const payload = {
    vehicle_id: vehicle.vehicle_id,
    vehicle_name: vehicle.name,
    role: normalizeVehicleRole(vehicle.role),
    mission_id: mission.mission_id,
    mission_profile: getMissionProfile(vehicle),
    altitude_reference: getAltitudeReference(vehicle),
    items: fcMissionItems.map(({ waypoint, ...item }) => item),
  };

  const actionPlan = buildCarrierActionPlanPayload(mission, vehicle);
  if (actionPlan) payload.action_plan = actionPlan;
  return payload;
}

function showMissionValidation(validation, summaryLines = []) {
  const validationBox = document.getElementById('missionValidationBox');
  if (!validationBox) return;
  const selectedVehicle = getSelectedVehicle();
  const html = formatMissionValidationResult(validation, summaryLines) + getSelectedActionPlanHtml();
  runtimeState.missionResultVehicleId = selectedVehicle?.vehicle_id || null;
  runtimeState.missionResultHtml = html;
  validationBox.innerHTML = html;
}

function formatMissionItemRows(items = []) {
  if (!Array.isArray(items) || items.length === 0) {
    return '<div class="hint">No read-back items.</div>';
  }

  const rows = items.map((item, index) => `
    <tr>
      <td>${escapeHtml(item.seq ?? index)}</td>
      <td>${escapeHtml(item.frame ?? '-')}</td>
      <td>${escapeHtml(item.command ?? '-')}</td>
      <td>${escapeHtml(formatNumber(item.x, 7))}</td>
      <td>${escapeHtml(formatNumber(item.y, 7))}</td>
      <td>${escapeHtml(formatNumber(item.z, 2))}</td>
    </tr>
  `).join('');

  return `
    <table class="mission-result-table">
      <thead>
        <tr><th>Seq</th><th>Frame</th><th>Cmd</th><th>Lat</th><th>Lon</th><th>Z</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function showMissionOperationResult(title, response, mission, vehicle) {
  const validationBox = document.getElementById('missionValidationBox');
  if (!validationBox) return;

  const upload = response.upload || null;
  const download = response.download || null;
  const verification = response.verification || null;
  const validation = response.validation || null;
  const lines = [
    ...buildMissionSummaryLines(mission, vehicle),
    '',
    `${title}: ${response.ok ? 'OK' : 'FAILED'}`,
  ];

  if (validation) {
    lines.push(`Validation: ${validation.ok ? 'OK' : 'FAILED'}`);
    if (validation.errors?.length) lines.push(...validation.errors.map((error) => `- ${error}`));
    if (validation.warnings?.length) lines.push(...validation.warnings.map((warning) => `- ${warning}`));
  }
  if (upload) {
    lines.push(`Upload ok: ${upload.ok ? 'true' : 'false'}`);
    lines.push(`Upload reason: ${upload.reason || '-'}`);
    lines.push(`Uploaded count: ${upload.uploaded_count ?? upload.request?.items?.length ?? '-'}`);
  }
  if (download) {
    lines.push(`Read-back ok: ${download.ok ? 'true' : 'false'}`);
    lines.push(`Read-back reason: ${download.reason || '-'}`);
    lines.push(`Read-back count: ${download.downloaded_count ?? download.items?.length ?? '-'}`);
  }
  if (verification) {
    lines.push(`Verified: ${verification.verified ? 'true' : 'false'}`);
    if (verification.errors?.length) lines.push('Verification errors:', ...verification.errors.map((error) => `- ${error}`));
    if (verification.warnings?.length) lines.push('Verification warnings:', ...verification.warnings.map((warning) => `- ${warning}`));
  }

  const html = `
    <pre>${escapeHtml(lines.join('\n'))}</pre>
    ${formatActionPlanRows(response.payload?.action_plan || response.action_plan || response.upload?.request?.action_plan)}
    ${download ? formatMissionItemRows(download.items || []) : ''}
  `;
  runtimeState.missionResultVehicleId = vehicle?.vehicle_id || null;
  runtimeState.missionResultHtml = html;
  validationBox.innerHTML = html;
}

function getDownloadedMissionItems(response) {
  const download = response?.download || response;
  if (Array.isArray(download?.items)) return download.items;
  if (Array.isArray(download?.result?.items)) return download.result.items;
  if (Array.isArray(download?.result?.mission?.items)) return download.result.mission.items;
  return [];
}

function getWaypointKindFromReadbackItem(item, vehicle, index) {
  const command = Number(item.command);
  if (command === COMMAND.MAV_CMD_NAV_TAKEOFF) return 'takeoff';
  if (command === COMMAND.MAV_CMD_NAV_LAND) return 'land';
  return 'waypoint';
}

function convertReadbackItemsToWaypoints(items, vehicle) {
  return items.map((item, index) => {
    const waypoint = {
      seq: index + 1,
      kind: getWaypointKindFromReadbackItem(item, vehicle, index),
      lat: round(Number(item.x), 7),
      lon: round(Number(item.y), 7),
      alt: Number(item.z),
      alt_reference: getAltitudeReference(vehicle),
      action: 'NONE',
      readback_frame: Number(item.frame),
    };
    waypoint.command = getWaypointCommand(vehicle, index, waypoint);
    return waypoint;
  });
}

function validateReadbackItemsForMap(items) {
  const errors = [];
  if (!Array.isArray(items) || items.length === 0) {
    errors.push('read-back mission item이 없습니다.');
    return errors;
  }

  for (const [index, item] of items.entries()) {
    const frame = Number(item.frame);
    const command = Number(item.command);
    if (![COMMAND.MAV_FRAME_GLOBAL_RELATIVE_ALT, 6].includes(frame)) {
      errors.push(`Item ${index}: 지원하지 않는 frame ${item.frame}`);
    }
    if (![COMMAND.MAV_CMD_NAV_WAYPOINT, COMMAND.MAV_CMD_NAV_TAKEOFF, COMMAND.MAV_CMD_NAV_LAND].includes(command)) {
      errors.push(`Item ${index}: 지원하지 않는 command ${item.command}`);
    }
    if (!Number.isFinite(Number(item.x)) || !Number.isFinite(Number(item.y)) || !Number.isFinite(Number(item.z))) {
      errors.push(`Item ${index}: x/y/z 좌표가 유효하지 않습니다.`);
    }
  }

  return errors;
}

async function postMissionPayload(path, payload) {
  const response = await fetch(`${runtimeState.backendUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload }),
  });
  const responsePayload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = responsePayload.detail;
    const message = typeof detail === 'string'
      ? detail
      : detail?.reason || detail?.errors?.join(', ') || response.statusText;
    throw new Error(message);
  }
  return responsePayload;
}

function requireBackendOnlineForMissionAction() {
  if (runtimeState.status === 'BACKEND ONLINE') return true;
  alert('Backend가 ONLINE일 때만 mission upload/read-back을 실행할 수 있습니다.');
  return false;
}

async function validateSelectedMission() {
  const mission = getSelectedMission();
  const vehicle = getSelectedVehicle();
  const validation = sanityCheckMission(mission, vehicle);
  showMissionValidation(validation, buildMissionSummaryLines(mission, vehicle));

  if (!mission || !vehicle || validation.errors.length > 0) {
    alert('Mission validation failed:\n- ' + validation.errors.join('\n- '));
    return;
  }

  const payload = buildMissionUploadPayload(mission, vehicle);
  if (runtimeState.status !== 'BACKEND ONLINE') {
    alert('Local validation complete. Backend is offline, so backend dry-run was skipped.');
    return;
  }

  try {
    const backendValidation = await postMissionPayload('/api/missions/upload-dry-run', payload);
    const combined = {
      errors: [...validation.errors, ...(backendValidation.errors || [])],
      warnings: [...validation.warnings, ...(backendValidation.warnings || [])],
    };
    showMissionValidation(combined, [
      ...buildMissionSummaryLines(mission, vehicle),
      `Backend dry-run validation: ${backendValidation.ok ? 'OK' : 'FAILED'}`,
      `Mission upload ready: ${backendValidation.upload_ready ? 'YES' : 'NO'}`,
      `Action plan ready: ${backendValidation.action_plan_ready ? 'YES' : 'NO'}`,
      backendValidation.message || 'Dry-run complete.',
    ]);
  } catch (err) {
    alert('Backend mission dry-run failed: ' + err.message);
  }
}

async function uploadActionPlan() {
  const mission = getSelectedMission();
  const vehicle = getSelectedVehicle();
  const seq = Date.now();
  if (!mission || !vehicle) {
    runtimeState.actionPlanUploadState = 'FAILED';
    runtimeState.actionPlanUploadResult = { ok: false, accepted: false, reason: 'vehicle_not_selected', seq };
    renderCompanionTestPrep();
    return;
  }
  if (isChildVehicle(vehicle)) {
    runtimeState.actionPlanUploadState = 'FAILED';
    runtimeState.actionPlanUploadResult = { ok: false, accepted: false, reason: 'selected_vehicle_not_carrier', seq };
    renderCompanionTestPrep();
    return;
  }

  if (!saveConnectionForm({ persist: false })) return;
  saveBackendUrl();
  if (runtimeState.status !== 'BACKEND ONLINE') {
    runtimeState.actionPlanUploadState = 'FAILED';
    runtimeState.actionPlanUploadResult = { ok: false, accepted: false, reason: 'backend_not_online', seq };
    renderCompanionTestPrep();
    return;
  }

  const saved = await saveVehicleConfigs({ silent: true });
  if (!saved) {
    runtimeState.actionPlanUploadState = 'FAILED';
    runtimeState.actionPlanUploadResult = { ok: false, accepted: false, reason: 'vehicle_config_save_failed', seq };
    renderCompanionTestPrep();
    return;
  }

  const validation = validateCarrierActionPlan(mission, vehicle);
  if (validation.errors.length > 0) {
    runtimeState.actionPlanUploadState = 'FAILED';
    runtimeState.actionPlanUploadResult = {
      ok: false,
      accepted: false,
      reason: 'action_plan_validation_failed',
      errors: validation.errors,
      seq,
    };
    showMissionValidation(validation, buildMissionSummaryLines(mission, vehicle));
    renderCompanionTestPrep();
    return;
  }

  const actionPlan = buildCarrierActionPlanPayload(mission, vehicle);
  const actions = actionPlan?.actions || [];
  if (actions.length === 0) {
    runtimeState.actionPlanUploadState = 'IDLE';
    runtimeState.actionPlanUploadResult = {
      ok: true,
      accepted: false,
      reason: 'no_waypoint_actions_configured',
      seq,
    };
    renderCompanionTestPrep();
    return;
  }

  runtimeState.actionPlanUploadState = 'SENDING';
  runtimeState.actionPlanUploadResult = { ok: false, accepted: false, reason: 'sending', seq };
  renderCompanionTestPrep();

  try {
    const responseBody = await postDroneCommand('/api/drone/action-plan-upload', {
      vehicle_id: vehicle.vehicle_id,
      mission_id: mission.mission_id,
      actions,
      seq,
    });
    runtimeState.actionPlanUploadResult = responseBody;
    runtimeState.actionPlanUploadState = getActionPlanUploadStateFromResult(responseBody);
    if (runtimeState.actionPlanUploadState === 'OK') {
      showMissionOperationResult('Action Plan upload', responseBody, mission, vehicle);
      await refreshDroneConnections({ silent: true });
    }
  } catch (error) {
    runtimeState.actionPlanUploadState = 'FAILED';
    runtimeState.actionPlanUploadResult = {
      ok: false,
      accepted: false,
      reason: 'request_failed',
      message: error.message,
      seq,
    };
  } finally {
    renderCompanionTestPrep();
    renderRuntimeConnection();
  }
}

async function uploadSelectedMission() {
  const mission = getSelectedMission();
  const vehicle = getSelectedVehicle();
  const validation = sanityCheckMission(mission, vehicle);
  showMissionValidation(validation, buildMissionSummaryLines(mission, vehicle));

  if (!mission || !vehicle || validation.errors.length > 0) {
    alert('Mission Upload 불가:\n- ' + validation.errors.join('\n- '));
    return;
  }
  if (!requireBackendOnlineForMissionAction()) return;

  const payload = buildMissionUploadPayload(mission, vehicle);
  try {
    const response = await postMissionPayload('/api/missions/upload', payload);
    mission.uploadState = response.ok ? 'Uploaded' : 'Upload Failed';
    renderMissionSummary();
    showMissionOperationResult('Mission upload', response, mission, vehicle);
  } catch (err) {
    alert('Mission upload failed: ' + err.message);
  }
}

async function readBackSelectedMission() {
  const mission = getSelectedMission();
  const vehicle = getSelectedVehicle();
  if (!vehicle) {
    alert('FC 미션 불러오기 불가: vehicle을 먼저 선택하세요.');
    return;
  }
  if (!requireBackendOnlineForMissionAction()) return;

  const payload = mission
    ? buildMissionUploadPayload(mission, vehicle)
    : { vehicle_id: vehicle.vehicle_id };
  try {
    const response = await postMissionPayload('/api/missions/download', payload);
    showMissionOperationResult('Mission read-back', response, mission, vehicle);
  } catch (err) {
    alert('Mission read-back failed: ' + err.message);
  }
}

async function loadFcMissionToMap() {
  const mission = getSelectedMission();
  const vehicle = getSelectedVehicle();
  if (!vehicle || !mission) {
    alert('FC 미션 불러오기 불가: vehicle을 먼저 선택하세요.');
    return;
  }
  if (!requireBackendOnlineForMissionAction()) return;

  const ok = confirm(
    'FC read-back mission으로 현재 UI waypoint를 덮어쓸까요?\n\n' +
    '주의: FC mission에는 RELEASE/action metadata가 없으므로 RELEASE item은 일반 WAYPOINT로 복원됩니다.'
  );
  if (!ok) return;

  const payload = buildMissionUploadPayload(mission, vehicle);
  try {
    const response = await postMissionPayload('/api/missions/download', payload);
    const items = getDownloadedMissionItems(response);
    const errors = validateReadbackItemsForMap(items);
    if (errors.length > 0) {
      showMissionOperationResult('Load FC mission failed', response, mission, vehicle);
      alert('FC mission을 지도에 반영할 수 없습니다:\n- ' + errors.join('\n- '));
      return;
    }

    mission.waypoints = convertReadbackItemsToWaypoints(items, vehicle);
    applyWaypointMetadata(mission, vehicle);
    mission.uploadState = 'FC Mission Loaded';
    clearMissionResultLog();
    renderAll();
    showMissionOperationResult('Loaded FC mission to map', response, mission, vehicle);
  } catch (err) {
    alert('Load FC mission failed: ' + err.message);
  }
}

async function uploadAndVerifySelectedMission() {
  const mission = getSelectedMission();
  const vehicle = getSelectedVehicle();
  const validation = sanityCheckMission(mission, vehicle);
  showMissionValidation(validation, buildMissionSummaryLines(mission, vehicle));

  if (!mission || !vehicle || validation.errors.length > 0) {
    alert('미션 업로드 불가:\n- ' + validation.errors.join('\n- '));
    return;
  }
  if (!requireBackendOnlineForMissionAction()) return;

  const payload = buildMissionUploadPayload(mission, vehicle);
  try {
    const response = await postMissionPayload('/api/missions/upload-and-verify', payload);
    mission.uploadState = response.verification?.verified ? 'Verified' : 'Verify Failed';
    renderMissionSummary();
    showMissionOperationResult('Upload + verify', response, mission, vehicle);
  } catch (err) {
    alert('Upload + verify failed: ' + err.message);
  }
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

function buildQgcPlan(m, vehicle = getSelectedVehicle()) {
  const settings = state.qgcPlanSettings;
  applyWaypointMetadata(m, vehicle);
  const items = m.waypoints.map((wp, idx) => {
    const command = getMavCommandForWaypoint(vehicle, idx, wp);
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

  const { errors, warnings } = sanityCheckMission(mission, vehicle);

  if (errors.length) {
    alert('QGC .plan export 불가:\n- ' + errors.join('\n- '));
    return;
  }

  showMissionValidation({ errors, warnings }, buildMissionSummaryLines(mission, vehicle));

  const plan = buildQgcPlan(mission, vehicle);
  downloadJson(`${vehicle.name}.plan`, plan);
}

function exportPackageJson() {
  const {
    version,
    vehicles,
    missions,
    qgcPlanSettings,
  } = state;

  downloadJson('fleet_mission_package.json', {
    version,
    vehicles,
    missions,
    qgcPlanSettings,
  });
}

function normalizeImportedMissionPackage(imported) {
  const warnings = [];

  if (!imported || typeof imported !== 'object') return warnings;
  if (Array.isArray(imported.relationships) && imported.relationships.length > 0) {
    warnings.push('relationships는 더 이상 사용하지 않아 import 시 제거했습니다. RELEASE target child 설정을 사용하세요.');
  }
  delete imported.relationships;

  for (const vehicle of Array.isArray(imported.vehicles) ? imported.vehicles : []) {
    if (!vehicle.firmware_profile) {
      vehicle.firmware_profile = 'standard_px4';
      warnings.push(`${vehicle.name || vehicle.vehicle_id}: firmware_profile을 standard_px4로 보정했습니다.`);
    }
  }

  return warnings;
}

function isValidMissionPackage(imported) {
  if (
    !imported ||
    !Array.isArray(imported.vehicles) ||
    !Array.isArray(imported.missions) ||
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

      state = imported;
      state.vehicles = state.vehicles.map(stripRuntimeFieldsFromVehicle);
      state.selectedVehicleId = state.vehicles[0]?.vehicle_id || null;
      clearCompanionCommandResults();
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

function setupRightSidebarResizer() {
  const handle = document.getElementById('rightSidebarResizeHandle');
  const mainEl = document.querySelector('.main');
  if (!handle || !mainEl) return;

  const storageKey = 'fleetMissionEditor.rightSidebarWidth';
  const minWidth = 360;

  const applyWidth = (width) => {
    const maxWidth = Math.max(520, Math.floor(window.innerWidth * 0.65));
    const clamped = Math.min(maxWidth, Math.max(minWidth, Number(width) || 480));
    document.documentElement.style.setProperty('--right-sidebar-width', `${clamped}px`);
    window.localStorage.setItem(storageKey, String(clamped));
    window.requestAnimationFrame(() => map.invalidateSize());
  };

  applyWidth(window.localStorage.getItem(storageKey) || 480);

  handle.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add('is-resizing-sidebar');

    const onPointerMove = (moveEvent) => {
      const width = window.innerWidth - moveEvent.clientX;
      applyWidth(width);
    };

    const onPointerUp = () => {
      document.body.classList.remove('is-resizing-sidebar');
      handle.removeEventListener('pointermove', onPointerMove);
      handle.removeEventListener('pointerup', onPointerUp);
      handle.removeEventListener('pointercancel', onPointerUp);
      window.requestAnimationFrame(() => map.invalidateSize());
    };

    handle.addEventListener('pointermove', onPointerMove);
    handle.addEventListener('pointerup', onPointerUp);
    handle.addEventListener('pointercancel', onPointerUp);
  });

  window.addEventListener('resize', () => {
    applyWidth(window.localStorage.getItem(storageKey) || 480);
  });
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

function formatReleaseInputState(value) {
  if (value === null || value === undefined || value === '') return 'UNKNOWN';
  if (value === 'RELEASE_CONFIRMED') return 'Release command sent';
  return value;
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
  setupRightSidebarResizer();
  syncSettingsToForm();
  renderAll();
  startBackendHealthMonitor();
  await loadVehicleConfigs();
}

initializeApp();
