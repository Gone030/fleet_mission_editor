import json
import socket
import time
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = PROJECT_ROOT / "src"
INDEX_HTML = PROJECT_ROOT / "index.html"
DATA_DIR = PROJECT_ROOT / "backend" / "data"
VEHICLES_PATH = DATA_DIR / "vehicles.json"

app = FastAPI(title="Fleet Runtime Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["*"],
)

last_drone_status = {
    "ok": True,
    "results": {},
    "timestamp_ms": None,
}
known_drone_configs = {}
ALLOWED_EMERGENCY_ACTIONS = {"LAND", "DISARM", "FORCE_DISARM"}
ALLOWED_VEHICLE_ROLES = {"carrier", "child"}
VEHICLE_CONFIG_FIELDS = {
    "vehicle_id",
    "name",
    "role",
    "sysid",
    "ip",
    "udp_port",
    "parent_vehicle_id",
    "sort_order",
    "color",
    "collapsed",
    "firmware_profile",
}
DEFAULT_VEHICLES = []


def normalize_vehicle_role(role):
    normalized = str(role or "").strip().lower()
    if normalized in ALLOWED_VEHICLE_ROLES:
        return normalized
    return "child"


class DroneConnectionRequestVehicle(BaseModel):
    vehicle_id: str
    name: str
    role: str
    ip: str
    udp_port: Optional[int] = Field(default=None, ge=1, le=65535)
    firmware_profile: str


class DroneConnectionRequest(BaseModel):
    vehicles: List[DroneConnectionRequestVehicle]


class EmergencyActionRequest(BaseModel):
    action: str


class CompanionLinkTestRequest(BaseModel):
    source_vehicle_id: str
    target_vehicle_id: str
    count: int = Field(default=5, ge=1, le=20)
    timeout_ms: int = Field(default=500, ge=100, le=5000)


class VehiclesConfigRequest(BaseModel):
    vehicles: List[Dict]


def now_ms():
    return int(time.time() * 1000)


def sanitize_vehicle_config(vehicle):
    sanitized = {
        key: vehicle.get(key)
        for key in VEHICLE_CONFIG_FIELDS
        if key in vehicle
    }
    sanitized["vehicle_id"] = str(sanitized.get("vehicle_id") or "").strip()
    sanitized["name"] = str(sanitized.get("name") or "").strip()
    sanitized["role"] = normalize_vehicle_role(sanitized.get("role"))
    sanitized["ip"] = str(sanitized.get("ip") or "").strip()
    sanitized["firmware_profile"] = str(sanitized.get("firmware_profile") or "standard_px4").strip()
    sanitized["parent_vehicle_id"] = sanitized.get("parent_vehicle_id") or None
    sanitized["color"] = sanitized.get("color") or "#60a5fa"
    sanitized["collapsed"] = bool(sanitized.get("collapsed"))

    try:
        sanitized["sysid"] = int(sanitized.get("sysid"))
    except (TypeError, ValueError):
        sanitized["sysid"] = None

    try:
        sanitized["udp_port"] = int(sanitized.get("udp_port"))
    except (TypeError, ValueError):
        sanitized["udp_port"] = None

    try:
        sanitized["sort_order"] = int(sanitized.get("sort_order"))
    except (TypeError, ValueError):
        sanitized["sort_order"] = 0

    return sanitized


