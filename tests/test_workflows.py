import unittest
from pathlib import Path


class WorkflowTests(unittest.TestCase):
    def test_queued_refresh_checks_out_latest_default_branch(self):
        workflow = (Path(__file__).parents[1] / ".github" / "workflows" / "refresh.yml").read_text(encoding="utf-8")

        self.assertIn("ref: ${{ github.event.repository.default_branch }}", workflow)


if __name__ == "__main__":
    unittest.main()
