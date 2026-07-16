import json
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


class WorkflowTests(unittest.TestCase):
    WORKFLOWS = Path(__file__).parents[1] / ".github" / "workflows"

    def run_history_validator(self, payload):
        workflow = (self.WORKFLOWS / "history-maintenance.yml").read_text(encoding="utf-8")
        source = workflow.split("python - <<'PY'\n", 1)[1].split("\n          PY", 1)[0]
        source = textwrap.dedent(source)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            response = root / "response.json"
            error = root / "curl-error.txt"
            control = root / "control.txt"
            summary = root / "summary.md"
            response.write_text(json.dumps(payload), encoding="utf-8")
            error.write_text("", encoding="utf-8")
            environment = {
                **os.environ,
                "RESPONSE_FILE": str(response),
                "ERROR_FILE": str(error),
                "CONTROL_FILE": str(control),
                "HTTP_STATUS": "200",
                "CURL_STATUS": "0",
                "ATTEMPT": "1",
                "EXPECTED_RUN_ID": "42-1-1",
                "GITHUB_STEP_SUMMARY": str(summary),
            }
            result = subprocess.run(
                [sys.executable, "-c", source],
                env=environment,
                capture_output=True,
                text=True,
                check=False,
            )
            return result, summary.read_text(encoding="utf-8")

    def test_queued_refresh_checks_out_latest_default_branch(self):
        workflow = (self.WORKFLOWS / "refresh.yml").read_text(encoding="utf-8")

        self.assertIn("ref: ${{ github.event.repository.default_branch }}", workflow)
        self.assertIn("fetch-depth: 2", workflow)
        self.assertNotIn("fetch-depth: 0", workflow)

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

    def test_refresh_deploys_generated_pages_artifact_without_git_writes(self):
        refresh = (self.WORKFLOWS / "refresh.yml").read_text(encoding="utf-8")

        self.assertIn("actions: write", refresh)
        self.assertIn("contents: read", refresh)
        self.assertIn("pages: write", refresh)
        self.assertIn("id-token: write", refresh)
        self.assertIn("actions/configure-pages@v5", refresh)
        self.assertIn("actions/upload-pages-artifact@v3", refresh)
        self.assertIn("actions/deploy-pages@v4", refresh)
        self.assertIn("path: app/", refresh)
        self.assertIn("actions/setup-node@v4", refresh)
        self.assertIn("npm ci", refresh)
        self.assertIn("npm run test:unit", refresh)
        self.assertIn("npx playwright install --with-deps chromium", refresh)
        self.assertIn("npm run test:e2e", refresh)
        self.assertIn("history_ingest", refresh)
        self.assertLess(refresh.index("npm run test:e2e"), refresh.index("actions/upload-pages-artifact@v3"))
        self.assertLess(refresh.index("python app/fetcher.py"), refresh.index("actions/upload-pages-artifact@v3"))
        self.assertNotIn("contents: write", refresh)
        self.assertNotIn("git add", refresh)
        self.assertNotIn("git commit", refresh)
        self.assertNotIn("git push", refresh)
        self.assertNotIn("gh workflow run deploy.yml", refresh)

    def test_code_push_deploy_builds_and_tests_a_fresh_snapshot(self):
        deploy = (self.WORKFLOWS / "deploy.yml").read_text(encoding="utf-8")

        self.assertIn("python app/fetcher.py", deploy)
        self.assertIn("actions/setup-python@v5", deploy)
        self.assertIn("actions/setup-node@v4", deploy)
        self.assertIn("npm ci", deploy)
        self.assertIn("npm run test:unit", deploy)
        self.assertIn("npx playwright install --with-deps chromium", deploy)
        self.assertIn("npm run test:e2e", deploy)
        self.assertIn("actions/upload-pages-artifact@v3", deploy)
        self.assertIn("actions/deploy-pages@v4", deploy)
        self.assertIn("path: app/", deploy)
        self.assertIn("history_ingest", deploy)
        self.assertLess(deploy.index("python app/fetcher.py"), deploy.index("actions/upload-pages-artifact@v3"))
        self.assertLess(deploy.index("npm run test:e2e"), deploy.index("actions/upload-pages-artifact@v3"))

    def test_refresh_self_dispatches_on_a_twenty_minute_cycle(self):
        refresh = (self.WORKFLOWS / "refresh.yml").read_text(encoding="utf-8")

        collect = refresh.split("  collect:\n", 1)[1].split("  deploy:\n", 1)[0]
        self.assertIn("timeout-minutes: 30", collect)
        self.assertIn("cycle_seconds:", refresh)
        self.assertIn("default: '1200'", refresh)
        self.assertIn("started_at=", refresh)
        self.assertIn("cycle_started_at + cycle_seconds", refresh)
        self.assertIn("sleep \"$delay\"", refresh)
        self.assertGreaterEqual(refresh.count("gh workflow run refresh.yml"), 1)

    def test_pages_deployments_are_bounded_and_refresh_artifacts_are_checked_for_freshness(self):
        refresh = (self.WORKFLOWS / "refresh.yml").read_text(encoding="utf-8")
        deploy = (self.WORKFLOWS / "deploy.yml").read_text(encoding="utf-8")

        collect = refresh.split("  collect:\n", 1)[1].split("  deploy:\n", 1)[0]
        refresh_deploy = refresh.split("  deploy:\n", 1)[1].split("  continue:\n", 1)[0]
        code_build = deploy.split("  build:\n", 1)[1].split("  deploy:\n", 1)[0]
        code_deploy = deploy.split("  deploy:\n", 1)[1]

        self.assertIn("source_sha: ${{ steps.source.outputs.sha }}", collect)
        self.assertIn("id: source", collect)
        self.assertIn("git rev-parse HEAD", collect)
        self.assertIn("timeout-minutes: 10", refresh_deploy)
        self.assertIn("actions/checkout@v4", refresh_deploy)
        self.assertIn("EXPECTED_SHA: ${{ needs.collect.outputs.source_sha }}", refresh_deploy)
        self.assertIn("actual_sha=$(git rev-parse HEAD)", refresh_deploy)
        self.assertIn("if: steps.fresh.outputs.current == 'true'", refresh_deploy)
        self.assertIn("cancel-in-progress: false", refresh_deploy)

        self.assertIn("group: pages", deploy)
        self.assertIn("cancel-in-progress: true", deploy)
        self.assertIn("source_sha: ${{ steps.source.outputs.sha }}", code_build)
        self.assertIn("EXPECTED_SHA: ${{ needs.build.outputs.source_sha }}", code_deploy)
        self.assertIn("if: steps.fresh.outputs.current == 'true'", code_deploy)
        self.assertIn("timeout-minutes: 30", code_build)
        self.assertIn("timeout-minutes: 10", code_deploy)

    def test_history_maintenance_timeout_can_finish_the_bounded_loop(self):
        workflow = (self.WORKFLOWS / "history-maintenance.yml").read_text(encoding="utf-8")

        self.assertIn("timeout-minutes: 90", workflow)
        self.assertIn("MAX_CALLS=100", workflow)
        self.assertIn("--max-time 45", workflow)

    def test_cron_dispatchers_only_restart_an_idle_refresh_chain(self):
        for filename in (
            "schedule-refresh-07.yml",
            "schedule-refresh-27.yml",
            "schedule-refresh-47.yml",
        ):
            workflow = (self.WORKFLOWS / filename).read_text(encoding="utf-8")
            self.assertIn("gh run list", workflow)
            self.assertIn('gh run list --repo "$GITHUB_REPOSITORY"', workflow)
            self.assertIn("status == \"queued\" or .status == \"in_progress\"", workflow)
            self.assertIn('if [ "$active_runs" -eq 0 ]', workflow)

    def test_history_maintenance_has_bounded_diagnosable_continuation(self):
        workflow = (self.WORKFLOWS / "history-maintenance.yml").read_text(encoding="utf-8")

        self.assertIn("cron: '17 3 * * *'", workflow)
        self.assertIn("TTMRANK_MAINTENANCE_TOKEN", workflow)
        self.assertIn("/v1/maintenance", workflow)
        self.assertIn("X-Maintenance-Run", workflow)
        self.assertIn("MAX_CALLS=100", workflow)
        self.assertIn('seq 1 "$MAX_CALLS"', workflow)
        self.assertIn('${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}-${attempt}', workflow)
        self.assertIn('--output "$response_file"', workflow)
        self.assertIn("--write-out '%{http_code}'", workflow)
        self.assertIn("--max-filesize 1048576", workflow)
        self.assertIn("json.loads", workflow)
        self.assertIn("processed_day", workflow)
        self.assertIn("has_more", workflow)
        self.assertIn("GITHUB_STEP_SUMMARY", workflow)
        self.assertIn("Raw response", workflow)
        self.assertIn("contents: read", workflow)
        self.assertNotIn("contents: write", workflow)
        self.assertNotIn("git commit", workflow)
        self.assertNotIn("git push", workflow)
        self.assertNotIn("--fail-with-body", workflow)

    def test_history_maintenance_skips_when_optional_d1_is_not_configured(self):
        workflow = (self.WORKFLOWS / "history-maintenance.yml").read_text(encoding="utf-8")

        missing_config = workflow.index('if [ -z "$HISTORY_URL" ] || [ -z "$MAINTENANCE_TOKEN" ]')
        endpoint = workflow.index('endpoint="${HISTORY_URL%/}/v1/maintenance"')
        branch = workflow[missing_config:endpoint]
        self.assertIn("not configured / skipped", branch)
        self.assertIn("GITHUB_STEP_SUMMARY", branch)
        self.assertIn("exit 0", branch)
        self.assertNotIn("exit 1", branch)

    def test_history_maintenance_validates_nested_response_fields_strictly(self):
        workflow = (self.WORKFLOWS / "history-maintenance.yml").read_text(encoding="utf-8")

        self.assertIn("def non_negative_integer", workflow)
        self.assertIn("type(value) is int and value >= 0", workflow)
        self.assertIn('("hourly_days", "daily_days")', workflow)
        self.assertIn('("hourly", "daily")', workflow)
        self.assertIn('("hourly_archived", "hourly_deleted", "daily_deleted")', workflow)
        self.assertIn('retention["daily_days"] <= retention["hourly_days"]', workflow)

        valid = {
            "ok": True,
            "run_id": "42-1-1",
            "processed_day": None,
            "has_more": False,
            "retention": {"hourly_days": 90, "daily_days": 730},
            "cutoffs": {"hourly": 1_800_000_000, "daily": 1_700_000_000},
            "rows": {"hourly_archived": 0, "hourly_deleted": 2, "daily_deleted": 0},
        }
        result, summary = self.run_history_validator(valid)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Result: completed", summary)

        invalid_payloads = {
            "empty nested objects": {**valid, "retention": {}, "cutoffs": {}, "rows": {}},
            "booleans disguised as integers": {
                **valid,
                "retention": {"hourly_days": True, "daily_days": 730},
            },
            "negative row count": {
                **valid,
                "rows": {"hourly_archived": -1, "hourly_deleted": 2, "daily_deleted": 0},
            },
            "non-positive cutoff": {**valid, "cutoffs": {"hourly": 0, "daily": 1_700_000_000}},
            "daily retention not longer": {
                **valid,
                "retention": {"hourly_days": 90, "daily_days": 90},
            },
        }
        for label, payload in invalid_payloads.items():
            with self.subTest(label=label):
                result, summary = self.run_history_validator(payload)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("Result: failed", summary)


if __name__ == "__main__":
    unittest.main()