def validate_vehicle_configs(vehicles):
    if not isinstance(vehicles, list):
        raise HTTPException(status_code=400, detail={"ok": False, "reason": "vehicles_must_be_array"})

    sanitized = [sanitize_vehicle_config(vehicle) for vehicle in vehicles]
    vehicle_ids = []
    for vehicle in sanitized:
        vehicle_id = vehicle.get("vehicle_id")
        if not vehicle_id:
            raise HTTPException(status_code=400, detail={"ok": False, "reason": "vehicle_id_required"})
        if not vehicle.get("name"):
            raise HTTPException(status_code=400, detail={"ok": False, "reason": "name_required", "vehicle_id": vehicle_id})
        if vehicle_id in vehicle_ids:
            raise HTTPException(status_code=400, detail={"ok": False, "reason": "duplicate_vehicle_id", "vehicle_id": vehicle_id})
        if vehicle.get("udp_port") is not None and not (1 <= vehicle["udp_port"] <= 65535):
            raise HTTPException(status_code=400, detail={"ok": False, "reason": "invalid_udp_port", "vehicle_id": vehicle_id})
        if vehicle.get("sysid") is not None and not (1 <= vehicle["sysid"] <= 255):
            raise HTTPException(status_code=400, detail={"ok": False, "reason": "invalid_sysid", "vehicle_id": vehicle_id})
        vehicle_ids.append(vehicle_id)

    vehicle_id_set = set(vehicle_ids)
    for vehicle in sanitized:
        parent_vehicle_id = vehicle.get("parent_vehicle_id")
        if parent_vehicle_id is not None and parent_vehicle_id not in vehicle_id_set:
            raise HTTPException(
                status_code=400,
                detail={
                    "ok": False,
                    "reason": "invalid_parent_vehicle_id",
                    "vehicle_id": vehicle["vehicle_id"],
                    "parent_vehicle_id": parent_vehicle_id,
                },
            )

    return sanitized


def write_vehicle_configs(vehicles):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": 1,
        "vehicles": vehicles,
        "updated_at_ms": now_ms(),
    }
    tmp_path = VEHICLES_PATH.with_suffix(".json.tmp")
    tmp_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    tmp_path.replace(VEHICLES_PATH)
    return payload


def load_vehicle_configs():
    if not VEHICLES_PATH.exists():
        write_vehicle_configs(DEFAULT_VEHICLES)
        return DEFAULT_VEHICLES

    try:
        payload = json.loads(VEHICLES_PATH.read_text(encoding="utf-8"))
        return validate_vehicle_configs(payload.get("vehicles", []))
    except Exception:
        return DEFAULT_VEHICLES


def vehicle_config_to_request_vehicle(vehicle):
    return DroneConnectionRequestVehicle(
        vehicle_id=vehicle["vehicle_id"],
        name=vehicle["name"],
        role=normalize_vehicle_role(vehicle.get("role")),
        ip=vehicle.get("ip") or "",
        udp_port=vehicle.get("udp_port"),
        firmware_profile=vehicle.get("firmware_profile") or "standard_px4",
    )


def set_known_vehicle_configs(vehicles):
    known_drone_configs.clear()
    known_drone_configs.update({
        vehicle["vehicle_id"]: vehicle_config_to_request_vehicle(vehicle)
        for vehicle in vehicles
    })


active_vehicle_configs = load_vehicle_configs()
set_known_vehicle_configs(active_vehicle_configs)


def normalize_fc_state(value):
    if value is True:
        return "CONNECTED"
    if value is False:
        return "DISCONNECTED"
    if isinstance(value, str) and value in {"CONNECTED", "DISCONNECTED", "UNKNOWN"}:
        return value
    return "UNKNOWN"


