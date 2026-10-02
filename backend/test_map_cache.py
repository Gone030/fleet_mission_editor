"""Run: python -m unittest backend.test_map_cache (no real network/vehicle calls)."""
import json
import asyncio
import tempfile
import time
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


if __name__ == "__main__":
    unittest.main()
