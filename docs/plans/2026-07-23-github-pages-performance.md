# GitHub Pages Performance Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make all primary TTMRank pages render their first meaningful data view from one GitHub Pages HTML response while retaining complete on-demand datasets.

**Architecture:** Generate deploy-only HTML with inline critical CSS, bundled application code, and page-specific bootstrap JSON. Publish immutable hash-named data copies for secondary interactions and use a shared timeout/retry client for unavoidable GitHub Pages requests.

**Tech Stack:** Python 3.11 artifact generation, JavaScript ES modules, esbuild, Node test runner, Playwright Chromium, GitHub Actions Pages.

---

### Task 1: Shared bootstrap and resilient JSON reads

**Files:**
- Create: `app/js/core/bootstrap.js`
- Create: `app/js/core/data-fetch.js`
- Modify: `app/js/analysis/data-client.js`
- Modify: `app/js/changes/data-client.js`
- Modify: `app/js/universe/data-client.js`
- Test: `tests/web/data-fetch.test.js`
- Test: `tests/web/analysis-data-client.test.js`
- Test: `tests/web/changes.test.js`

1. Write tests proving embedded data causes zero fetches and transient failures retry once.
2. Run the focused Node tests and confirm failure.
3. Implement bootstrap parsing, immutable URLs, timeout, and retry.
4. Run the focused tests and confirm success.

### Task 2: Ranking bootstrap and immutable chart loading

**Files:**
- Modify: `app/js/app.js`
- Test: `tests/web/performance.spec.js`

1. Write a browser assertion that the default ranking renders without JSON requests.
2. Read embedded meta and Android/iOS hot charts before using network fallback.
3. Load non-default charts by manifest-provided hash filename.
4. Verify platform and chart switching.

### Task 3: Deploy-only site builder

**Files:**
- Create: `scripts/build-site.mjs`
- Modify: `package.json`
- Modify: `.gitignore`
- Test: `tests/web/site-build.test.js`

1. Test page bootstrap payloads, inline resources, safe JSON escaping, immutable files, and budgets.
2. Bundle page applications with esbuild while externalizing Three.js/PixiJS runtime chunks.
3. Inline critical CSS, bundled code, and page bootstrap data into copied HTML.
4. Generate immutable data copies and a build report in the temporary output.

### Task 4: Actions integration and regression protection

**Files:**
- Modify: `.github/workflows/deploy.yml`
- Modify: `.github/workflows/refresh.yml`
- Modify: `.github/workflows/test.yml`
- Modify: `tests/test_workflows.py`

1. Test that every publication path runs the site builder and uploads its output.
2. Build the optimized site after data collection and before browser tests.
3. Run browser tests against the optimized output directory.
4. Upload only the optimized directory to Pages.

### Task 5: Full verification

**Files:**
- Add: `tests/web/performance.spec.js`

1. Run Python, JavaScript, bundle-budget and Chromium suites.
2. Record request counts and first-render timing on desktop and 390px.
3. Confirm default analysis, home, changes, map, and ranking views issue no data JSON request.
4. Confirm full-site analysis and non-default rankings still load with no runtime error.
