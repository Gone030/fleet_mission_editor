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
document.getElementById('resetBtn').addEventListener('click', () => {
  if (confirm('모든 mission 데이터를 초기화할까요?')) {
    state = JSON.parse(JSON.stringify(INITIAL_MISSION_PACKAGE));
    state.selectedVehicleId = 'carrier_01';
    syncSettingsToForm();
    renderAll();
  }
});
document.getElementById('saveConnBtn').addEventListener('click', saveConnectionForm);
document.getElementById('exportQgcBtn').addEventListener('click', exportSelectedQgcPlan);
document.getElementById('clearMissionBtn').addEventListener('click', clearSelectedMission);

for (const id of ['firmwareType', 'vehicleType', 'hoverSpeed', 'cruiseSpeed', 'useFirstAsTakeoff']) {
  document.getElementById(id).addEventListener('change', saveQgcSettingsFromForm);
}

document.getElementById('defaultAlt').addEventListener('change', () => {});

function selectedMission() {
  return getSelectedMission();
}


function renderAll() {
  renderDroneList();
  renderConnectionForm();
  renderWaypointRows();
  renderMapItems();
  renderMissionSummary();
  renderSanityCheck();
}

function renderDroneList() {
  const list = document.getElementById('droneList');
  list.innerHTML = '';

  for (const vehicle of getTopLevelVehicles()) {
    renderVehicleCard(list, vehicle, 0);

    if (!vehicle.collapsed) {
      const children = getChildVehicles(vehicle.vehicle_id);

      for (const child of children) {
        renderVehicleCard(list, child, 1);
      }
    }
  }
}

function renderVehicleCard(list, vehicle, depth) {
  const mission = getMissionByVehicleId(vehicle.vehicle_id);
  const uploadState = mission.uploadState || 'Editing';
  const children = getChildVehicles(vehicle.vehicle_id);
  const hasChildren = children.length > 0;
  const isSelected = vehicle.vehicle_id === state.selectedVehicleId;

  const card = document.createElement('div');
  card.className = 'drone-card' + (isSelected ? ' active' : '') + (depth > 0 ? ' child-card' : '');

  card.onclick = () => {
    state.selectedVehicleId = vehicle.vehicle_id;
    renderAll();
  };

  const toggleButton = hasChildren
    ? `<button class="tree-toggle" data-toggle="${vehicle.vehicle_id}">${vehicle.collapsed ? '▶' : '▼'}</button>`
    : `<span class="tree-spacer"></span>`;

  const childSummary = hasChildren
    ? `<div class="kv"><span>Children</span><span>${children.length}</span></div>`
    : '';

  card.innerHTML = `
    <div class="drone-head">
      <div class="drone-name">
        ${toggleButton}
        <span>${vehicle.name}</span>
      </div>
      <div class="badge ${mission.waypoints.length ? 'ok' : 'warn'}">${uploadState}</div>
    </div>
    <div class="kv"><span>Role</span><span>${vehicle.role}</span></div>
    <div class="kv"><span>SYSID</span><span>${vehicle.sysid}</span></div>
    <div class="kv"><span>UDP</span><span>${vehicle.ip}:${vehicle.udp_port}</span></div>
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
}

function renderConnectionForm() {
  const vehicle = getSelectedVehicle();
  if (!vehicle) return;

  document.getElementById('connIp').value = vehicle.ip;
  document.getElementById('connPort').value = vehicle.udp_port;
  document.getElementById('connSysid').value = vehicle.sysid;
  document.getElementById('connRole').value = vehicle.role;
}

function saveConnectionForm() {
  const vehicle = getSelectedVehicle();
  if (!vehicle) return;

  vehicle.ip = document.getElementById('connIp').value.trim();
  vehicle.udp_port = Number(document.getElementById('connPort').value);
  vehicle.sysid = Number(document.getElementById('connSysid').value);
  vehicle.role = document.getElementById('connRole').value.trim();

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
  const m = selectedMission();
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
  const m = selectedMission();
  m.waypoints.splice(index, 1);
  resequence(m);
  renderAll();
}

function clearSelectedMission() {
  const vehicle = getSelectedVehicle();
  const mission = selectedMission();

  if (mission.waypoints.length === 0) return;

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
  const mission = selectedMission();
  const vehicle = getSelectedVehicle();

  tbody.innerHTML = '';

  mission.waypoints.forEach((wp, idx) => {
    const tr = document.createElement('tr');

    const select = document.createElement('select');
    select.dataset.field = 'action';
    select.dataset.idx = idx;
    select.disabled = vehicle.role !== 'carrier';

    for (const [value, label] of [
      ['NONE', 'NONE'],
      ['RELEASE_CHILD_1', 'Release C1'],
      ['RELEASE_CHILD_2', 'Release C2'],
      ['RELEASE_CHILD_3', 'Release C3'],
      ['RELEASE_CHILD_4', 'Release C4'],
    ]) {
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

      const action = wp.action && wp.action !== 'NONE' ? `<br><b>${wp.action}</b>` : '';
      marker.bindPopup(`${vehicle.name} WP${wp.seq}<br>Alt ${wp.alt} m${action}`);
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
  const m = selectedMission();
  document.getElementById('wpCount').value = m.waypoints.length;
  document.getElementById('missionState').value = m.uploadState;
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
  const mission = selectedMission();
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
  const mission = selectedMission();
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
  downloadJson('fleet_mission_package.json', state);
}

function importPackageJson(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!imported.missions || !imported.qgcPlanSettings) throw new Error('mission package 형식이 아닙니다.');
      state = imported;
      state.selectedVehicleId = state.vehicles[0]?.vehicle_id || 'carrier_01';
      syncSettingsToForm();
      renderAll();
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

syncSettingsToForm();
renderAll();
