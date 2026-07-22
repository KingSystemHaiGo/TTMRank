# Game Change Intelligence Implementation Plan

> **For implementer:** Use TDD throughout. Write failing test first. Watch it fail. Then implement.

**Goal:** Publish a trustworthy, game-first change feed after every collection and make it the code-native TTMRank home experience without removing the existing analysis or original ranking surfaces.

**Architecture:** A pure Python change engine compares the current normalized observation with a compact rolling state restored by GitHub Actions. It publishes a static seven-day feed for Pages and optionally mirrors raw events into the existing D1 service. Vanilla ES modules render the home feed, complete feed, URL-backed detail drawer, and mobile full-screen detail using semantic DOM, CSS, and SVG.

**Tech Stack:** Python 3.11 standard library, vanilla JavaScript ES modules, HTML/CSS/SVG, Node test runner, Playwright, GitHub Actions cache, optional Cloudflare Worker + D1.

---

### Task 1: Change event domain and thresholds

**Files:**
- Create: `src/ttmrank/changes.py`
- Create: `tests/test_changes.py`

**Step 1: Write the failing threshold tests**

Cover one behavior per test:

```python
from ttmrank.changes import rank_change_is_significant


def test_top_ten_requires_two_places():
    assert not rank_change_is_significant(8, 7)
    assert rank_change_is_significant(8, 6)


def test_middle_rank_requires_five_places():
    assert not rank_change_is_significant(30, 26)
    assert rank_change_is_significant(30, 25)


def test_tail_rank_accepts_ten_places_or_twenty_percent():
    assert rank_change_is_significant(80, 70)
    assert rank_change_is_significant(80, 64)
    assert not rank_change_is_significant(80, 72)
```

Add focused tests for:

- rank rise and fall payloads;
- first entry versus re-entry using `seen_appearance_keys`;
- exit only when both chart observations are complete;
- score rise/fall at exactly `0.1` after decimal normalization;
- coverage increase and quality-gated coverage decrease;
- all events retaining `scope="made"` when either side identifies the game as
  TapTap-made;
- stable event ids and deterministic importance scores.

**Step 2: Run the tests and confirm RED**

Run:

```powershell
$env:PYTHONPATH='src'; python -m unittest tests.test_changes -v
```

Expected: FAIL because `ttmrank.changes` does not exist.

**Step 3: Implement the minimal change engine**

Create these public functions and keep event payloads structured:

```python
def rank_change_is_significant(previous_rank: int, current_rank: int) -> bool: ...
def build_observation_state(dataset, payload: dict, issues: list) -> dict: ...
def detect_events(previous: dict, current: dict) -> tuple[list[dict], int]: ...
def event_importance(event: dict) -> int: ...
```

Use `Decimal(str(value)).quantize(Decimal("0.1"))` for score comparisons. Event
kinds are exactly:

```python
RANK_RISE = "rank_rise"
RANK_FALL = "rank_fall"
ENTERED = "entered"
REENTERED = "reentered"
EXITED = "exited"
SCORE_RISE = "score_rise"
SCORE_FALL = "score_fall"
COVERAGE_INCREASE = "coverage_increase"
COVERAGE_DECREASE = "coverage_decrease"
```

Do not generate opaque display sentences in Python. Store `before`, `after`,
`platform`, `chart`, `observed_at`, and a `rule` value that the UI can explain.

**Step 4: Run the target and Python suites**

Run:

```powershell
$env:PYTHONPATH='src'; python -m unittest tests.test_changes -v
$env:PYTHONPATH='src'; python -m unittest discover -s tests -v
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/ttmrank/changes.py tests/test_changes.py
git commit -m "feat: detect meaningful game changes"
```

---

### Task 2: Rolling state, two-hour merging, and static feed artifact

**Files:**
- Modify: `src/ttmrank/changes.py`
- Modify: `src/ttmrank/pipeline.py`
- Modify: `app/fetcher.py`
- Modify: `tests/test_changes.py`
- Modify: `tests/test_pipeline.py`
- Create: `tests/test_change_state.py`

