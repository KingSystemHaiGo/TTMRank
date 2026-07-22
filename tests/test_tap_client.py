import json
import unittest
from io import BytesIO
from unittest.mock import patch
from urllib.error import URLError
from urllib.parse import parse_qs, unquote, urlparse

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
        payload = {"success": True, "data": {"title": "热卖榜", "total": 0, "list": [], "next_page": ""}}
        client = TapTapClient(retries=1, sleep=lambda _delay: None)
        with patch("ttmrank.tap_client.urlopen", return_value=FakeResponse(payload)):
            result = client.fetch_ranking("ios", "sell")
        self.assertTrue(result.ok)
        self.assertEqual(result.data["items"], [])
        self.assertTrue(result.data["complete"])

    def test_ios_ranking_uses_an_ios_device_header(self):
        payload = {"success": True, "data": {"title": "热门榜", "total": 0, "list": [], "next_page": ""}}
        client = TapTapClient(retries=1, sleep=lambda _delay: None)
        requests = []

        def respond(request, timeout):
            requests.append(request)
            return FakeResponse(payload)

        with patch("ttmrank.tap_client.urlopen", side_effect=respond):
            result = client.fetch_ranking("ios", "hot")

        self.assertTrue(result.ok)
        query = parse_qs(urlparse(requests[0].full_url).query)
        self.assertIn("DS=iOS", unquote(query["X-UA"][0]))
        self.assertNotIn("DS=Android", unquote(query["X-UA"][0]))

    def test_short_page_follows_next_page_and_preserves_source_rank(self):
        first = {
            "success": True,
            "data": {
                "title": "热门榜",
                "total": 2,
                "list": [{"app": {"id": 1, "title": "A"}}],
                "next_page": "/webapiv2/app-top/v2/hits?from=15&limit=15&platform=ios&type_name=hot",
            },
        }
        second = {
            "success": True,
            "data": {
                "total": 2,
                "list": [{"app": {"id": 2, "title": "B"}}],
                "next_page": "",
            },
        }
        client = TapTapClient(retries=1, page_size=15, sleep=lambda _delay: None)
        with patch("ttmrank.tap_client.urlopen", side_effect=[FakeResponse(first), FakeResponse(second)]):
            result = client.fetch_ranking("ios", "hot")

        self.assertTrue(result.ok)
        self.assertEqual([row["app"]["id"] for row in result.data["items"]], [1, 2])
        self.assertEqual([row["_source_rank"] for row in result.data["items"]], [1, 16])
        self.assertEqual(result.data["total"], 2)
        self.assertTrue(result.data["complete"])

    def test_incomplete_total_is_a_failed_collection(self):
        payload = {
            "success": True,
            "data": {
                "title": "热门榜",
                "total": 2,
                "list": [{"app": {"id": 1, "title": "A"}}],
                "next_page": "",
            },
        }
        client = TapTapClient(retries=1, sleep=lambda _delay: None)
        with patch("ttmrank.tap_client.urlopen", return_value=FakeResponse(payload)):
            result = client.fetch_ranking("ios", "hot")

        self.assertFalse(result.ok)
        self.assertIn("expected 2 unique games, collected 1", result.error)

    def test_duplicate_pages_are_not_reported_as_complete(self):
        item = {"app": {"id": 1, "title": "A", "stat": {"rating": {"score": "8.0"}}}}
        first = {
            "success": True,
            "data": {
                "title": "热门榜",
                "total": 2,
                "list": [item],
                "next_page": "/webapiv2/app-top/v2/hits?from=1&limit=1&platform=android&type_name=hot",
            },
        }
        second = {"success": True, "data": {"total": 2, "list": [item], "next_page": ""}}
        client = TapTapClient(retries=1, page_size=1, max_pages=3, sleep=lambda _delay: None)
        with patch("ttmrank.tap_client.urlopen", side_effect=[FakeResponse(first), FakeResponse(second)]):
            result = client.fetch_ranking("android", "hot")
        self.assertFalse(result.ok)
        self.assertIn("expected 2 unique games, collected 1", result.error)


if __name__ == "__main__":
    unittest.main()
