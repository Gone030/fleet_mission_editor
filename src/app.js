const INITIAL_MISSION_PACKAGE = {
  version: 1,
  vehicles: [
    {
      vehicle_id: 'carrier_01',
      name: 'Carrier-01',
      role: 'carrier',
      sysid: 1,
      ip: '192.168.0.101',
      udp_port: 14550,
      firmware_profile: 'standard_px4',
      parent_vehicle_id: null,
      sort_order: 1,
      color: '#2563eb',
      collapsed: true,
    },
    {
      vehicle_id: 'child_01',
      name: 'Child-01',
      role: 'child',
      sysid: 11,
      ip: '192.168.0.111',
      udp_port: 14551,
      firmware_profile: 'px4_nav_ready_gate',
      parent_vehicle_id: 'carrier_01',
      sort_order: 1,
      color: '#dc2626',
      collapsed: false,
    },
    {
      vehicle_id: 'child_02',
      name: 'Child-02',
      role: 'child',
      sysid: 12,
      ip: '192.168.0.112',
      udp_port: 14552,
      firmware_profile: 'px4_nav_ready_gate',
      parent_vehicle_id: 'carrier_01',
      sort_order: 2,
      color: '#16a34a',
      collapsed: false,
    },
    {
      vehicle_id: 'child_03',
      name: 'Child-03',
      role: 'child',
      sysid: 13,
      ip: '192.168.0.113',
      udp_port: 14553,
      firmware_profile: 'px4_nav_ready_gate',
      parent_vehicle_id: 'carrier_01',
      sort_order: 3,
      color: '#ca8a04',
      collapsed: false,
    },
    {
      vehicle_id: 'child_04',
      name: 'Child-04',
      role: 'child',
      sysid: 14,
      ip: '192.168.0.114',
      udp_port: 14554,
      firmware_profile: 'px4_nav_ready_gate',
      parent_vehicle_id: 'carrier_01',
      sort_order: 4,
      color: '#9333ea',
      collapsed: false,
    },
  ],
  missions: [
    { mission_id: 'mission_carrier_01', vehicle_id: 'carrier_01', waypoints: [] },
    { mission_id: 'mission_child_01', vehicle_id: 'child_01', waypoints: [] },
    { mission_id: 'mission_child_02', vehicle_id: 'child_02', waypoints: [] },
    { mission_id: 'mission_child_03', vehicle_id: 'child_03', waypoints: [] },
    { mission_id: 'mission_child_04', vehicle_id: 'child_04', waypoints: [] },
  ],
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
state.selectedVehicleId = 'carrier_01';

function getVehicles() {
  return state.vehicles;
}

function getSelectedVehicle() {
  return state.vehicles.find((vehicle) => vehicle.vehicle_id === state.selectedVehicleId);
}

function getMissionByVehicleId(vehicleId) {
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
    state.selectedVehicleId = 'carrier_01';
    hideVehicleForm();
    syncSettingsToForm();
    renderAll();
  }
});
document.getElementById('saveConnBtn').addEventListener('click', saveConnectionForm);
document.getElementById('exportQgcBtn').addEventListener('click', exportSelectedQgcPlan);
document.getElementById('clearMissionBtn').addEventListener('click', clearSelectedMission);
document.getElementById('relationshipForm').addEventListener('submit', addRelationshipFromForm);

for (const id of ['firmwareType', 'vehicleType', 'hoverSpeed', 'cruiseSpeed', 'useFirstAsTakeoff']) {
  document.getElementById(id).addEventListener('change', saveQgcSettingsFromForm);
}

function renderAll() {
  renderDroneList();
  renderConnectionForm();
  renderWaypointRows();
  renderMapItems();
  renderMissionSummary();
  renderRelationshipEditor();
  renderRelationshipList();
  renderSanityCheck();
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
  document.getElementById('vehicleRole').value = 'custom';
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
  const role = document.getElementById('vehicleRole').value.trim();
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
  hideVehicleForm();
  renderAll();
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
  hideVehicleForm();
  renderAll();
}

function renderDroneList() {
  const list = document.getElementById('droneList');
  list.innerHTML = '';

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
    <div class="kv"><span>Role</span><span>${escapeHtml(vehicle.role)}</span></div>
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
  if (!vehicle) return;

  document.getElementById('connIp').value = vehicle.ip;
  document.getElementById('connPort').value = vehicle.udp_port;
  document.getElementById('connSysid').value = vehicle.sysid;
  document.getElementById('connRole').value = vehicle.role;
  document.getElementById('connFirmwareProfile').value = vehicle.firmware_profile;
}

function saveConnectionForm() {
  const vehicle = getSelectedVehicle();
  if (!vehicle) return;

  vehicle.ip = document.getElementById('connIp').value.trim();
  vehicle.udp_port = Number(document.getElementById('connPort').value);
  vehicle.sysid = Number(document.getElementById('connSysid').value);
  vehicle.role = document.getElementById('connRole').value.trim();
  vehicle.firmware_profile = document.getElementById('connFirmwareProfile').value;

  renderAll();
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

  mission.waypoints.forEach((wp, idx) => {
    const tr = document.createElement('tr');

    const select = document.createElement('select');
    select.dataset.field = 'action';
    select.dataset.idx = idx;
    select.disabled = vehicle.role !== 'carrier';

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

function renderMissionSummary() {
  const m = getSelectedMission();
  document.getElementById('wpCount').value = m.waypoints.length;
  document.getElementById('missionState').value = m.uploadState;
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
    targetVehicle.role === 'child' ||
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
  for (const waypoint of mission.waypoints) {
    const option = document.createElement('option');
    option.value = waypoint.seq;
    option.textContent = `WP${waypoint.seq}`;
    waypointSelect.appendChild(option);
  }

  targetSelect.innerHTML = '';
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
  const triggerWaypointId = Number(
    document.getElementById('relationshipTriggerWaypoint').value
  );
  const targetVehicleId = document.getElementById('relationshipTargetVehicle').value;
  const actionType = document.getElementById('relationshipActionType').value;
  const mission = getSelectedMission();

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

  if (mission.waypoints.length === 0) errors.push('waypoint가 없습니다. QGC .plan export 불가.');

  for (const wp of mission.waypoints) {
    if (!Number.isFinite(wp.lat) || wp.lat < -90 || wp.lat > 90) errors.push(`WP${wp.seq}: latitude 범위 오류`);
    if (!Number.isFinite(wp.lon) || wp.lon < -180 || wp.lon > 180) errors.push(`WP${wp.seq}: longitude 범위 오류`);
    if (!Number.isFinite(Number(wp.alt))) errors.push(`WP${wp.seq}: altitude 숫자 아님`);
    if (Number(wp.alt) <= 0) warnings.push(`WP${wp.seq}: altitude가 0 이하입니다.`);
  }

  if (vehicle && vehicle.role === 'carrier') {
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

  lines.push(`Selected: ${vehicle.name}`);
  lines.push(`SYSID: ${vehicle.sysid}`);
  lines.push(`UDP: ${vehicle.ip}:${vehicle.udp_port}`);
  lines.push(`Waypoints: ${mission.waypoints.length}`);
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
    imported.vehicles.length === 0 ||
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
      state.selectedVehicleId = state.vehicles[0]?.vehicle_id || 'carrier_01';
      syncSettingsToForm();
      renderAll();
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

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

syncSettingsToForm();
renderAll();
