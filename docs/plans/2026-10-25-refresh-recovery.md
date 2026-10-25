# Refresh Recovery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restore current ranking data and prevent one failed GitHub dispatch from permanently stopping collection.

**Architecture:** Retain the existing bounded 20-minute successor and three cron watchdogs. Share bounded retries between their GitHub CLI calls, and have each collection restore only watchdogs disabled automatically for inactivity. Watchdog repair must not prevent data publication or override manually disabled workflows.

**Tech Stack:** GitHub Actions, Bash, GitHub CLI, Python unittest.

---

## Incident Evidence

- Last successful snapshot: 2026-10-21 04:55:37 Asia/Shanghai, refresh run `39496110493`.
- Successor run `39496126700` failed at 2026-10-21 05:15 with HTTP 500 while dispatching `refresh.yml`; no retry existed.
- All three cron watchdogs had state `disabled_inactivity` since 2026-10-13.
- Immediate recovery: enable those watchdogs and dispatch `refresh.yml` (run `40181919291`).

### Task 1: Reproduce Retry and Recovery Requirements

**Files:** Create `tests/test_github_actions.py`.

1. Execute the real Bash helper with deterministic fake commands and sleep functions.
2. Cover immediate success, transient failure, exhausted retries, clean captured stdout, inactivity recovery, preservation of manually disabled workflows, and API failure propagation.
3. Check that both successor dispatches and all three watchdogs source and use the helper, and that watchdog repair cannot block collection.
4. Run `python -m unittest tests.test_github_actions -v`; expect failure before implementation.

### Task 2: Implement Bounded Retries and Watchdog Recovery

**Files:** Create `scripts/github-actions.sh`; modify `.github/workflows/refresh.yml`, `.github/workflows/refresh-successor.yml`, and `.github/workflows/schedule-refresh-{07,27,47}.yml`.

1. Add `github_retry`, which preserves stdout and exit status, tries at most five times, and backs off for 5, 10, 20, and 40 seconds. Diagnostics must not print command arguments or credentials.
2. Add `restore_schedule_watchdogs`, which queries each watchdog state and enables only `disabled_inactivity` workflows through the retry helper.
3. Source the helper in every dispatch/query step, checking out the latest default branch where necessary.
4. Add a non-blocking watchdog repair step to collection, retaining read-only repository contents permissions.
5. Run focused and full Python suites, Bash syntax checks, and JavaScript unit/site tests.

### Task 3: Publish and Verify

1. Review the diff and verify no generated data or unrelated files are included.
2. Commit the fix, publish through the repository's existing workflow, and inspect the actual build/test results.
3. Dispatch a refresh from the fixed revision and verify successful collection and deployment.
4. Fetch the public page without cache and verify its embedded manifest has a current `updated_at` and the stale-data notice is gone.
5. Verify all three watchdogs are active and a successor is scheduled. Preserve the existing 20-minute cadence; do not shorten its wait just for verification.
