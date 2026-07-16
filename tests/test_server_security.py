import os
import http.client
import threading
import unittest
from unittest.mock import patch
from http.server import ThreadingHTTPServer
from subprocess import CompletedProcess

from app import server


class ServerSecurityTests(unittest.TestCase):
    def test_shared_fetcher_runner_does_not_start_while_refresh_is_busy(self):
        with patch.object(server.subprocess, "run") as run:
            self.assertTrue(server.REFRESH_LOCK.acquire(blocking=False))
            try:
                self.assertIsNone(server.run_fetcher())
            finally:
                server.REFRESH_LOCK.release()
        run.assert_not_called()

    def test_default_bind_is_loopback_and_public_mode_disables_mutations(self):
        with patch.dict(os.environ, {}, clear=True):
            config = server.load_security_config()
        self.assertEqual(config.bind_host, "127.0.0.1")
        self.assertFalse(config.public_mode)
        self.assertTrue(config.allow_refresh)

        with patch.dict(os.environ, {"TTMRANK_PUBLIC": "1"}, clear=True):
            public = server.load_security_config()
        self.assertEqual(public.bind_host, "0.0.0.0")
        self.assertFalse(public.allow_refresh)

    def test_cors_only_echoes_configured_origin(self):
        with patch.dict(os.environ, {"TTMRANK_ALLOWED_ORIGINS": "https://example.com"}, clear=True):
            config = server.load_security_config()
        self.assertEqual(config.cors_origin("https://example.com"), "https://example.com")
        self.assertIsNone(config.cors_origin("https://evil.example"))

    def test_refresh_requires_same_origin_marked_post(self):
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        origin = f"http://127.0.0.1:{httpd.server_port}"

        def request(method, request_origin=None, marked=False):
            connection = http.client.HTTPConnection("127.0.0.1", httpd.server_port, timeout=5)
            headers = {}
            if request_origin:
                headers["Origin"] = request_origin
            if marked:
                headers["X-TTMRank-Request"] = "refresh"
            connection.request(method, "/refresh", headers=headers)
            response = connection.getresponse()
            response.read()
            connection.close()
            return response.status

        try:
            with patch.dict(os.environ, {"TTMRANK_ALLOWED_ORIGINS": origin}, clear=True), patch.object(
                server.subprocess,
                "run",
                return_value=CompletedProcess([], 0, stdout="ok", stderr=""),
            ) as run:
                self.assertEqual(request("GET", origin, True), 405)
                self.assertEqual(request("POST", "https://evil.example", True), 403)
                self.assertEqual(request("POST", origin, False), 403)
                self.assertEqual(request("POST", origin, True), 200)
                self.assertEqual(run.call_count, 1)
        finally:
            httpd.shutdown()
            httpd.server_close()
            thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