**Step 1: Write failing state and merge tests**

Required cases:

```python
def test_same_direction_rank_events_merge_inside_two_hours(): ...
def test_opposite_rank_directions_do_not_merge(): ...
def test_events_outside_two_hours_remain_separate(): ...
def test_state_keeps_only_events_needed_for_seven_day_feed(): ...
def test_missing_state_publishes_baseline_status_without_events(): ...
def test_failed_publication_does_not_replace_comparison_state(): ...
```

Extend `PipelineTests.test_builds_manifest_analysis_and_quality_files` to assert:

```python
self.assertEqual(manifest["changes_file"], "changes-current.json")
self.assertTrue((Path(tmp) / "changes-current.json").exists())
self.assertFalse(manifest["changes_comparison_available"])
```

**Step 2: Run and confirm RED**

```powershell
$env:PYTHONPATH='src'; python -m unittest tests.test_change_state tests.test_pipeline -v
```

Expected: FAIL because the state and feed APIs are absent.

**Step 3: Implement rolling state APIs**

Add:

```python
STATE_SCHEMA_VERSION = "1.0"
FEED_SCHEMA_VERSION = "1.0"
FEED_RETENTION_SECONDS = 7 * 86_400
MERGE_WINDOW_SECONDS = 2 * 3_600

def load_state(path: Path | None) -> dict | None: ...
def merge_events(events: list[dict]) -> list[dict]: ...
def build_feed(previous_state: dict | None, current_state: dict) -> tuple[dict, dict]: ...
def write_state_atomic(path: Path, state: dict) -> None: ...
```

Change `build_analysis_artifacts` to accept an optional
`change_state_path: Path | None`. Publish `changes-current.json` through
`AtomicPublisher`, add change metadata to `manifest.json`, and write the next
rolling state only after all static artifacts have published successfully.

In `app/fetcher.py`, read `TTMRANK_CHANGE_STATE_PATH`. Local runs without the
variable use `app/data/.state/change-state.json`; CI passes a path outside the
Pages artifact.

The feed status values are `baseline`, `ready`, `partial`, or `error`. A missing
or invalid prior state becomes `baseline`, never an empty `ready` feed.

**Step 4: Verify GREEN and artifact JSON**

```powershell
$env:PYTHONPATH='src'; python -m unittest tests.test_changes tests.test_change_state tests.test_pipeline -v
python -m json.tool app/data/v2/changes-current.json > $null
```

Expected: PASS and valid JSON.

**Step 5: Commit**

```powershell
git add src/ttmrank/changes.py src/ttmrank/pipeline.py app/fetcher.py tests/test_changes.py tests/test_change_state.py tests/test_pipeline.py app/data/v2/changes-current.json app/data/v2/manifest.json
git commit -m "feat: publish rolling change feed"
```

---

### Task 3: Optional D1 event archive and rolling deletion

**Files:**
- Modify: `cloudflare/schema.sql`
- Modify: `cloudflare/analytics-worker.js`
- Modify: `src/ttmrank/history_client.py`
- Modify: `src/ttmrank/pipeline.py`
- Modify: `tests/worker/analytics-worker.test.js`
- Modify: `tests/test_history_client.py`
- Modify: `tests/test_pipeline.py`
- Modify: `.github/workflows/history-maintenance.yml`
- Modify: `docs/history-retention.md`

**Step 1: Write failing Worker and client tests**

Worker tests must prove:

- `POST /v1/events` rejects a missing or wrong ingest token;
- invalid event kinds and oversized batches return `400`/`413`;
- valid events use `INSERT ... ON CONFLICT(event_id) DO NOTHING`;
- `GET /v1/events?since=&scope=&limit=` uses bounded parameters and CORS;
- maintenance deletes events older than `EVENT_RETENTION_DAYS` (default 180);
- the maintenance response reports `events_deleted`.

Python tests use a patched `urlopen` and assert:

```python
client.archive_events(events) is True
client.events(since, scope="made") == expected
```

Also assert that archive failure leaves static publication successful and marks
the manifest archive status as failed.

