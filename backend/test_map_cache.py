"""Run: python -m unittest backend.test_map_cache (no real network/vehicle calls)."""
import json
import asyncio
import tempfile
import time
import threading
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from backend import server

PNG = b"\x89PNG\r\n\x1a\n" + b"test tile"


class MapCacheTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.cache_patch = patch.object(server, "MAP_CACHE_DIR", Path(self.directory.name))
        self.cache_patch.start()

    def tearDown(self):
        self.cache_patch.stop()
        self.directory.cleanup()

    def seed(self, expires_at):
        path = server.MAP_CACHE_DIR / "2" / "1" / "1.png"
        server._write_map_cache(path, PNG)
        server._write_map_cache(path.with_suffix(".json"),
                                json.dumps({"expires_at": expires_at}).encode())

    def test_fresh_cache_never_uses_network(self):
        self.seed(time.time() + 3600)
        with patch.object(server, "urlopen") as network:
            self.assertEqual(server.get_cached_map_tile(2, 1, 1), (PNG, "hit"))
            network.assert_not_called()

    def test_expired_cache_survives_network_loss(self):
        self.seed(0)
        with patch.object(server, "urlopen", side_effect=OSError("offline")):
            self.assertEqual(server.get_cached_map_tile(2, 1, 1), (PNG, "offline-hit"))

    def test_uncached_offline_tile_is_unavailable(self):
        with patch.object(server, "urlopen", side_effect=OSError("offline")):
            with self.assertRaises(HTTPException) as error:
                server.get_cached_map_tile(2, 1, 1)
            self.assertEqual(error.exception.status_code, 503)
            self.assertEqual(error.exception.headers["Cache-Control"], "no-store")

    def test_uncached_failure_is_not_retained_after_network_recovers(self):
        with patch.object(server, "urlopen", side_effect=OSError("offline")):
            with self.assertRaises(HTTPException):
                server.get_cached_map_tile(2, 1, 1)
        response = MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = PNG
        response.headers = {"Cache-Control": "max-age=3600"}
        with patch.object(server, "urlopen", return_value=response) as network:
            self.assertEqual(server.get_cached_map_tile(2, 1, 1), (PNG, "download"))
            self.assertEqual(server.get_cached_map_tile(2, 1, 1), (PNG, "hit"))
            self.assertEqual(network.call_count, 1)

    def test_download_is_persistent(self):
        response = MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = PNG
        response.headers = {"Cache-Control": "max-age=3600"}
        with patch.object(server, "urlopen", return_value=response) as network:
            self.assertEqual(server.get_cached_map_tile(2, 1, 1), (PNG, "download"))
            self.assertEqual(server.get_cached_map_tile(2, 1, 1), (PNG, "hit"))
            self.assertEqual(network.call_count, 1)
            self.assertTrue((server.MAP_CACHE_DIR / "2/1/1.png").exists())

    def test_bad_download_does_not_replace_cached_tile(self):
        self.seed(0)
        response = MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = b"error page"
        with patch.object(server, "urlopen", return_value=response):
            self.assertEqual(server.get_cached_map_tile(2, 1, 1), (PNG, "offline-hit"))

    def test_invalid_coordinates_never_use_network(self):
        with patch.object(server, "urlopen") as network:
            for coordinates in [(20, 0, 0), (2, -1, 1), (2, 4, 1)]:
                with self.assertRaises(HTTPException):
                    server.get_cached_map_tile(*coordinates)
            network.assert_not_called()

    def test_async_tile_response(self):
        self.seed(time.time() + 3600)
        with patch.object(server, "urlopen") as network:
            response = asyncio.run(server.map_tile(2, 1, 1))
            self.assertEqual(response.body, PNG)
            self.assertEqual(response.headers["x-map-cache"], "hit")
            self.assertEqual(response.media_type, "image/png")
            network.assert_not_called()

    def test_expiry_and_no_store(self):
        self.assertEqual(server._map_tile_expiry({"Cache-Control": "max-age=60", "Age": "10"}, 100), 150)
        self.assertEqual(server._map_tile_expiry({}, 100), 100 + 604800)
        response = MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = PNG
        response.headers = {"Cache-Control": "no-store"}
        with patch.object(server, "urlopen", return_value=response):
            server.get_cached_map_tile(2, 1, 1)
            self.assertFalse((server.MAP_CACHE_DIR / "2/1/1.png").exists())


class MapRequestIsolationTest(unittest.IsolatedAsyncioTestCase):
    async def test_busy_tiles_fail_fast_without_a_download_queue(self):
        release = threading.Event()
        calls = []

        def blocked_download(*coordinates):
            calls.append(coordinates)
            release.wait(2)
            return PNG, "test"

        with patch.object(server, "_map_request_slots", threading.BoundedSemaphore(2)), \
             patch.object(server, "get_cached_map_tile", side_effect=blocked_download):
            first = asyncio.create_task(server.map_tile(2, 0, 0))
            second = asyncio.create_task(server.map_tile(2, 1, 0))
            await asyncio.sleep(.02)
            try:
                for x in (2, 3):
                    with self.assertRaises(HTTPException) as error:
                        await asyncio.wait_for(server.map_tile(2, x, 0), .2)
                    self.assertEqual(error.exception.status_code, 503)
                    self.assertEqual(error.exception.headers["Cache-Control"], "no-store")
                self.assertTrue(server.health()["ok"])
                self.assertEqual(len(calls), 2)
            finally:
                release.set()
                await asyncio.gather(first, second)
            self.assertEqual((await server.map_tile(2, 2, 0)).body, PNG)

    async def test_response_timeout_does_not_release_a_still_busy_worker(self):
        release = threading.Event()
        done = threading.Event()
        slots = threading.BoundedSemaphore(1)

        def blocked_download(*_):
            release.wait(2)
            done.set()
            return PNG, "test"

        with patch.object(server, "_map_request_slots", slots), \
             patch.object(server, "MAP_RESPONSE_TIMEOUT_SEC", .03), \
             patch.object(server, "get_cached_map_tile", side_effect=blocked_download):
            try:
                with self.assertRaises(HTTPException) as error:
                    await server.map_tile(2, 0, 0)
                self.assertEqual(error.exception.status_code, 503)
                self.assertEqual(error.exception.detail, "Map response timed out")
                with self.assertRaises(HTTPException) as busy:
                    await server.map_tile(2, 1, 0)
                self.assertEqual(busy.exception.detail, "Map requests busy")
            finally:
                release.set()
                await asyncio.to_thread(done.wait, 1)
                # Wait for the completion callback, without allowing extra work.
                for _ in range(100):
                    if slots.acquire(blocking=False):
                        slots.release()
                        break
                    await asyncio.sleep(.001)
                else:
                    self.fail("Finished worker did not release admission slot")


if __name__ == "__main__":
    unittest.main()
