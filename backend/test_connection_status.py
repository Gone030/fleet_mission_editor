"""UI status age metadata only; no real UDP/vehicle commands."""
import unittest
from unittest.mock import patch
from backend import server


class ConnectionStatusTest(unittest.TestCase):
    def test_serving_cache_does_not_refresh_contact_or_mutate_cached_time(self):
        cached = dict(ok=True, timestamp_ms=1000,
                      results={"child_01": dict(timestamp_ms=900, companion_state="CONNECTED")})
        with patch.object(server, "last_drone_status", cached), patch.object(server, "now_ms", return_value=10000):
            result = server.drones_status()
        self.assertEqual(result["served_at_ms"], 10000)
        self.assertEqual(result["timestamp_ms"], 1000)
        self.assertEqual(result["results"]["child_01"]["timestamp_ms"], 900)
        self.assertNotIn("served_at_ms", cached)

    def test_connect_exposes_server_clock_without_changing_per_vehicle_reports(self):
        vehicle = server.DroneConnectionRequestVehicle(vehicle_id="child_01", name="Child", role="child",
                                                       ip="127.0.0.1", udp_port=50051, firmware_profile="custom")
        request = server.DroneConnectionRequest(vehicles=[vehicle])
        report = dict(vehicle_id="child_01", timestamp_ms=1000, companion_state="CONNECTED")
        with patch.object(server, "last_drone_status", {}), patch.dict(server.known_drone_configs, {}, clear=True), \
             patch.object(server, "now_ms", return_value=2000), \
             patch.object(server, "refresh_vehicle_status", return_value=report):
            result = server.connect_drones(request)
        self.assertEqual(result["served_at_ms"], 2000)
        self.assertEqual(result["results"]["child_01"]["timestamp_ms"], 1000)


if __name__ == "__main__":
    unittest.main()
