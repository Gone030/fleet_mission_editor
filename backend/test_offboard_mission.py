"""Mode/height transport contracts, all network calls mocked."""
import types
import unittest
from unittest.mock import patch
from backend import server


class OffboardMissionTransportTest(unittest.TestCase):
    def setUp(self):
        self.vehicle = types.SimpleNamespace(vehicle_id="child_01")
        self.payload = dict(vehicle_id="child_01", mission_id="test", role="child", execution_mode="OFFBOARD",
                            altitude_reference="TRIGGER", items=[dict(seq=0, command=21, frame=3,
                                                                      x=36.4535769, y=127.4051803, z=0., param4=None)])

    def test_normalization_keeps_mode_coordinates_and_relative_height(self):
        normalized = server.normalize_mission_payload_for_companion(self.payload)
        self.assertEqual(normalized["execution_mode"], "OFFBOARD")
        self.assertEqual(normalized["items"][0]["x"], 36.4535769)
        self.assertEqual(normalized["items"][0]["z"], 0.)
        self.assertIsNone(normalized["items"][0]["param4"])

    def test_legacy_auto_is_the_default(self):
        self.payload.pop("execution_mode")
        self.assertEqual(server.normalize_mission_payload_for_companion(self.payload)["execution_mode"], "AUTO_MISSION")

    def test_invalid_and_carrier_modes_are_rejected(self):
        for update in ({"execution_mode": "INVALID"}, {"role": "carrier"}):
            payload = dict(self.payload, **update)
            self.assertFalse(server.validate_mission_upload_payload(payload)["ok"])
            with self.assertRaises(ValueError):
                server.normalize_mission_payload_for_companion(payload)

    def test_upload_and_readback_select_the_same_storage(self):
        def exchange(vehicle, message, expected_type):
            self.assertEqual(message["execution_mode"], "OFFBOARD")
            self.assertEqual(vehicle.vehicle_id, "child_01")
            return dict(ok=True, items=self.payload["items"], count=1, uploaded_count=1)
        with patch.object(server, "send_companion_mission_message", side_effect=exchange):
            uploaded = server.send_mission_upload(self.vehicle, self.payload)
            downloaded = server.send_mission_download(self.vehicle, self.payload)
        self.assertTrue(uploaded["ok"] and downloaded["ok"])
        self.assertEqual(downloaded["items"], self.payload["items"])

    def test_clear_passes_mode_and_status_passes_control_health(self):
        request = server.MissionClearRequest(vehicle_id="child_01", execution_mode="OFFBOARD")
        with patch.object(server, "get_command_vehicle_or_raise", return_value=self.vehicle), \
             patch.object(server, "send_companion_command", return_value={}) as send:
            server.mission_clear(request)
        self.assertEqual(send.call_args.args[1]["execution_mode"], "OFFBOARD")
        vehicle = types.SimpleNamespace(vehicle_id="child_01", name="Child", role="child", ip="test",
                                        udp_port=50051, firmware_profile="custom")
        health = dict(offboard_mission=dict(mode="OFFBOARD", phase="RUNNING", control=dict(yaw_usable=True)))
        self.assertEqual(server.make_status_result(vehicle, "CONNECTED", "test", health=health)["offboard_mission"],
                         health["offboard_mission"])

    def test_mode_only_apply_is_child_only_and_has_no_mission_or_flight_command(self):
        vehicle = types.SimpleNamespace(vehicle_id="child_01", role="child")
        request = server.MissionModeRequest(vehicle_id="child_01", execution_mode="OFFBOARD")
        with patch.object(server, "get_command_vehicle_or_raise", return_value=vehicle), \
             patch.object(server, "send_companion_command", return_value={}) as send:
            server.mission_mode(request)
            self.assertEqual(send.call_args.args[1]["type"], "MISSION_MODE_SET")
            self.assertEqual(send.call_args.args[1]["execution_mode"], "OFFBOARD")
            vehicle.role = "carrier"
            with self.assertRaises(server.HTTPException):
                server.mission_mode(request)


if __name__ == "__main__":
    unittest.main()
