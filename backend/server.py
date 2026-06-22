import json
import socket
import time
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = PROJECT_ROOT / "src"
INDEX_HTML = PROJECT_ROOT / "index.html"

app = FastAPI(title="Fleet Runtime Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

last_drone_status = {
    "ok": True,
    "results": {},
    "timestamp_ms": None,
}


class DroneConnectionRequestVehicle(BaseModel):
    vehicle_id: str
    name: str
    role: str
    ip: str
    udp_port: int = Field(ge=1, le=65535)
    firmware_profile: str


class DroneConnectionRequest(BaseModel):
    vehicles: list[DroneConnectionRequestVehicle]


def now_ms():
    return int(time.time() * 1000)


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
        "trigger_state": health.get("trigger_state") or "UNKNOWN",
        "last_trigger_seq": health.get("last_trigger_seq"),
        "last_trigger_state": health.get("last_trigger_state") or "UNKNOWN",
        "last_trigger_reason": health.get("last_trigger_reason"),
        "last_trigger_relationship_id": health.get("last_trigger_relationship_id"),
        "last_trigger_completed_ms": health.get("last_trigger_completed_ms"),
        "rc_trigger_channel": health.get("rc_trigger_channel"),
        "rc_trigger_threshold": health.get("rc_trigger_threshold"),
        "rc_trigger_active": health.get("rc_trigger_active"),
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


@app.post("/api/drones/connect")
def connect_drones(request: DroneConnectionRequest):
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


@app.get("/")
def editor_index():
    return FileResponse(INDEX_HTML)


app.mount("/src", StaticFiles(directory=SRC_DIR), name="src")
