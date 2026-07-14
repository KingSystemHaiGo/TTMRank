import json
import unittest
from io import BytesIO
from unittest.mock import patch
from urllib.error import URLError

from ttmrank.tap_client import TapTapClient


class FakeResponse:
    def __init__(self, payload):
        self._body = json.dumps(payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return self._body


class TapTapClientTests(unittest.TestCase):
    def test_network_failure_is_not_reported_as_empty_success(self):
        client = TapTapClient(retries=2, sleep=lambda _delay: None)
        with patch("ttmrank.tap_client.urlopen", side_effect=URLError("offline")):
            result = client.fetch_ranking("android", "hot")
        self.assertFalse(result.ok)
        self.assertIn("offline", result.error)
        self.assertIsNone(result.data)
        self.assertEqual(result.attempts, 2)

    def test_legitimate_empty_chart_is_success(self):
        payload = {"success": True, "data": {"title": "热卖榜", "list": []}}
        client = TapTapClient(retries=1, sleep=lambda _delay: None)
        with patch("ttmrank.tap_client.urlopen", return_value=FakeResponse(payload)):
            result = client.fetch_ranking("ios", "sell")
        self.assertTrue(result.ok)
        self.assertEqual(result.data["items"], [])

    def test_duplicate_pages_stop_without_duplicate_items(self):
        item = {"app": {"id": 1, "title": "A", "stat": {"rating": {"score": "8.0"}}}}
        payload = {"success": True, "data": {"title": "热门榜", "list": [item]}}
        client = TapTapClient(retries=1, page_size=1, max_pages=3, sleep=lambda _delay: None)
        with patch("ttmrank.tap_client.urlopen", side_effect=[FakeResponse(payload), FakeResponse(payload)]):
            result = client.fetch_ranking("android", "hot")
        self.assertTrue(result.ok)
        self.assertEqual(len(result.data["items"]), 1)


if __name__ == "__main__":
    unittest.main()
