import json
import socket
import os
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field


def get_project_root():
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS)
    return Path(__file__).resolve().parents[1]


PROJECT_ROOT = get_project_root()
SRC_DIR = PROJECT_ROOT / "src"
INDEX_HTML = PROJECT_ROOT / "index.html"
DATA_DIR = Path(os.environ.get("FLEET_MISSION_EDITOR_DATA_DIR", PROJECT_ROOT / "backend" / "data"))
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


class ManualReleaseTriggerRequest(BaseModel):
    target_vehicle_id: str
    seq: Optional[int] = None


class RuntimeStateResetRequest(BaseModel):
    vehicle_id: str
    scope: str = "all_runtime"
    reset_trigger_dedupe: bool = True
    reset_rc_latch: bool = False
    seq: Optional[int] = None


class MissionClearRequest(BaseModel):
    vehicle_id: str
    seq: Optional[int] = None


class MissionStartRequest(BaseModel):
    vehicle_id: str
    start_seq: int = 0
    arm: bool = True
    auto_mission: bool = True
    mission_start: bool = True
    confirm_start: bool = False
    timeout_ms: int = Field(default=5000, ge=100, le=30000)


class ActionPlanUploadRequest(BaseModel):
    vehicle_id: str
    mission_id: str
    actions: List[Dict]
    seq: Optional[int] = None


class CompanionLinkTestRequest(BaseModel):
    source_vehicle_id: str
    target_vehicle_id: str
    count: int = Field(default=5, ge=1, le=20)
    timeout_ms: int = Field(default=500, ge=100, le=5000)


class VehiclesConfigRequest(BaseModel):
    vehicles: List[Dict]


class MissionPayloadRequest(BaseModel):
    payload: Dict


MISSION_FRAME_GLOBAL_RELATIVE_ALT = 3
MISSION_FRAME_GLOBAL_RELATIVE_ALT_INT = 6
MISSION_COMMAND_NAV_WAYPOINT = 16
MISSION_COMMAND_NAV_LAND = 21
MISSION_COMMAND_NAV_TAKEOFF = 22
DEFAULT_RELEASE_ACTUATOR = {
    "method": "MAV_CMD_DO_SET_ACTUATOR",
    "actuator_index": 1,
    "value": 0.4,
    "hold_ms": 800,
    "reset_value": -0.7,
}


def now_ms():
    return int(time.time() * 1000)


def safe_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


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


