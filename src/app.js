const DRONES = [
  { id: 'mother', name: 'Mother', role: 'mother', sysid: 1, ip: '192.168.0.101', port: 14550, color: '#2563eb' },
  { id: 'child1', name: 'Child 1', role: 'child', sysid: 11, ip: '192.168.0.111', port: 14551, color: '#dc2626' },
  { id: 'child2', name: 'Child 2', role: 'child', sysid: 12, ip: '192.168.0.112', port: 14552, color: '#16a34a' },
  { id: 'child3', name: 'Child 3', role: 'child', sysid: 13, ip: '192.168.0.113', port: 14553, color: '#ca8a04' },
  { id: 'child4', name: 'Child 4', role: 'child', sysid: 14, ip: '192.168.0.114', port: 14554, color: '#9333ea' },
];

const COMMAND = {
  MAV_CMD_NAV_WAYPOINT: 16,
  MAV_CMD_NAV_TAKEOFF: 22,
  MAV_FRAME_GLOBAL_RELATIVE_ALT: 3,
};

let state = createInitialState();
let selectedDroneId = 'mother';
let markers = {};
let polylines = {};

function createInitialState() {
  const missions = {};
  for (const d of DRONES) {
    missions[d.id] = {
      vehicleId: d.id,
      name: d.name,
      role: d.role,
      connection: { ip: d.ip, port: d.port, sysid: d.sysid },
      uploadState: 'Editing',
      waypoints: [],
    };
  }
  return {
    schemaVersion: 1,
    createdBy: 'Fleet Mission Editor Skeleton',
    qgcPlanSettings: {
      firmwareType: 12,
      vehicleType: 2,
      hoverSpeed: 5,
      cruiseSpeed: 15,
      useFirstAsTakeoff: true,
      globalPlanAltitudeMode: 1,
    },
    missions,
  };
}

const map = L.map('map').setView([36.3504, 127.3845], 14);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 20,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

map.on('click', (e) => addWaypoint(e.latlng.lat, e.latlng.lng));