**Step 2: Run and confirm RED**

```powershell
node --test tests/worker/analytics-worker.test.js
$env:PYTHONPATH='src'; python -m unittest tests.test_history_client tests.test_pipeline -v
```

Expected: FAIL on missing route/client methods.

**Step 3: Implement the archive**

Add a D1 table with no user-authored text:

```sql
CREATE TABLE IF NOT EXISTS game_change_events (
  event_id TEXT PRIMARY KEY,
  game_id INTEGER NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('made', 'all')),
  kind TEXT NOT NULL,
  platform TEXT,
  chart TEXT,
  before_value REAL,
  after_value REAL,
  first_observed_at INTEGER NOT NULL,
  last_observed_at INTEGER NOT NULL,
  occurrences INTEGER NOT NULL DEFAULT 1,
  importance INTEGER NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_change_events_time
  ON game_change_events(last_observed_at DESC);
```

Add bounded Worker routes and `HistoryClient.archive_events` / `events` methods.
Pipeline publication uses the local rolling state as the primary source and D1
only as an optional archive/fallback. Never block Pages publication on D1.

Extend daily maintenance with one bounded event deletion statement and expose
its count in the workflow summary. Keep existing heat hourly-to-daily compaction
unchanged.

**Step 4: Verify GREEN**

```powershell
node --test tests/worker/analytics-worker.test.js
$env:PYTHONPATH='src'; python -m unittest tests.test_history_client tests.test_pipeline tests.test_history_maintenance_sql -v
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add cloudflare/schema.sql cloudflare/analytics-worker.js src/ttmrank/history_client.py src/ttmrank/pipeline.py tests/worker/analytics-worker.test.js tests/test_history_client.py tests/test_pipeline.py .github/workflows/history-maintenance.yml docs/history-retention.md
git commit -m "feat: archive change events in D1"
```

---

### Task 4: Efficient 20-minute Actions refresh

**Files:**
- Modify: `.github/workflows/refresh.yml`
- Modify: `.github/workflows/deploy.yml`
- Modify: `.github/workflows/schedule-refresh-07.yml`
- Modify: `.github/workflows/schedule-refresh-27.yml`
- Modify: `.github/workflows/schedule-refresh-47.yml`
- Modify: `tests/test_workflows.py`
- Modify: `docs/history-retention.md`

**Step 1: Write failing workflow contract tests**

Assert parsed workflow text has:

- a shared `data-publish` concurrency group in refresh and deploy;
- `actions/cache/restore@v4` before collection;
- `TTMRANK_CHANGE_STATE_PATH` passed to the fetcher;
- `actions/cache/save@v4` only after validation;
- no `sleep`, self-dispatch `continue` job, Chromium install, or full E2E command
  in `refresh.yml`;
- complete Python/JS/E2E checks still present in `test.yml`;
- the three schedules remain at minutes 07, 27, and 47.

**Step 2: Run and confirm RED**

```powershell
$env:PYTHONPATH='src'; python -m unittest tests.test_workflows -v
```

Expected: FAIL against the current long-running refresh workflow.

**Step 3: Refactor workflow responsibilities**

Refresh sequence:

1. checkout latest default branch;
2. restore `.ttmrank/change-state.json` using a unique primary key and shared
   restore prefix;
3. collect data with `TTMRANK_CHANGE_STATE_PATH`;
4. run change/pipeline/validator tests and JSON parsing only;
5. save the state cache;
6. upload and deploy the Pages artifact;
7. finish without waiting or dispatching a successor.

The schedule workflows remain the 20-minute dispatchers. `test.yml` remains the
only scheduled-by-code full browser CI. Deploy-on-push may keep full tests but
must participate in the same rolling-state restore/save contract.

**Step 4: Verify GREEN**

```powershell
$env:PYTHONPATH='src'; python -m unittest tests.test_workflows -v
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add .github/workflows tests/test_workflows.py docs/history-retention.md
git commit -m "ci: separate data refresh from full browser tests"
```

---

### Task 5: Frontend change model, filtering, and URL state