def make_status_result(vehicle, state, reason, seq=None, message=None, latency_ms=None, remote=None, health=None, status_type=None):
    health = health if isinstance(health, dict) else {}
    timestamp_ms = now_ms()
    result = {
        "type": status_type,
        "status_type": status_type,
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
        "companion_alive": health.get("companion_alive"),
        "fc_connected": normalize_fc_state(health.get("fc_connected")),
        "last_seen_ms": timestamp_ms if state == "CONNECTED" else None,
        "last_fc_heartbeat_ms": health.get("last_fc_heartbeat_ms"),
        "position": health.get("position"),
        "gps": health.get("gps"),
        "nav_gate": health.get("nav_gate"),
        "mission": health.get("mission"),
        "mission_progress": health.get("mission_progress"),
        "action_plan": health.get("action_plan"),
        "trigger_feedback_ok": health.get("trigger_feedback_ok"),
        "trigger_forwarded_ok": health.get("trigger_forwarded_ok"),
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


def request_vehicle_status(vehicle, seq, timeout_sec=1.0):
    started = time.monotonic()
    timestamp_ms = now_ms()
    request = {
        "type": "GET_STATUS",
        "vehicle_id": vehicle.vehicle_id,
        "seq": seq,
        "timestamp_ms": timestamp_ms,
    }
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as udp_socket:
            udp_socket.settimeout(timeout_sec)
            udp_socket.sendto(json.dumps(request).encode("utf-8"), (vehicle.ip, vehicle.udp_port))
            data, address = udp_socket.recvfrom(65535)

        elapsed_ms = int((time.monotonic() - started) * 1000)
        status = json.loads(data.decode("utf-8"))
        is_valid_status = (
            status.get("type") == "STATUS"
            and status.get("vehicle_id") == vehicle.vehicle_id
            and status.get("seq") == seq
        )

        if not is_valid_status:
            return make_status_result(
                vehicle,
                "ERROR",
                "invalid_status",
                seq=seq,
                message="Invalid UDP STATUS response",
                latency_ms=elapsed_ms,
                remote=f"{address[0]}:{address[1]}",
                status_type=status.get("type"),
            )

        health = status.get("health")
        connected = isinstance(health, dict) and health.get("companion_alive") is True
        return make_status_result(
            vehicle,
            "CONNECTED" if connected else "OFFLINE",
            "status_received" if connected else "status_companion_not_alive",
            seq=seq,
            message=status.get("status", "OK"),
            latency_ms=elapsed_ms,
            remote=f"{address[0]}:{address[1]}",
            health=health,
            status_type="STATUS",
        )
    except socket.timeout:
        return make_status_result(
            vehicle,
            "OFFLINE",
            "status_timeout",
            seq=seq,
            message="UDP STATUS timeout",
            status_type="STATUS",
        )
    except Exception as error:
        return make_status_result(
            vehicle,
            "ERROR",
            "status_error",
            seq=seq,
            message=str(error),
            status_type="STATUS",
        )


def refresh_vehicle_status(vehicle, seq, timeout_sec=1.0):
    status_result = request_vehicle_status(vehicle, seq, timeout_sec=timeout_sec)
    if status_result.get("connection_state") == "CONNECTED":
        return status_result

    ping_result = ping_vehicle(vehicle, seq, timeout_sec=timeout_sec)
    if ping_result.get("connection_state") == "CONNECTED":
        return ping_result

    return status_result if status_result.get("reason") != "status_timeout" else ping_result


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
            data, address = udp_socket.recvfrom(65535)

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
            status_type="PONG",
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


def send_companion_command(vehicle, payload, expected_type, timeout_sec=2.0):
    seq = payload.get("seq") or now_ms()
    payload = {
        **payload,
        "seq": seq,
        "vehicle_id": vehicle.vehicle_id,
    }

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as udp_socket:
            udp_socket.settimeout(timeout_sec)
            udp_socket.sendto(
                json.dumps(payload).encode("utf-8"),
                (vehicle.ip, vehicle.udp_port),
            )
            data, address = udp_socket.recvfrom(65535)

        result = json.loads(data.decode("utf-8"))
        is_valid_result = (
            result.get("type") == expected_type
            and result.get("seq") == seq
        )
        if not is_valid_result:
            return {
                "ok": False,
                "accepted": False,
                "reason": "invalid_response",
                "vehicle_id": vehicle.vehicle_id,
                "seq": seq,
                "request": payload,
                "response": result,
                "remote": f"{address[0]}:{address[1]}",
            }

        return {
            "ok": bool(result.get("ok", result.get("accepted", True))),
            "accepted": bool(result.get("accepted", result.get("ok", True))),
            "reason": result.get("reason") or "result_received",
            "vehicle_id": vehicle.vehicle_id,
            "seq": seq,
            "request": payload,
            "result": result,
            "remote": f"{address[0]}:{address[1]}",
        }
    except socket.timeout:
        return {
            "ok": False,
            "accepted": False,
            "reason": "timeout",
            "vehicle_id": vehicle.vehicle_id,
            "seq": seq,
            "request": payload,
        }
    except Exception as error:
        return {
            "ok": False,
            "accepted": False,
            "reason": "send_error",
            "message": str(error),
            "vehicle_id": vehicle.vehicle_id,
            "seq": seq,
            "request": payload,
        }


def send_manual_release_trigger(carrier_vehicle, target_vehicle, seq=None, timeout_sec=5.0):
    seq = seq or now_ms()
    payload = {
        "type": "MANUAL_RELEASE_TRIGGER",
        "seq": seq,
        "vehicle_id": carrier_vehicle.vehicle_id,
        "target_vehicle_id": target_vehicle.vehicle_id,
        "target_ip": target_vehicle.ip,
        "target_port": target_vehicle.udp_port,
        "release": dict(DEFAULT_RELEASE_ACTUATOR),
    }

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as udp_socket:
            udp_socket.settimeout(timeout_sec)
            udp_socket.sendto(
                json.dumps(payload).encode("utf-8"),
                (carrier_vehicle.ip, carrier_vehicle.udp_port),
            )
            data, address = udp_socket.recvfrom(65535)

        result = json.loads(data.decode("utf-8"))
        response_type = result.get("type")
        is_manual_result = response_type == "MANUAL_RELEASE_TRIGGER_RESULT"
        is_child_trigger_ack = response_type == "CHILD_NAV_GATE_TRIGGER_ACK"
        is_valid_result = (
            is_manual_result
            and result.get("seq") == seq
        )
        if not is_valid_result:
            reason = "invalid_response"
            warnings = []
            if is_child_trigger_ack:
                reason = "unexpected_child_ack_instead_of_manual_release_result"
                warnings.append("Unexpected child trigger ACK received during manual release request")
            return {
                "ok": False,
                "accepted": False,
                "reason": reason,
                "vehicle_id": carrier_vehicle.vehicle_id,
                "target_vehicle_id": target_vehicle.vehicle_id,
                "seq": seq,
                "request": payload,
                "response": result,
                "warnings": warnings,
                "remote": f"{address[0]}:{address[1]}",
                "sent_to": {
                    "ip": carrier_vehicle.ip,
                    "udp_port": carrier_vehicle.udp_port,
                    "vehicle_id": carrier_vehicle.vehicle_id,
                },
            }

        warnings = []
        if is_manual_result and result.get("vehicle_id") and result.get("vehicle_id") != carrier_vehicle.vehicle_id:
            warnings.append(
                f"response_vehicle_id_mismatch expected={carrier_vehicle.vehicle_id} actual={result.get('vehicle_id')}"
            )

        return {
            "ok": bool(result.get("ok", result.get("accepted", True))),
            "accepted": bool(result.get("accepted", result.get("ok", True))),
            "reason": result.get("reason") or "result_received",
            "relationship_id": result.get("relationship_id") or result.get("relationship_id") or f"manual_release_trigger_{seq}",
            "action_status": result.get("action_status"),
            "vehicle_id": carrier_vehicle.vehicle_id,
            "target_vehicle_id": target_vehicle.vehicle_id,
            "seq": seq,
            "warnings": warnings,
            "request": payload,
            "result": result,
            "remote": f"{address[0]}:{address[1]}",
            "sent_to": {
                "ip": carrier_vehicle.ip,
                "udp_port": carrier_vehicle.udp_port,
                "vehicle_id": carrier_vehicle.vehicle_id,
            },
        }
    except socket.timeout:
        return {
            "ok": False,
            "accepted": False,
            "reason": "timeout",
            "vehicle_id": carrier_vehicle.vehicle_id,
            "target_vehicle_id": target_vehicle.vehicle_id,
            "seq": seq,
            "request": payload,
        }
    except Exception as error:
        return {
            "ok": False,
            "accepted": False,
            "reason": "send_error",
            "message": str(error),
            "vehicle_id": carrier_vehicle.vehicle_id,
            "target_vehicle_id": target_vehicle.vehicle_id,
            "seq": seq,
            "request": payload,
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


def get_mission_vehicle(payload):
    vehicle_id = str(payload.get("vehicle_id") or "").strip()
    vehicle = known_drone_configs.get(vehicle_id)
    if vehicle:
        return vehicle

    for config in active_vehicle_configs:
        if config.get("vehicle_id") == vehicle_id:
            return vehicle_config_to_request_vehicle(config)

    raise HTTPException(
        status_code=404,
        detail={
            "ok": False,
            "reason": "vehicle_not_found",
            "vehicle_id": vehicle_id,
        },
    )


def require_vehicle_endpoint(vehicle):
    if not vehicle.ip or not vehicle.udp_port:
        raise HTTPException(
            status_code=400,
            detail={
                "ok": False,
                "reason": "missing_vehicle_endpoint",
                "vehicle_id": vehicle.vehicle_id,
            },
        )


def normalize_mission_item(item, index):
    return {
        "seq": int(item.get("seq", index)),
        "frame": int(item.get("frame", MISSION_FRAME_GLOBAL_RELATIVE_ALT)),
        "command": int(item.get("command")),
        "current": int(item.get("current", 0)),
        "autocontinue": int(item.get("autocontinue", item.get("autoContinue", 1))),
        "param1": float(item.get("param1", 0) or 0),
        "param2": float(item.get("param2", 0) or 0),
        "param3": float(item.get("param3", 0) or 0),
        "param4": item.get("param4"),
        "x": float(item.get("x")),
        "y": float(item.get("y")),
        "z": float(item.get("z")),
    }


def normalize_mission_payload_for_companion(payload):
    items = payload.get("items") or []
    return {
        "vehicle_id": payload.get("vehicle_id"),
        "mission_id": payload.get("mission_id"),
        "role": normalize_vehicle_role(payload.get("role")),
        "mission_profile": payload.get("mission_profile"),
        "items": [
            normalize_mission_item(item, index)
            for index, item in enumerate(items)
        ],
    }


def send_companion_mission_message(vehicle, message, expected_type, timeout_sec=3.0):
    started = time.monotonic()
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as udp_socket:
            udp_socket.settimeout(timeout_sec)
            udp_socket.sendto(
                json.dumps(message).encode("utf-8"),
                (vehicle.ip, vehicle.udp_port),
            )
            data, address = udp_socket.recvfrom(65535)

        response = json.loads(data.decode("utf-8"))
        elapsed_ms = int((time.monotonic() - started) * 1000)
        is_valid_response = (
            response.get("type") == expected_type
            and response.get("seq") == message.get("seq")
        )
        if not is_valid_response:
            return {
                "ok": False,
                "reason": "invalid_response",
                "expected_type": expected_type,
                "message": message,
                "response": response,
                "latency_ms": elapsed_ms,
                "remote": f"{address[0]}:{address[1]}",
            }

        response["backend_ok"] = bool(response.get("ok", response.get("accepted", True)))
        response["backend_reason"] = response.get("reason") or response.get("result") or "response_received"
        response["backend_latency_ms"] = elapsed_ms
        response["backend_remote"] = f"{address[0]}:{address[1]}"
        return response
    except socket.timeout:
        return {
            "ok": False,
            "reason": "timeout",
            "expected_type": expected_type,
            "seq": message.get("seq"),
            "vehicle_id": vehicle.vehicle_id,
        }
    except Exception as error:
        return {
            "ok": False,
            "reason": "send_error",
            "expected_type": expected_type,
            "seq": message.get("seq"),
            "vehicle_id": vehicle.vehicle_id,
            "message": str(error),
        }


def send_mission_upload(vehicle, payload):
    normalized = normalize_mission_payload_for_companion(payload)
    seq = now_ms()
    message = {
        "type": "MISSION_UPLOAD",
        "seq": seq,
        "vehicle_id": normalized["vehicle_id"],
        "mission_id": normalized["mission_id"],
        "role": normalized["role"],
        "mission_profile": normalized["mission_profile"],
        "items": normalized["items"],
    }
    result = send_companion_mission_message(
        vehicle,
        message,
        "MISSION_UPLOAD_RESULT",
    )
    return {
        "ok": bool(result.get("ok", result.get("backend_ok", False))),
        "reason": result.get("reason") or result.get("backend_reason"),
        "vehicle_id": vehicle.vehicle_id,
        "uploaded_count": result.get("uploaded_count", result.get("count")),
        "request": message,
        "result": result,
    }


def send_mission_download(vehicle, payload):
    seq = now_ms()
    message = {
        "type": "MISSION_DOWNLOAD",
        "seq": seq,
        "vehicle_id": payload.get("vehicle_id"),
    }
    result = send_companion_mission_message(
        vehicle,
        message,
        "MISSION_DOWNLOAD_RESULT",
    )
    items = result.get("items")
    if items is None and isinstance(result.get("mission"), dict):
        items = result["mission"].get("items")
    if items is None:
        items = []
    return {
        "ok": bool(result.get("ok", result.get("backend_ok", False))),
        "reason": result.get("reason") or result.get("backend_reason"),
        "vehicle_id": vehicle.vehicle_id,
        "downloaded_count": result.get("count", len(items)),
        "items": items,
        "request": message,
        "result": result,
    }


def frames_compatible(expected_frame, actual_frame):
    compatible_frames = {
        MISSION_FRAME_GLOBAL_RELATIVE_ALT,
        MISSION_FRAME_GLOBAL_RELATIVE_ALT_INT,
    }
    return int(expected_frame) == int(actual_frame) or (
        int(expected_frame) in compatible_frames
        and int(actual_frame) in compatible_frames
    )


def compare_mission_items(upload_payload, download_items):
    errors = []
    warnings = []
    expected_items = normalize_mission_payload_for_companion(upload_payload)["items"]
    actual_items = []
    for index, item in enumerate(download_items or []):
        if not isinstance(item, dict):
            errors.append(f"item_{index}_readback_must_be_object")
            continue
        try:
            actual_items.append(normalize_mission_item(item, index))
        except (TypeError, ValueError):
            errors.append(f"item_{index}_readback_position_or_command_invalid")

    if len(expected_items) != len(actual_items):
        errors.append(f"item_count_mismatch expected={len(expected_items)} actual={len(actual_items)}")

    for index, expected in enumerate(expected_items):
        if index >= len(actual_items):
            errors.append(f"item_{index}_missing_in_readback")
            continue
        actual = actual_items[index]
        if expected["command"] != actual["command"]:
            errors.append(f"item_{index}_command_mismatch expected={expected['command']} actual={actual['command']}")
        if not frames_compatible(expected["frame"], actual["frame"]):
            errors.append(f"item_{index}_frame_mismatch expected={expected['frame']} actual={actual['frame']}")
        if abs(expected["z"] - actual["z"]) > 0.05:
            errors.append(f"item_{index}_z_mismatch expected={expected['z']} actual={actual['z']}")
        if abs(expected["x"] - actual["x"]) > 0.0000002:
            errors.append(f"item_{index}_lat_mismatch expected={expected['x']} actual={actual['x']}")
        if abs(expected["y"] - actual["y"]) > 0.0000002:
            errors.append(f"item_{index}_lon_mismatch expected={expected['y']} actual={actual['y']}")
        if expected["frame"] != actual["frame"] and frames_compatible(expected["frame"], actual["frame"]):
            warnings.append(f"item_{index}_frame_compatible expected={expected['frame']} actual={actual['frame']}")

    return {
        "verified": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
        "expected_count": len(expected_items),
        "actual_count": len(actual_items),
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
        refresh_vehicle_status(vehicle, seq=index + 1)
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


@app.post("/api/drones/{vehicle_id}/manual-release-trigger")
def manual_release_trigger(vehicle_id: str, request: ManualReleaseTriggerRequest):
    carrier_vehicle = known_drone_configs.get(vehicle_id)
    target_vehicle = known_drone_configs.get(request.target_vehicle_id)

    if not carrier_vehicle:
        raise HTTPException(
            status_code=404,
            detail={
                "ok": False,
                "reason": "carrier_vehicle_not_found",
                "vehicle_id": vehicle_id,
            },
        )
    if normalize_vehicle_role(carrier_vehicle.role) != "carrier":
        raise HTTPException(
            status_code=400,
            detail={
                "ok": False,
                "reason": "vehicle_must_be_carrier",
                "vehicle_id": vehicle_id,
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
    if normalize_vehicle_role(target_vehicle.role) != "child":
        raise HTTPException(
            status_code=400,
            detail={
                "ok": False,
                "reason": "target_vehicle_must_be_child",
                "target_vehicle_id": request.target_vehicle_id,
            },
        )
    if not carrier_vehicle.ip or not carrier_vehicle.udp_port:
        raise HTTPException(
            status_code=400,
            detail={
                "ok": False,
                "reason": "missing_carrier_endpoint",
                "vehicle_id": vehicle_id,
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

    return send_manual_release_trigger(
        carrier_vehicle,
        target_vehicle,
        seq=request.seq,
    )


def get_command_vehicle_or_raise(vehicle_id: str):
    vehicle = known_drone_configs.get(vehicle_id)
    if not vehicle:
        raise HTTPException(
            status_code=404,
            detail={
                "ok": False,
                "reason": "vehicle_not_found",
                "vehicle_id": vehicle_id,
            },
        )
    if not vehicle.ip or not vehicle.udp_port:
        raise HTTPException(
            status_code=400,
            detail={
                "ok": False,
                "reason": "missing_vehicle_endpoint",
                "vehicle_id": vehicle_id,
            },
        )
    return vehicle


@app.post("/api/drone/runtime-reset")
def runtime_state_reset(request: RuntimeStateResetRequest):
    vehicle = get_command_vehicle_or_raise(request.vehicle_id)
    return send_companion_command(
        vehicle,
        {
            "type": "RUNTIME_STATE_RESET",
            "seq": request.seq,
            "scope": request.scope or "all_runtime",
            "reset_trigger_dedupe": request.reset_trigger_dedupe,
            "reset_rc_latch": request.reset_rc_latch,
        },
        "RUNTIME_STATE_RESET_RESULT",
    )


@app.post("/api/drone/mission-clear")
def mission_clear(request: MissionClearRequest):
    vehicle = get_command_vehicle_or_raise(request.vehicle_id)
    return send_companion_command(
        vehicle,
        {
            "type": "MISSION_CLEAR",
            "seq": request.seq,
        },
        "MISSION_CLEAR_RESULT",
    )


def reject_mission_start(vehicle_id, reason, status_code=400, status_result=None):
    detail = {
        "ok": False,
        "accepted": False,
        "vehicle_id": vehicle_id,
        "reason": reason,
    }
    if status_result is not None:
        detail["status"] = status_result
    raise HTTPException(status_code=status_code, detail=detail)


@app.post("/api/drone/mission-start")
def mission_start(request: MissionStartRequest):
    vehicle = get_command_vehicle_or_raise(request.vehicle_id)

    if request.confirm_start is not True:
        reject_mission_start(request.vehicle_id, "mission_start_confirmation_required")

    if normalize_vehicle_role(vehicle.role) != "carrier":
        reject_mission_start(request.vehicle_id, "mission_start_carrier_only")

    status_result = request_vehicle_status(
        vehicle,
        now_ms(),
        timeout_sec=max(0.1, min(request.timeout_ms / 1000, 30.0)),
    )
    if status_result.get("connection_state") != "CONNECTED":
        reject_mission_start(request.vehicle_id, "companion_not_connected", status_result=status_result)

    if status_result.get("fc_connected") != "CONNECTED":
        reject_mission_start(request.vehicle_id, "fc_not_connected", status_result=status_result)

    mission = status_result.get("mission") if isinstance(status_result.get("mission"), dict) else {}
    if mission.get("last_upload_result") != "MISSION_ACK_ACCEPTED" or safe_int(mission.get("last_upload_count")) <= 0:
        reject_mission_start(request.vehicle_id, "mission_not_uploaded", status_result=status_result)
    if mission.get("last_download_result") != "OK":
        reject_mission_start(request.vehicle_id, "mission_not_verified", status_result=status_result)

    action_plan = status_result.get("action_plan") if isinstance(status_result.get("action_plan"), dict) else {}
    if action_plan.get("loaded") is not True or safe_int(action_plan.get("action_count")) <= 0:
        reject_mission_start(request.vehicle_id, "action_plan_not_loaded", status_result=status_result)

    return send_companion_command(
        vehicle,
        {
            "type": "MISSION_START",
            "seq": now_ms(),
            "start_seq": request.start_seq,
            "arm": request.arm,
            "auto_mission": request.auto_mission,
            "mission_start": request.mission_start,
        },
        "MISSION_START_RESULT",
        timeout_sec=max(0.1, min(request.timeout_ms / 1000, 30.0)),
    )


def validate_action_plan_upload(vehicle, mission_id, actions):
    errors = []
    warnings = []
    vehicles_by_id = {
        vehicle_config.get("vehicle_id"): vehicle_config
        for vehicle_config in active_vehicle_configs
        if vehicle_config.get("vehicle_id")
    }

    if normalize_vehicle_role(vehicle.role) != "carrier":
        errors.append("vehicle_must_be_carrier")
    if not mission_id:
        errors.append("mission_id_required")
    if not isinstance(actions, list):
        errors.append("actions_must_be_array")
        actions = []
    if len(actions) == 0:
        errors.append("actions_empty")

    seen_action_ids = set()
    for index, action in enumerate(actions):
        if not isinstance(action, dict):
            errors.append(f"action_{index}_must_be_object")
            continue
        action_id = action.get("action_id")
        if not action_id:
            errors.append(f"action_{index}_action_id_required")
        elif action_id in seen_action_ids:
            errors.append(f"action_{index}_duplicate_action_id")
        seen_action_ids.add(action_id)

        if action.get("type") != "RELEASE_AND_TRIGGER_CHILD":
            errors.append(f"action_{index}_unsupported_type")
        trigger_seq = action.get("trigger_waypoint_seq")
        if not isinstance(trigger_seq, int) or trigger_seq < 0:
            errors.append(f"action_{index}_invalid_trigger_waypoint_seq")

        target_vehicle_id = action.get("target_vehicle_id")
        target_vehicle = vehicles_by_id.get(target_vehicle_id)
        if not target_vehicle_id:
            errors.append(f"action_{index}_target_vehicle_id_required")
        elif not target_vehicle:
            errors.append(f"action_{index}_target_vehicle_not_found")
        elif normalize_vehicle_role(target_vehicle.get("role")) != "child":
            errors.append(f"action_{index}_target_vehicle_not_child")

        release = action.get("release")
        if not isinstance(release, dict):
            errors.append(f"action_{index}_release_required")
        else:
            if release.get("method") != "MAV_CMD_DO_SET_ACTUATOR":
                errors.append(f"action_{index}_release_method_must_be_actuator")
            if release.get("actuator_index") != 1:
                errors.append(f"action_{index}_release_actuator_index_must_be_1")
            try:
                value = float(release.get("value"))
                reset_value = float(release.get("reset_value"))
                if value < -1.0 or value > 1.0:
                    errors.append(f"action_{index}_release_value_out_of_range")
                if reset_value < -1.0 or reset_value > 1.0:
                    errors.append(f"action_{index}_release_reset_value_out_of_range")
            except (TypeError, ValueError):
                errors.append(f"action_{index}_release_value_must_be_number")
            try:
                hold_ms = int(release.get("hold_ms"))
                if hold_ms < 0:
                    errors.append(f"action_{index}_release_hold_ms_negative")
            except (TypeError, ValueError):
                errors.append(f"action_{index}_release_hold_ms_must_be_integer")

        trigger = action.get("trigger")
        if not isinstance(trigger, dict):
            errors.append(f"action_{index}_trigger_required")
        else:
            if trigger.get("type") != "CHILD_NAV_GATE_TRIGGER":
                errors.append(f"action_{index}_unexpected_trigger_type")
            if not trigger.get("target_ip"):
                errors.append(f"action_{index}_target_ip_required")
            try:
                target_port = int(trigger.get("target_port"))
                if target_port < 1 or target_port > 65535:
                    errors.append(f"action_{index}_target_port_out_of_range")
            except (TypeError, ValueError):
                errors.append(f"action_{index}_target_port_must_be_integer")

    return {
        "ok": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
    }


@app.post("/api/drone/action-plan-upload")
def action_plan_upload(request: ActionPlanUploadRequest):
    vehicle = get_command_vehicle_or_raise(request.vehicle_id)
    validation = validate_action_plan_upload(vehicle, request.mission_id, request.actions)
    if not validation["ok"]:
        raise HTTPException(
            status_code=400,
            detail={
                **validation,
                "reason": "action_plan_validation_failed",
                "vehicle_id": request.vehicle_id,
            },
        )

    return send_companion_command(
        vehicle,
        {
            "type": "ACTION_PLAN_UPLOAD",
            "seq": request.seq,
            "mission_id": request.mission_id,
            "actions": request.actions,
        },
        "ACTION_PLAN_UPLOAD_RESULT",
    )


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


def validate_mission_upload_payload(payload):
    errors = []
    warnings = []

    if not isinstance(payload, dict):
        return {
            "ok": False,
            "errors": ["payload_must_be_object"],
            "warnings": warnings,
        }

    items = payload.get("items")
    role = normalize_vehicle_role(payload.get("role"))

    if not payload.get("vehicle_id"):
        errors.append("vehicle_id_required")
    if not payload.get("mission_id"):
        errors.append("mission_id_required")
    if not isinstance(items, list) or len(items) == 0:
        errors.append("items_required")
        items = []

    for index, item in enumerate(items):
        if not isinstance(item, dict):
            errors.append(f"item_{index}_must_be_object")
            continue
        if item.get("frame") != 3:
            warnings.append(f"item_{index}_frame_not_global_relative_alt")
        if item.get("command") not in {
            MISSION_COMMAND_NAV_WAYPOINT,
            MISSION_COMMAND_NAV_LAND,
            MISSION_COMMAND_NAV_TAKEOFF,
        }:
            errors.append(f"item_{index}_unsupported_command")
        if item.get("x") is None or item.get("y") is None or item.get("z") is None:
            errors.append(f"item_{index}_missing_position")
        try:
            float(item.get("x"))
            float(item.get("y"))
            float(item.get("z"))
        except (TypeError, ValueError):
            errors.append(f"item_{index}_position_must_be_number")

    if role == "child" and items:
        try:
            if items[0].get("command") != MISSION_COMMAND_NAV_TAKEOFF and float(items[0].get("z") or 0) > 2:
                warnings.append("child_wp1_alt_offset_gt_2m")
        except (TypeError, ValueError):
            pass

    if role == "carrier":
        commands = [item.get("command") for item in items if isinstance(item, dict)]
        vehicles_by_id = {
            vehicle.get("vehicle_id"): vehicle
            for vehicle in active_vehicle_configs
            if vehicle.get("vehicle_id")
        }
        if MISSION_COMMAND_NAV_TAKEOFF not in commands:
            errors.append("carrier_takeoff_required")
        if MISSION_COMMAND_NAV_LAND not in commands:
            errors.append("carrier_land_required")

        action_plan = payload.get("action_plan")
        if action_plan is not None:
            if not isinstance(action_plan, dict):
                errors.append("action_plan_must_be_object")
            else:
                actions = action_plan.get("actions")
                if not isinstance(actions, list):
                    errors.append("action_plan_actions_must_be_array")
                    actions = []
                seen_targets = set()
                for index, action in enumerate(actions):
                    if not isinstance(action, dict):
                        errors.append(f"action_{index}_must_be_object")
                        continue
                    if action.get("type") != "RELEASE_AND_TRIGGER_CHILD":
                        errors.append(f"action_{index}_unsupported_type")
                    trigger_seq = action.get("trigger_waypoint_seq")
                    if not isinstance(trigger_seq, int) or trigger_seq < 0:
                        errors.append(f"action_{index}_invalid_trigger_waypoint_seq")
                    target_vehicle_id = action.get("target_vehicle_id")
                    if not target_vehicle_id:
                        errors.append(f"action_{index}_target_vehicle_id_required")
                    elif target_vehicle_id in seen_targets:
                        warnings.append(f"action_{index}_duplicate_target_vehicle_id")
                    elif target_vehicle_id not in vehicles_by_id:
                        errors.append(f"action_{index}_target_vehicle_not_found")
                    elif normalize_vehicle_role(vehicles_by_id[target_vehicle_id].get("role")) != "child":
                        errors.append(f"action_{index}_target_vehicle_not_child")
                    seen_targets.add(target_vehicle_id)
                    release = action.get("release")
                    trigger = action.get("trigger")
                    if not isinstance(release, dict):
                        warnings.append(f"action_{index}_release_missing")
                    else:
                        if release.get("method") != "MAV_CMD_DO_SET_ACTUATOR":
                            errors.append(f"action_{index}_release_method_must_be_actuator")
                        if release.get("actuator_index") != 1:
                            errors.append(f"action_{index}_release_actuator_index_must_be_1")
                        if release.get("value") != 0.4:
                            warnings.append(f"action_{index}_release_value_not_verified_default")
                        if release.get("reset_value") != -0.7:
                            warnings.append(f"action_{index}_release_reset_value_not_verified_default")
                        if release.get("hold_ms") != 800:
                            warnings.append(f"action_{index}_release_hold_ms_not_verified_default")
                    if not isinstance(trigger, dict):
                        warnings.append(f"action_{index}_trigger_missing")
                    elif trigger.get("type") != "CHILD_NAV_GATE_TRIGGER":
                        warnings.append(f"action_{index}_unexpected_trigger_type")

    return {
        "ok": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
    }


@app.post("/api/missions/validate")
def validate_mission_payload(request: MissionPayloadRequest):
    validation = validate_mission_upload_payload(request.payload)
    return {
        **validation,
        "payload": request.payload,
    }


@app.post("/api/missions/upload-dry-run")
def upload_mission_dry_run(request: MissionPayloadRequest):
    validation = validate_mission_upload_payload(request.payload)
    return {
        **validation,
        "upload_ready": validation["ok"],
        "action_plan_ready": bool(request.payload.get("action_plan")) and validation["ok"],
        "action_plan_upload_implemented": False,
        "message": "Mission/action-plan validation dry-run complete. ACTION_PLAN_UPLOAD is not sent in this step.",
        "payload": request.payload,
        "action_plan": request.payload.get("action_plan"),
    }


@app.post("/api/missions/upload")
def upload_mission(request: MissionPayloadRequest):
    validation = validate_mission_upload_payload(request.payload)
    if not validation["ok"]:
        raise HTTPException(
            status_code=400,
            detail={
                **validation,
                "reason": "mission_validation_failed",
            },
        )

    vehicle = get_mission_vehicle(request.payload)
    require_vehicle_endpoint(vehicle)
    upload_result = send_mission_upload(vehicle, request.payload)
    return {
        "ok": bool(upload_result.get("ok")),
        "vehicle_id": vehicle.vehicle_id,
        "validation": validation,
        "upload": upload_result,
    }


@app.post("/api/missions/download")
def download_mission(request: MissionPayloadRequest):
    if not isinstance(request.payload, dict) or not request.payload.get("vehicle_id"):
        raise HTTPException(
            status_code=400,
            detail={
                "ok": False,
                "reason": "vehicle_id_required",
            },
        )

    vehicle = get_mission_vehicle(request.payload)
    require_vehicle_endpoint(vehicle)
    download_result = send_mission_download(vehicle, request.payload)
    return {
        "ok": bool(download_result.get("ok")),
        "vehicle_id": vehicle.vehicle_id,
        "download": download_result,
    }


@app.post("/api/missions/upload-and-verify")
def upload_and_verify_mission(request: MissionPayloadRequest):
    validation = validate_mission_upload_payload(request.payload)
    if not validation["ok"]:
        raise HTTPException(
            status_code=400,
            detail={
                **validation,
                "reason": "mission_validation_failed",
            },
        )

    vehicle = get_mission_vehicle(request.payload)
    require_vehicle_endpoint(vehicle)
    upload_result = send_mission_upload(vehicle, request.payload)
    if not upload_result.get("ok"):
        return {
            "ok": False,
            "vehicle_id": vehicle.vehicle_id,
            "validation": validation,
            "upload": upload_result,
            "download": None,
            "verification": {
                "verified": False,
                "errors": ["upload_failed"],
                "warnings": [],
            },
        }

    download_result = send_mission_download(vehicle, request.payload)
    verification = compare_mission_items(
        request.payload,
        download_result.get("items") or [],
    )
    return {
        "ok": bool(upload_result.get("ok")) and bool(download_result.get("ok")) and verification["verified"],
        "vehicle_id": vehicle.vehicle_id,
        "validation": validation,
        "upload": upload_result,
        "download": download_result,
        "verification": verification,
    }


@app.get("/")
def editor_index():
    return FileResponse(INDEX_HTML)


app.mount("/src", StaticFiles(directory=SRC_DIR), name="src")
