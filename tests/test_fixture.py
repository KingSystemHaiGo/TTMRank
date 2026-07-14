import json
import unittest
from pathlib import Path


class FixtureTests(unittest.TestCase):
    def test_small_fixture_has_two_platforms_and_three_chart_types(self):
        path = Path(__file__).parent / "fixtures" / "rankings-small.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(set(data["platforms"]), {"android", "ios"})
        charts = {chart for platform in data["platforms"].values() for chart in platform}
        self.assertEqual(charts, {"hot", "new", "casual"})


if __name__ == "__main__":
    unittest.main()