def make_status_result(vehicle, state, reason, seq=None, message=None, latency_ms=None, remote=None, health=None):
    health = health if isinstance(health, dict) else {}
    timestamp_ms = now_ms()
    result = {
        "vehicle_id": vehicle.vehicle_id,
        "name": vehicle.name,
        "role": vehicle.role,
        "ip": vehicle.ip,
        "udp_port": vehicle.udp_port,
        "firmware_profile": vehicle.firmware_profile,
        "seq": seq,
        "timestamp_ms": timestamp_ms,
        "connection_state": state,
        "companion_state": state,
        "fc_connected": normalize_fc_state(health.get("fc_connected")),
        "last_seen_ms": timestamp_ms if state == "CONNECTED" else None,
        "last_fc_heartbeat_ms": health.get("last_fc_heartbeat_ms"),
        "position": health.get("position"),
        "gps": health.get("gps"),
        "release_state": health.get("release_state"),
        "trigger_state": health.get("trigger_state") or "UNKNOWN",
        "last_trigger_seq": health.get("last_trigger_seq"),
        "last_trigger_state": health.get("last_trigger_state") or "UNKNOWN",
        "last_trigger_reason": health.get("last_trigger_reason"),
        "last_trigger_relationship_id": health.get("last_trigger_relationship_id"),
        "last_trigger_target_vehicle_id": health.get("last_trigger_target_vehicle_id"),
        "last_trigger_completed_ms": health.get("last_trigger_completed_ms"),
        "rc_trigger_channel": health.get("rc_trigger_channel"),
        "rc_trigger_threshold": health.get("rc_trigger_threshold"),
        "rc_trigger_active": health.get("rc_trigger_active"),
        "rc_trigger_latched": health.get("rc_trigger_latched"),
        "emergency": health.get("emergency"),
        "last_emergency_action": (health.get("emergency") or {}).get("last_action"),
        "last_emergency_result": (health.get("emergency") or {}).get("last_result"),
        "last_emergency_reason": (health.get("emergency") or {}).get("last_reason"),
        "last_emergency_seq": (health.get("emergency") or {}).get("last_seq"),
        "last_emergency_command_ms": (health.get("emergency") or {}).get("last_command_ms"),
        "reason": reason,
        "message": message or reason,
        "latency_ms": latency_ms,
    }
    if remote:
        result["remote"] = remote
    return result


def ping_vehicle(vehicle, seq, timeout_sec=1.0):
    started = time.monotonic()
    timestamp_ms = now_ms()
    ping = {
        "type": "PING",
        "vehicle_id": vehicle.vehicle_id,
        "seq": seq,
        "timestamp_ms": timestamp_ms,
    }
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as udp_socket:
            udp_socket.settimeout(timeout_sec)
            udp_socket.sendto(json.dumps(ping).encode("utf-8"), (vehicle.ip, vehicle.udp_port))
            data, address = udp_socket.recvfrom(4096)

        elapsed_ms = int((time.monotonic() - started) * 1000)
        pong = json.loads(data.decode("utf-8"))
        is_valid_pong = (
            pong.get("type") == "PONG"
            and pong.get("vehicle_id") == vehicle.vehicle_id
            and pong.get("seq") == seq
        )

        if not is_valid_pong:
            return make_status_result(
                vehicle,
                "ERROR",
                "invalid_pong",
                seq=seq,
                message="Invalid UDP PONG response",
                latency_ms=elapsed_ms,
                remote=f"{address[0]}:{address[1]}",
            )

        return make_status_result(
            vehicle,
            "CONNECTED",
            "pong_received",
            seq=seq,
            message=pong.get("status", "OK"),
            latency_ms=elapsed_ms,
            remote=f"{address[0]}:{address[1]}",
            health=pong.get("health"),
        )
    except socket.timeout:
        return make_status_result(
            vehicle,
            "OFFLINE",
            "pong_timeout",
            seq=seq,
            message="UDP PONG timeout",
        )
    except Exception as error:
        return make_status_result(
            vehicle,
            "ERROR",
            "ping_error",
            seq=seq,
            message=str(error),
        )


