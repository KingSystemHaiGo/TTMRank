# Reliable Live Refresh Implementation Plan

> **For implementer:** Use TDD throughout. Write failing test first. Watch it fail. Then implement.

**Goal:** Reliably dispatch collection every 20 minutes and update already-open intelligence pages without imposing heavy polling or analysis downloads.

**Architecture:** Cloudflare Cron dispatches the existing central GitHub workflow. A shared browser refresh controller probes only the manifest while visible and downloads the change feed only when its version changes. The manifest owns all lightweight homepage counts and freshness metadata.

**Tech Stack:** Cloudflare Workers, GitHub Actions, Python unittest, browser ES modules, Node test runner, Playwright.

---

### Task 1: Add the Cloudflare Cron dispatcher

**Files:**
- Modify: `cloudflare/analytics-worker.js`
- Modify: `cloudflare/wrangler.toml.example`
- Modify: `tests/worker/analytics-worker.test.js`
- Modify: `tests/test_workflows.py`
- Delete: `.github/workflows/schedule-refresh-07.yml`
- Delete: `.github/workflows/schedule-refresh-27.yml`
- Delete: `.github/workflows/schedule-refresh-47.yml`

1. Write tests for a 204 GitHub dispatch, missing configuration, non-2xx response and fetch failure.
2. Run `node --test tests/worker/analytics-worker.test.js` and `python -m unittest tests.test_workflows -v`; confirm they fail.
3. Add a bounded `dispatchRefresh` function and Worker `scheduled()` handler.
4. Configure the Cron example and remove GitHub schedule shims.
5. Re-run both target suites and confirm they pass.

### Task 2: Publish lightweight counts and version metadata

**Files:**
- Modify: `src/ttmrank/pipeline.py`
- Modify: `tests/test_pipeline.py`
- Modify: `app/js/changes/data-client.js`
- Modify: `tests/web/changes.test.js`

1. Write failing assertions for `taptap_made_game_count`, validated manifest metadata and versioned no-cache URLs.
2. Run the target Python and Node tests and confirm failure.
3. Add the manifest count and split manifest/feed loading so probes can avoid the feed request.
4. Re-run target tests and confirm they pass.

### Task 3: Add visibility-aware page refresh

**Files:**
- Create: `app/js/changes/live-refresh.js`
- Modify: `app/js/home.js`
- Modify: `app/js/changes/app.js`
- Modify: `app/index.html`
- Modify: `app/changes.html`
- Modify: `tests/web/changes.test.js`
- Modify: `tests/web/changes.spec.js`
- Modify: `tests/web/smoke.spec.js`

1. Write failing unit tests for unchanged probes, changed probes, request coalescing, hidden-page suspension and stale copy.
2. Write an E2E test that changes the routed manifest/feed while the page remains open and verifies the rendered update.
3. Run target tests and confirm failure.
4. Implement the shared controller, replace the heavyweight homepage count fetch, and render delayed-data copy.
5. Run target tests, then all test suites.

### Task 4: Document deployment and verify production behavior

**Files:**
- Modify: `docs/change-intelligence.md`
- Modify: `DEPLOY.md`

1. Document the Worker secret, vars, Cron deployment and least-privilege GitHub token.
2. Run JSON/YAML-adjacent workflow tests and `git diff --check`.
3. Deploy or explicitly report any missing Cloudflare authorization.
4. After deployment, verify one Cron event starts one central refresh and an open page observes the new manifest without reload.
