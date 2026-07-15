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

    def test_refresh_self_dispatches_on_a_twenty_minute_cycle(self):
        refresh = (self.WORKFLOWS / "refresh.yml").read_text(encoding="utf-8")

        self.assertIn("timeout-minutes: 30", refresh)
        self.assertIn("cycle_seconds:", refresh)
        self.assertIn("default: '1200'", refresh)
        self.assertIn("started_at=", refresh)
        self.assertIn("cycle_started_at + cycle_seconds", refresh)
        self.assertIn("sleep \"$delay\"", refresh)
        self.assertGreaterEqual(refresh.count("gh workflow run refresh.yml"), 1)

    def test_cron_dispatchers_only_restart_an_idle_refresh_chain(self):
        for filename in (
            "schedule-refresh-07.yml",
            "schedule-refresh-27.yml",
            "schedule-refresh-47.yml",
        ):
            workflow = (self.WORKFLOWS / filename).read_text(encoding="utf-8")
            self.assertIn("gh run list", workflow)
            self.assertIn("status == \"queued\" or .status == \"in_progress\"", workflow)
            self.assertIn('if [ "$active_runs" -eq 0 ]', workflow)


if __name__ == "__main__":
    unittest.main()