def send_emergency_action(vehicle, action, timeout_sec=1.0):
    seq = now_ms()
    payload = {
        "type": "EMERGENCY_ACTION",
        "seq": seq,
        "action": action,
        "reason": "ui_emergency_button",
    }

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as udp_socket:
            udp_socket.settimeout(timeout_sec)
            udp_socket.sendto(json.dumps(payload).encode("utf-8"), (vehicle.ip, vehicle.udp_port))
            data, address = udp_socket.recvfrom(4096)

        ack = json.loads(data.decode("utf-8"))
        is_valid_ack = (
            ack.get("type") == "EMERGENCY_ACK"
            and ack.get("seq") == seq
            and ack.get("action") == action
        )

        if not is_valid_ack:
            return {
                "ok": False,
                "vehicle_id": vehicle.vehicle_id,
                "action": action,
                "seq": seq,
                "reason": "invalid_ack",
                "ack": ack,
            }

        return {
            "ok": bool(ack.get("accepted") is True),
            "vehicle_id": vehicle.vehicle_id,
            "action": action,
            "seq": seq,
            "ack": ack,
            "reason": ack.get("reason") or ack.get("result") or "ack_received",
            "remote": f"{address[0]}:{address[1]}",
        }
    except socket.timeout:
        return {
            "ok": False,
            "vehicle_id": vehicle.vehicle_id,
            "action": action,
            "seq": seq,
            "reason": "timeout",
        }
    except Exception as error:
        return {
            "ok": False,
            "vehicle_id": vehicle.vehicle_id,
            "action": action,
            "seq": seq,
            "reason": "send_error",
            "message": str(error),
        }


def send_companion_link_test(source_vehicle, target_vehicle, count=5, timeout_ms=500):
    seq = now_ms()
    payload = {
        "type": "COMPANION_LINK_TEST",
        "seq": seq,
        "target_vehicle_id": target_vehicle.vehicle_id,
        "target_ip": target_vehicle.ip,
        "target_port": target_vehicle.udp_port,
        "count": count,
        "timeout_ms": timeout_ms,
    }
    backend_timeout_sec = max(2.0, (count * timeout_ms / 1000.0) + 1.0)

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as udp_socket:
            udp_socket.settimeout(backend_timeout_sec)
            udp_socket.sendto(
                json.dumps(payload).encode("utf-8"),
                (source_vehicle.ip, source_vehicle.udp_port),
            )
            data, address = udp_socket.recvfrom(65535)

        result = json.loads(data.decode("utf-8"))
        is_valid_result = (
            result.get("type") == "COMPANION_LINK_TEST_RESULT"
            and result.get("seq") == seq
        )

        if not is_valid_result:
            return {
                "type": "COMPANION_LINK_TEST_RESULT",
                "ok": False,
                "accepted": False,
                "source_vehicle_id": source_vehicle.vehicle_id,
                "target_vehicle_id": target_vehicle.vehicle_id,
                "target_ip": target_vehicle.ip,
                "target_port": target_vehicle.udp_port,
                "seq": seq,
                "sent": count,
                "received": 0,
                "lost": count,
                "reason": "invalid_response",
                "response": result,
                "timestamp_ms": now_ms(),
            }

        result["backend_ok"] = bool(result.get("ok"))
        result["backend_remote"] = f"{address[0]}:{address[1]}"
        return result
    except socket.timeout:
        return {
            "type": "COMPANION_LINK_TEST_RESULT",
            "ok": False,
            "accepted": False,
            "source_vehicle_id": source_vehicle.vehicle_id,
            "target_vehicle_id": target_vehicle.vehicle_id,
            "target_ip": target_vehicle.ip,
            "target_port": target_vehicle.udp_port,
            "seq": seq,
            "sent": count,
            "received": 0,
            "lost": count,
            "reason": "timeout",
            "timestamp_ms": now_ms(),
        }
    except Exception as error:
        return {
            "type": "COMPANION_LINK_TEST_RESULT",
            "ok": False,
            "accepted": False,
            "source_vehicle_id": source_vehicle.vehicle_id,
            "target_vehicle_id": target_vehicle.vehicle_id,
            "target_ip": target_vehicle.ip,
            "target_port": target_vehicle.udp_port,
            "seq": seq,
            "sent": count,
            "received": 0,
            "lost": count,
            "reason": "send_error",
            "message": str(error),
            "timestamp_ms": now_ms(),
        }


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "service": "fleet-runtime-backend",
        "version": "0.1.0",
    }


