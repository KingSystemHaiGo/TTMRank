import unittest
from pathlib import Path


class WorkflowTests(unittest.TestCase):
    WORKFLOWS = Path(__file__).parents[1] / ".github" / "workflows"

    def test_queued_refresh_checks_out_latest_default_branch(self):
        workflow = (self.WORKFLOWS / "refresh.yml").read_text(encoding="utf-8")

        self.assertIn("ref: ${{ github.event.repository.default_branch }}", workflow)

    def test_twenty_minute_schedule_uses_three_independent_dispatchers(self):
        refresh = (self.WORKFLOWS / "refresh.yml").read_text(encoding="utf-8")
        self.assertNotIn("schedule:", refresh)

        schedules = {
            "schedule-refresh-07.yml": "7 * * * *",
            "schedule-refresh-27.yml": "27 * * * *",
            "schedule-refresh-47.yml": "47 * * * *",
        }
        for filename, cron in schedules.items():
            workflow = (self.WORKFLOWS / filename).read_text(encoding="utf-8")
            self.assertIn(f"cron: '{cron}'", workflow)
            self.assertIn("actions: write", workflow)
            self.assertIn("gh workflow run refresh.yml", workflow)

    def test_changed_refresh_explicitly_dispatches_pages_deploy(self):
        refresh = (self.WORKFLOWS / "refresh.yml").read_text(encoding="utf-8")
        deploy = (self.WORKFLOWS / "deploy.yml").read_text(encoding="utf-8")

        self.assertIn("actions: write", refresh)
        self.assertIn("id: commit", refresh)
        self.assertIn("changed=true", refresh)
        self.assertIn("gh workflow run deploy.yml", refresh)
        self.assertNotIn("workflow_run:", deploy)


if __name__ == "__main__":
    unittest.main()
