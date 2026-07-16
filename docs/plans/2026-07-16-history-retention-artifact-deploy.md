# History Retention and Artifact Deployment Implementation Plan

> **For implementers:** Use TDD throughout. Add a failing regression test, run it, then make the smallest production change that passes. Do not commit or push this worktree.

**Goal:** Keep recent hourly and long-range daily history without unbounded D1 or Git growth, while deploying every generated snapshot directly as a GitHub Pages artifact.

**Architecture:** D1 maintenance processes at most one oldest UTC day per request. A single D1 batch replaces that day's aggregate, deletes its source rows, records completion, and reports whether more work remains. GitHub Actions performs a bounded continuation loop. Refresh and code-push workflows generate a fresh `app/` tree and deploy it directly, so scheduled data no longer creates Git commits.

**Tech stack:** Cloudflare Worker/D1 (JavaScript + SQLite), Python unittest, Node test runner, GitHub Actions, GitHub Pages artifacts, Playwright.

---

## Metric and retention contract

- Entity: TapTap game (`game_id`).
- Hourly grain: one row per `(game_id, captured_hour)`; timestamps are UTC epoch seconds aligned to an hour.
- Daily grain: one row per `(game_id, captured_day)`; UTC day is inclusive at `00:00` and exclusive at the next `00:00`.
- Recent source of truth: `game_heat_hourly`, retained for 90 complete UTC days by default.
- Long-range source of truth: `game_heat_daily`, retained for 730 complete UTC days by default.
- Daily average: `heat_sum / sample_count`; score average uses only non-null score samples.
- Ingest accepts only the retained hourly window and at most one hour of forward clock skew. Rejected batches write nothing.
- `GET /v1/series?grain=day` prefers a live hourly aggregate when both grains contain the same UTC day.

### Task 1: Worker safety boundaries and day-series merge

**Files:**

- Modify: `cloudflare/analytics-worker.js`
- Modify: `tests/worker/analytics-worker.test.js`

1. Add failing tests for retained-window timestamps, obvious future timestamps, and UTC day selection.
2. Run `node --test tests/worker/analytics-worker.test.js` and confirm the new assertions fail.
3. Add ingest-window validation and a merged daily-series query with `[from, to)` bounds.
4. Re-run the targeted test and then all Node unit tests.

### Task 2: One-day atomic maintenance

**Files:**

- Modify: `cloudflare/analytics-worker.js`
- Modify: `tests/test_history_maintenance_sql.py`
- Modify: `tests/worker/analytics-worker.test.js`

1. Add failing regressions for absolute replacement, repeated maintenance, exact-day deletion, backlog ordering, `has_more`, and rollback.
2. Run the targeted Python and Node tests and confirm expected failures.
3. Select the oldest pending UTC day across expired hourly and daily data.
4. In one batch: count the day, replace its complete aggregate when still inside daily retention, record `completed`, delete only that day's source/expired rows, prune old audit rows, then query `has_more`.
5. On failure, write a separate `failed` audit row without claiming the data mutation completed.
6. Return `processed_day`, `has_more`, cutoffs, and row counts.

### Task 3: Bounded Action continuation and artifact-only refresh

**Files:**

- Modify: `.github/workflows/history-maintenance.yml`
- Modify: `.github/workflows/refresh.yml`
- Modify: `.github/workflows/deploy.yml`
- Modify: `tests/test_workflows.py`

1. Add failing workflow assertions: no `git commit`/`git push`, direct Pages artifact deployment, fresh fetch on code push, bounded maintenance loop, and failure-body summary.
2. Run `python -m unittest tests.test_workflows -v` and confirm failures.
3. Make maintenance call at most 100 days per run, assigning a unique run id to each call and stopping when `has_more=false`.
4. Capture curl body and HTTP status independently; always write a summary, then fail explicitly for non-2xx or malformed JSON.
5. Replace scheduled snapshot commits with `upload-pages-artifact` + `deploy-pages` and read-only repository permissions.
6. Make `deploy.yml` run the fetcher before verification/upload so a code push cannot redeploy a stale checked-in snapshot.

### Task 4: Maker decision-integrity fixes

**Files:**

- Modify: `src/ttmrank/vendor_registry.py`
- Modify: `src/ttmrank/pipeline.py`
- Modify: `app/js/analysis/opportunity.js`
- Modify: related Python/Node tests and generated `app/data/v2/*.json`

1. Add failing tests for canonical whitespace normalization, preservation of Maker tags when detail tags are empty, and exclusion of verified professional/major samples from individual-fit scoring.
2. Keep uncertain identities `unverified`; never infer company scale from names.
3. Split maker metrics into indie/unknown decision samples and verified-professional market-reference samples. Label small-N scarcity as sample scarcity and expose sample size/confidence.
4. Generate vendor coverage statistics directly in `vendors.json` so the registry does not download the full analysis dataset.

### Task 5: Frontend and deployment gate hardening

**Files:**

- Modify: ranking/vendor HTML, CSS, JavaScript and Playwright tests
- Modify: `.github/workflows/deploy.yml`

1. Add regressions for modal focus containment/return, post-render control focus, compact mobile navigation, and rendered-list overflow.
2. Use a true modal dialog or equivalent focus trap; keep hidden descendants out of tab order.
3. Move live announcements to short status nodes, expose toggle state, retain keyboard focus after rerender, and add chart text alternatives.
4. Restrict TapTap links to the intended host and remove the untrusted blocking chart dependency or self-host it.
5. Run Chromium smoke tests in the code-push deployment gate.

### Task 6: Full verification

Run:

```text
PYTHONPATH=src python -m unittest discover -s tests -v
npm run test:unit
npm run test:e2e
git diff --check
```

Also inspect desktop and 390x844 pages, reset any browser viewport override, close local test tabs, and stop the local static server. No Git history rewrite, commit, push, or force-push is part of this plan.