document.getElementById('exportPackageBtn').addEventListener('click', exportPackageJson);
document.getElementById('importPackageInput').addEventListener('change', importPackageJson);
document.getElementById('resetBtn').addEventListener('click', () => {
  if (confirm('모든 mission 데이터를 초기화할까요?')) {
    state = createInitialState();
    selectedDroneId = 'mother';
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
  return state.missions[selectedDroneId];
}

function getDroneMeta(id) {
  return DRONES.find(d => d.id === id);
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
  for (const d of DRONES) {
    const m = state.missions[d.id];
    const card = document.createElement('div');
    card.className = 'drone-card' + (d.id === selectedDroneId ? ' active' : '');
    card.onclick = () => {
      selectedDroneId = d.id;
      renderAll();
    };
    card.innerHTML = `
      <div class="drone-head">
        <div class="drone-name">${d.name}</div>
        <div class="badge ${m.waypoints.length ? 'ok' : 'warn'}">${m.uploadState}</div>
      </div>
      <div class="kv"><span>SYSID</span><span>${m.connection.sysid}</span></div>
      <div class="kv"><span>UDP</span><span>${m.connection.ip}:${m.connection.port}</span></div>
      <div class="kv"><span>WP</span><span>${m.waypoints.length}</span></div>
    `;
    list.appendChild(card);
  }
}

function renderConnectionForm() {
  const m = selectedMission();
  document.getElementById('connIp').value = m.connection.ip;
  document.getElementById('connPort').value = m.connection.port;
  document.getElementById('connSysid').value = m.connection.sysid;
  document.getElementById('connRole').value = m.role;
}

function saveConnectionForm() {
  const m = selectedMission();
  m.connection.ip = document.getElementById('connIp').value.trim();
  m.connection.port = Number(document.getElementById('connPort').value);
  m.connection.sysid = Number(document.getElementById('connSysid').value);
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
  const m = selectedMission();
  if (m.waypoints.length === 0) return;
  if (confirm(`${m.name} waypoint를 모두 삭제할까요?`)) {
    m.waypoints = [];
    m.uploadState = 'Editing';
    renderAll();
  }
}

function resequence(m) {
  m.waypoints.forEach((wp, idx) => wp.seq = idx + 1);
  m.uploadState = 'Editing';
}

function renderWaypointRows() {
  const tbody = document.getElementById('waypointRows');
  const m = selectedMission();
  tbody.innerHTML = '';
  m.waypoints.forEach((wp, idx) => {
    const tr = document.createElement('tr');
    const actionOptions = actionSelectHtml(wp.action, m.role);
    tr.innerHTML = `
      <td>${wp.seq}</td>
      <td class="latlon">${wp.lat.toFixed(7)}<br>${wp.lon.toFixed(7)}</td>
      <td><input class="small" type="number" step="1" value="${wp.alt}" data-idx="${idx}" data-field="alt" /></td>
      <td>${actionOptions}</td>
      <td><button data-delete="${idx}">삭제</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('input[data-field="alt"]').forEach(input => {
    input.addEventListener('change', (e) => {
      const idx = Number(e.target.dataset.idx);
      const alt = Number(e.target.value);
      if (Number.isFinite(alt)) {
        m.waypoints[idx].alt = alt;
        m.uploadState = 'Editing';
        renderAll();
      }
    });
  });
  tbody.querySelectorAll('select[data-field="action"]').forEach(sel => {
    sel.addEventListener('change', (e) => {
      const idx = Number(e.target.dataset.idx);
      m.waypoints[idx].action = e.target.value;
      m.uploadState = 'Editing';
      renderAll();
    });
  });
  tbody.querySelectorAll('button[data-delete]').forEach(btn => {
    btn.addEventListener('click', (e) => deleteWaypoint(Number(e.target.dataset.delete)));
  });
}

function actionSelectHtml(value, role) {
  const disabled = role !== 'mother' ? 'disabled' : '';
  const opts = [
    ['NONE', 'NONE'],
    ['RELEASE_CHILD_1', 'Release C1'],
    ['RELEASE_CHILD_2', 'Release C2'],
    ['RELEASE_CHILD_3', 'Release C3'],
    ['RELEASE_CHILD_4', 'Release C4'],
  ];
  return `<select data-field="action" data-idx="${arguments.callee.caller ? '' : ''}" ${disabled}>`;
}

// Rebuild action selects after row creation because inline caller index is intentionally avoided.
const oldRenderWaypointRows = renderWaypointRows;
renderWaypointRows = function() {
  const tbody = document.getElementById('waypointRows');
  const m = selectedMission();
  tbody.innerHTML = '';
  m.waypoints.forEach((wp, idx) => {
    const tr = document.createElement('tr');
    const select = document.createElement('select');
    select.dataset.field = 'action';
    select.dataset.idx = idx;
    select.disabled = m.role !== 'mother';
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
        m.waypoints[idx].alt = alt;
        m.uploadState = 'Editing';
        renderAll();
      }
    });
  });
  tbody.querySelectorAll('select[data-field="action"]').forEach(sel => {
    sel.addEventListener('change', (e) => {
      const idx = Number(e.target.dataset.idx);
      m.waypoints[idx].action = e.target.value;
      m.uploadState = 'Editing';
      renderAll();
    });
  });
  tbody.querySelectorAll('button[data-delete]').forEach(btn => {
    btn.addEventListener('click', (e) => deleteWaypoint(Number(e.target.dataset.delete)));
  });
};

function renderMapItems() {
  for (const layer of Object.values(markers).flat()) map.removeLayer(layer);
  for (const layer of Object.values(polylines)) map.removeLayer(layer);
  markers = {};
  polylines = {};

  for (const d of DRONES) {
    const m = state.missions[d.id];
    markers[d.id] = [];
    const latlngs = [];
    m.waypoints.forEach(wp => {
      const ll = [wp.lat, wp.lon];
      latlngs.push(ll);
      const marker = L.circleMarker(ll, {
        radius: d.id === selectedDroneId ? 8 : 6,
        color: d.color,
        fillColor: d.color,
        fillOpacity: d.id === selectedDroneId ? 0.95 : 0.55,
        weight: d.id === selectedDroneId ? 3 : 2,
      }).addTo(map);
      const action = wp.action && wp.action !== 'NONE' ? `<br><b>${wp.action}</b>` : '';
      marker.bindPopup(`${d.name} WP${wp.seq}<br>Alt ${wp.alt} m${action}`);
      markers[d.id].push(marker);
    });
    if (latlngs.length >= 2) {
      polylines[d.id] = L.polyline(latlngs, {
        color: d.color,
        weight: d.id === selectedDroneId ? 4 : 2,
        opacity: d.id === selectedDroneId ? 0.95 : 0.45,
      }).addTo(map);
    }
  }
}

function renderMissionSummary() {
  const m = selectedMission();
  document.getElementById('wpCount').value = m.waypoints.length;
  document.getElementById('missionState').value = m.uploadState;
}

function sanityCheckMission(m) {
  const errors = [];
  const warnings = [];
  if (m.waypoints.length === 0) errors.push('waypoint가 없습니다. QGC .plan export 불가.');
  for (const wp of m.waypoints) {
    if (!Number.isFinite(wp.lat) || wp.lat < -90 || wp.lat > 90) errors.push(`WP${wp.seq}: latitude 범위 오류`);
    if (!Number.isFinite(wp.lon) || wp.lon < -180 || wp.lon > 180) errors.push(`WP${wp.seq}: longitude 범위 오류`);
    if (!Number.isFinite(Number(wp.alt))) errors.push(`WP${wp.seq}: altitude 숫자 아님`);
    if (Number(wp.alt) <= 0) warnings.push(`WP${wp.seq}: altitude가 0 이하입니다.`);
  }
  if (m.role === 'mother') {
    const releases = m.waypoints.filter(wp => wp.action && wp.action.startsWith('RELEASE'));
    if (releases.length === 0) warnings.push('모드론 mission에 사출 action이 없습니다.');
  }
  return { errors, warnings };
}

function renderSanityCheck() {
  const m = selectedMission();
  const { errors, warnings } = sanityCheckMission(m);
  const lines = [];
  lines.push(`Selected: ${m.name}`);
  lines.push(`SYSID: ${m.connection.sysid}`);
  lines.push(`Waypoints: ${m.waypoints.length}`);
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
  const m = selectedMission();
  const { errors } = sanityCheckMission(m);
  if (errors.length) {
    alert('QGC .plan export 불가:\n- ' + errors.join('\n- '));
    return;
  }
  const plan = buildQgcPlan(m);
  downloadJson(`${m.vehicleId}.plan`, plan);
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
      selectedDroneId = 'mother';
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
