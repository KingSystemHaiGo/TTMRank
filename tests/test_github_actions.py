import os
import shutil
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
BASH = shutil.which("bash")
if os.name == "nt" and shutil.which("git"):
    git_bash = Path(shutil.which("git")).parents[1] / "bin" / "bash.exe"
    if git_bash.is_file():
        BASH = str(git_bash)


@unittest.skipUnless(BASH, "Bash is required to execute the workflow helpers")
class GitHubActionsHelperTests(unittest.TestCase):
    def run_helper(self, script):
        helper = ROOT / "scripts" / "github-actions.sh"
        self.assertTrue(helper.is_file(), "The shared GitHub retry helper must exist")
        return subprocess.run(
            [BASH, "--noprofile", "--norc", "-c", 'set -euo pipefail\nsource "$HELPER_PATH"\n' + script],
            env={
                **os.environ,
                "HELPER_PATH": helper.as_posix(),
                "GITHUB_REPOSITORY": "example/TTMRank",
            },
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=False,
            timeout=10,
        )

    def test_successful_command_is_not_repeated(self):
        result = self.run_helper("""
            sleep() { echo "unexpected sleep" >&2; return 99; }
            github_retry printf 'ok'
        """)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "ok")
        self.assertEqual(result.stderr, "")

    def test_transient_failure_retries_with_backoff_and_stops_on_success(self):
        result = self.run_helper("""
            calls=0
            sleep() { printf 'sleep:%s\n' "$1" >&2; }
            flaky() { calls=$((calls + 1)); [ "$calls" -ge 3 ]; }
            github_retry flaky
            printf 'calls:%s' "$calls"
        """)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "calls:3")
        self.assertIn("sleep:5\n", result.stderr)
        self.assertIn("sleep:10\n", result.stderr)
        self.assertNotIn("sleep:20", result.stderr)

    def test_exhaustion_preserves_failure_and_never_logs_arguments(self):
        result = self.run_helper("""
            calls=0
            sleep() { printf 'sleep:%s\n' "$1" >&2; }
            fail() { calls=$((calls + 1)); return 42; }
            status=0
            github_retry fail secret-argument || status=$?
            printf 'calls:%s,status:%s' "$calls" "$status"
            exit "$status"
        """)
        self.assertEqual(result.returncode, 42, result.stderr)
        self.assertEqual(result.stdout, "calls:5,status:42")
        self.assertEqual(result.stderr.count("sleep:"), 4)
        self.assertIn("sleep:40\n", result.stderr)
        self.assertIn("::error::", result.stderr)
        self.assertNotIn("secret-argument", result.stderr)

    def test_retry_diagnostics_do_not_corrupt_captured_json(self):
        result = self.run_helper("""
            calls=0
            sleep() { :; }
            query() {
                calls=$((calls + 1))
                if [ "$calls" -lt 2 ]; then return 1; fi
                printf '{"state":"active"}'
            }
            value="$(github_retry query)"
            printf '%s' "$value"
        """)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, '{"state":"active"}')
        self.assertIn("::warning::", result.stderr)

    def test_watchdog_repair_preserves_active_and_manually_disabled_workflows(self):
        result = self.run_helper("""
            sleep() { :; }
            gh() {
                if [ "$1" = api ]; then
                    case "$2" in
                        */schedule-refresh-07.yml) printf 'disabled_inactivity';;
                        */schedule-refresh-27.yml) printf 'disabled_manually';;
                        */schedule-refresh-47.yml) printf 'active';;
                        *) return 90;;
                    esac
                elif [ "$1 $2" = 'workflow enable' ]; then
                    printf 'enabled:%s\n' "$3"
                else
                    return 91
                fi
            }
            restore_schedule_watchdogs
        """)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("enabled:schedule-refresh-07.yml", result.stdout)
        self.assertNotIn("enabled:schedule-refresh-27.yml", result.stdout)
        self.assertNotIn("enabled:schedule-refresh-47.yml", result.stdout)

    def test_watchdog_query_failure_does_not_enable_unknown_workflows(self):
        result = self.run_helper("""
            sleep() { :; }
            gh() {
                if [ "$1" = api ]; then return 23; fi
                printf 'unexpected enable'
            }
            restore_schedule_watchdogs
        """)
        self.assertEqual(result.returncode, 23, result.stderr)
        self.assertEqual(result.stdout, "")


class GitHubActionsIntegrationTests(unittest.TestCase):
    def test_all_dispatchers_check_out_and_use_bounded_retries(self):
        for filename in (
            "refresh.yml",
            "refresh-successor.yml",
            "schedule-refresh-07.yml",
            "schedule-refresh-27.yml",
            "schedule-refresh-47.yml",
        ):
            with self.subTest(workflow=filename):
                source = (ROOT / ".github" / "workflows" / filename).read_text(encoding="utf-8")
                if filename == "refresh.yml":
                    source = source.split("  successor:\n", 1)[1].split("  deploy:\n", 1)[0]
                self.assertIn("actions/checkout@v4", source)
                self.assertIn("ref: ${{ github.event.repository.default_branch }}", source)
                self.assertIn("source scripts/github-actions.sh", source)
                self.assertIn("github_retry gh workflow run", source)
                if "gh run list" in source:
                    self.assertIn("github_retry gh run list", source)

    def test_inactivity_repair_is_non_blocking_and_does_not_write_repository_contents(self):
        source = (ROOT / ".github" / "workflows" / "refresh.yml").read_text(encoding="utf-8")
        self.assertIn("- name: Restore inactivity-disabled backup schedules", source)
        repair = source.split("- name: Restore inactivity-disabled backup schedules", 1)[1].split("\n      - ", 1)[0]
        self.assertIn("continue-on-error: true", repair)
        self.assertIn("GH_TOKEN: ${{ github.token }}", repair)
        self.assertIn("source scripts/github-actions.sh", repair)
        self.assertIn("restore_schedule_watchdogs", repair)
        self.assertIn("contents: read", source)
        self.assertNotIn("contents: write", source)


if __name__ == "__main__":
    unittest.main()