**Files:**
- Create: `app/js/changes/model.js`
- Create: `app/js/changes/data-client.js`
- Create: `app/js/changes/state.js`
- Create: `tests/web/changes.test.js`

**Step 1: Write failing JavaScript tests**

Test exact user-visible behavior:

```javascript
import { describeEvent, filterEvents, topEvents } from '../../app/js/changes/model.js';
import { parseChangeState, serializeChangeState } from '../../app/js/changes/state.js';

test('describes a direct rank rise', () => {
  assert.equal(describeEvent({ kind: 'rank_rise', before: 18, after: 9 }), '从第18名升至第9名');
});

test('describes a direct score fall', () => {
  assert.equal(describeEvent({ kind: 'score_fall', before: 8.2, after: 8.0 }), '评分从8.2降至8.0');
});
```

Also cover:

- all nine event kinds;
- range, scope, type, platform, and query filtering;
- default `range=24h` and `scope=made`;
- URL round-trip including `event=<id>`;
- deterministic top-five importance order;
- unknown event kinds using a safe non-interpretive fallback.

**Step 2: Run and confirm RED**

```powershell
node --test tests/web/changes.test.js
```

Expected: FAIL because the modules do not exist.

**Step 3: Implement pure modules**

`data-client.js` validates the static schema before returning it. `model.js` has
no DOM access. `state.js` ignores unknown URL keys and omits default values when
serializing. All time comparisons use epoch seconds from the artifact, not the
browser's locale parser.

**Step 4: Verify GREEN and all unit tests**

```powershell
node --test tests/web/changes.test.js
npm run test:unit
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add app/js/changes tests/web/changes.test.js
git commit -m "feat: add change feed client model"
```

---

### Task 6: Code-native home, complete feed, and event detail

**Files:**
- Modify: `app/index.html`
- Modify: `app/js/home.js`
- Modify: `app/css/tokens.css`
- Modify: `app/css/base.css`
- Modify: `app/css/home.css`
- Create: `app/changes.html`
- Create: `app/js/changes/app.js`
- Create: `app/css/changes.css`
- Create: `tests/web/changes.spec.js`
- Modify: `tests/web/smoke.spec.js`

**Step 1: Write failing E2E tests**

Mock `manifest.json`, `analysis-current.json`, and `changes-current.json` with
route fixtures. Assert:

- the home first viewport contains `TapTap制造游戏变化` and no former hero copy;
- the default selected range is `最近24小时`;
- no more than five event rows render on home;
- switching range changes rows and updates the URL;
- `查看全部变化` opens `changes.html` with current range;
- an event row opens a right drawer at desktop width;
- its URL contains the stable event id and browser Back closes it;
- copy link gives visible `链接已复制` feedback;
- at 390x844 the detail occupies the viewport and Back restores the feed;
- baseline, ready-empty, partial, and hard-error states use the locked copy;
- no page-level horizontal overflow at 1440, 1024, 390, and 360 widths.

**Step 2: Run and confirm RED**

```powershell
npx playwright test tests/web/changes.spec.js
```

Expected: FAIL because the new page and feed UI do not exist.

**Step 3: Implement semantic DOM UI**

Use:

- native links for navigation and source destinations;
- native buttons only for state-changing controls;
- a list of row buttons for events, with accessible names that include the game
  and change description;
- `<dialog>` for detail, styled as an anchored drawer above 720px and full-screen
  below it;
- inline SVG from one consistent outline icon family for arrows, close, copy,
  external link, rise, and fall;
- existing `core/game-icon.js` for real game icons and its fallback;
- `history.pushState` and `popstate` for event detail;
- a polite live region for loading, retry, and copy feedback.

Do not add Three.js, PixiJS, gradients, decorative animation, nested cards,
hover-only values, or an inert control. Respect `prefers-reduced-motion`.

**Step 4: Verify E2E and unit suites**

```powershell
npm run test:unit
npx playwright test tests/web/changes.spec.js tests/web/smoke.spec.js
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add app/index.html app/changes.html app/js/home.js app/js/changes/app.js app/css/tokens.css app/css/base.css app/css/home.css app/css/changes.css tests/web/changes.spec.js tests/web/smoke.spec.js
git commit -m "feat: make change intelligence the home experience"
```