@app.get("/api/runtime/status")
def runtime_status():
    return {
        "ok": True,
        "runtime": "mock",
        "mavlink": "not_implemented",
        "udp_companion": "not_implemented",
        "trigger_send": "not_implemented",
    }


@app.get("/api/vehicles")
def get_vehicles():
    return {
        "ok": True,
        "vehicles": active_vehicle_configs,
    }


@app.put("/api/vehicles")
def put_vehicles(request: VehiclesConfigRequest):
    global active_vehicle_configs

    vehicles = validate_vehicle_configs(request.vehicles)
    write_vehicle_configs(vehicles)
    active_vehicle_configs = vehicles
    set_known_vehicle_configs(active_vehicle_configs)

    return {
        "ok": True,
        "vehicles": active_vehicle_configs,
    }


@app.post("/api/drones/connect")
def connect_drones(request: DroneConnectionRequest):
    known_drone_configs.clear()
    known_drone_configs.update({
        vehicle.vehicle_id: vehicle
        for vehicle in request.vehicles
    })

    results = [
        ping_vehicle(vehicle, seq=index + 1)
        for index, vehicle in enumerate(request.vehicles)
    ]
    last_drone_status["ok"] = True
    last_drone_status["results"] = {
        result["vehicle_id"]: result
        for result in results
    }
    last_drone_status["timestamp_ms"] = now_ms()

    return last_drone_status


@app.get("/api/drones/status")
def drones_status():
    return last_drone_status


@app.post("/api/drones/{vehicle_id}/emergency")
def emergency_action(vehicle_id: str, request: EmergencyActionRequest):
    action = request.action
    if action not in ALLOWED_EMERGENCY_ACTIONS:
        raise HTTPException(
            status_code=400,
            detail={
                "ok": False,
                "vehicle_id": vehicle_id,
                "action": action,
                "reason": "unsupported_action",
            },
        )

    vehicle = known_drone_configs.get(vehicle_id)
    if not vehicle:
        raise HTTPException(
            status_code=404,
            detail={
                "ok": False,
                "vehicle_id": vehicle_id,
                "action": action,
                "reason": "vehicle_not_found",
            },
        )

    if not vehicle.ip or not vehicle.udp_port:
        raise HTTPException(
            status_code=400,
            detail={
                "ok": False,
                "vehicle_id": vehicle_id,
                "action": action,
                "reason": "missing_vehicle_endpoint",
            },
        )

    return send_emergency_action(vehicle, action)


@app.post("/api/companion/link-test")
def companion_link_test(request: CompanionLinkTestRequest):
    source_vehicle = known_drone_configs.get(request.source_vehicle_id)
    target_vehicle = known_drone_configs.get(request.target_vehicle_id)

    if not source_vehicle:
        raise HTTPException(
            status_code=404,
            detail={
                "ok": False,
                "reason": "source_vehicle_not_found",
                "source_vehicle_id": request.source_vehicle_id,
            },
        )
    if not target_vehicle:
        raise HTTPException(
            status_code=404,
            detail={
                "ok": False,
                "reason": "target_vehicle_not_found",
                "target_vehicle_id": request.target_vehicle_id,
            },
        )
    if not source_vehicle.ip or not source_vehicle.udp_port:
        raise HTTPException(
            status_code=400,
            detail={
                "ok": False,
                "reason": "missing_source_endpoint",
                "source_vehicle_id": request.source_vehicle_id,
            },
        )
    if not target_vehicle.ip or not target_vehicle.udp_port:
        raise HTTPException(
            status_code=400,
            detail={
                "ok": False,
                "reason": "missing_target_endpoint",
                "target_vehicle_id": request.target_vehicle_id,
            },
        )

    return send_companion_link_test(
        source_vehicle,
        target_vehicle,
        count=request.count,
        timeout_ms=request.timeout_ms,
    )


@app.get("/")
def editor_index():
    return FileResponse(INDEX_HTML)


app.mount("/src", StaticFiles(directory=SRC_DIR), name="src")