---

### Task 7: Whole-site copy, navigation, and interaction audit

**Files:**
- Modify: `app/analysis.html`
- Modify: `app/rankings.html`
- Modify: `app/css/components.css`
- Modify: `app/css/analysis.css`
- Modify: `app/css/style.css`
- Modify: `app/js/analysis/app.js`
- Modify: `app/js/app.js`
- Modify: `tests/web/analysis-interactions.spec.js`
- Modify: `tests/web/filters.test.js`
- Modify: `tests/web/smoke.spec.js`

**Step 1: Add failing audit tests**

Assert:

- global navigation exposes `情报`, `游戏分析`, and `原始排行` consistently;
- `清除筛选` is hidden when analysis filters are at defaults and appears when a
  filter is active;
- every visible button has a corresponding state change, menu, export, retry,
  dialog, or navigation effect;
- analysis still renders all thirteen boards;
- ranking platform/chart controls and original rows remain available;
- no visible copy includes developer profile, vendor verification, vendor scale,
  personal studio, professional vendor, `查看详情`, or `了解更多`;
- default pages use the true-white visual tokens and contain no decorative
  `radial-gradient`/orb background.

**Step 2: Run and confirm RED**

```powershell
npm run test:unit
npx playwright test tests/web/analysis-interactions.spec.js tests/web/smoke.spec.js
```

Expected: FAIL on current navigation, reset visibility, and dark decorative
background contracts.

**Step 3: Implement the audit fixes**

- Adopt the shared true-white token system and 0-8px radii without changing the
  chart math or board data APIs.
- Keep the analysis first reading path compact; retain every metric, chart, and
  board.
- Rename ambiguous actions to their outcome. Keep icon-only controls limited to
  familiar close, theme, refresh, copy, and navigation icons with tooltips and
  accessible names.
- Remove old developer/vendor pages from navigation only; do not delete unrelated
  compatibility files in this scoped change.
- Preserve original ranking ordering and data fields.

**Step 4: Verify all frontend behavior**

```powershell
npm run test:unit
npx playwright test
```

Expected: PASS with 13 analysis boards and original ranking coverage intact.

**Step 5: Commit**

```powershell
git add app tests/web
git commit -m "refactor: unify game-first site experience"
```

---

### Task 8: Full verification, visual evidence, and release notes

**Files:**
- Modify if needed: `DEPLOY.md`
- Create: `docs/change-intelligence.md`
- Modify only for verified defects: implementation and test files from Tasks 1-7

**Step 1: Document operation and recovery**

Explain:

- rolling Actions state restore/save and cache loss behavior;
- D1 event archive configuration and retention;
- feed status meanings;
- how negative-event suppression works;
- why code-change CI and data refresh have different test budgets;
- manual recovery and one-cycle baseline behavior.

**Step 2: Run complete verification**

```powershell
$env:PYTHONPATH='src'; python -m unittest discover -s tests -v
npm run test:unit
npx playwright test
git diff --check
```

Expected: all tests pass and no whitespace errors.

**Step 3: Start the local site and capture evidence**

Run the existing local server on an unused port. Verify with the Browser first;
if Browser screenshot capture remains unreliable, record that reason and use the
repo's Playwright Chromium as the fallback.

Capture and inspect with `view_image`:

- home 1440x900;
- complete feed 1440x900 with drawer open;
- home 390x844;
- mobile full-screen detail 390x844;
- analysis first viewport;
- original ranking first viewport.

Check copy, reading order, typography, semantic colors, icon alignment, dividers,
drawer geometry, focus, loading/partial/error states, long names, and overflow.

**Step 4: Run final regression after visual fixes**

Repeat all commands from Step 2. Expected: PASS.

**Step 5: Commit**

```powershell
git add DEPLOY.md docs/change-intelligence.md
git commit -m "docs: explain change intelligence operations"
```

Temporary screenshots and QA artifacts must not be committed.

