# TTMRank game change intelligence design

## Goal

Turn TTMRank from a snapshot reader into a game-first, automatically generated
intelligence product:

`collect -> normalize -> compare -> record events -> quality gate -> publish -> monitor`

The default scope is games tagged `TapTap制造`. All-game data remains available
as reference. The original ranking pages and the thirteen existing analysis boards
remain intact.

## Product decisions

- The first generated content product is a game change feed.
- Raw comparisons run after each 20-minute collection.
- Similar consecutive events for the same game, event type, platform, and chart
  merge within two hours for presentation.
- The home page defaults to the latest 24 hours and shows at most five important
  changes. Users can switch to 1 hour or 7 days.
- A dedicated page contains the complete feed with URL-backed filters.
- Positive and negative changes use direct language: rank rose, rank fell,
  entered, re-entered, exited, score rose, score fell, coverage increased, or
  coverage decreased.
- Do not use vague words such as “波动” or unsupported dramatic claims.
- Do not add developer profiles, vendor verification, company scale, or
  individual/studio/professional identity categories.
- The interface is code-native HTML, CSS, JavaScript, and SVG. Three.js and
  PixiJS are intentionally excluded because this reading task does not need 3D
  or GPU rendering. Existing game icons remain the primary visual assets.

## Event rules

Rank movement is recorded when the absolute movement reaches the threshold for
the previous rank:

| Previous rank | Minimum movement |
| --- | --- |
| 1-10 | 2 places |
| 11-50 | 5 places |
| 51+ | 10 places or 20% of the previous rank |

Entry, re-entry, exit, and coverage changes are always recorded. Score changes
are recorded at 0.1 or more. Event payloads keep structured before/after values;
Chinese display copy is produced from those values rather than stored as an
opaque sentence.

Negative absence-based events are generated only when the affected chart was
complete in both the current and previous observations. A chart is incomplete
when it is missing, restored from cache, or rejected by collection quality
checks. If any relevant chart is incomplete, coverage decreases are also
suppressed. The published feed explains this explicitly.

## State and retention

### Immediate production path

GitHub Actions restores a compact rolling state file from an Actions cache before
collection and saves the next state only after validation succeeds. The state
contains:

- the previous compact game and ranking observation;
- chart completeness metadata;
- appearance keys seen previously, so entry and re-entry are distinct;
- raw events required to build the most recent seven-day feed.

Refresh jobs are serialized, so one run always compares against the last
successful run. The cache key is unique per run and restored by a shared prefix;
older immutable caches age out under GitHub's cache eviction policy. Loss of the
cache is safe: the next run establishes a baseline and publishes a clear
“historical comparison is being established” state instead of inventing events.

### Optional durable archive

The existing Cloudflare D1 history service remains the durable extension. When
configured, raw change events are appended to an event ledger and retained for
180 days while heat history continues to use the existing hourly-to-daily
compaction policy. D1 failure never blocks static publication; the rolling
Actions state keeps the public feed working.

## Published contract

`app/data/v2/changes-current.json` is an atomic static artifact:

```json
{
  "schema_version": "1.0",
  "generated_at": 0,
  "updated_at": "",
  "status": "ready",
  "comparison_available": true,
  "partial": false,
  "suppressed_negative_event_count": 0,
  "events": []
}
```

Each event includes a stable id, kind, scope, game identity and icon, platform,
chart, structured before/after values, first and last observation times,
occurrence count, and deterministic importance score. The manifest records the
feed file, byte size, event count, comparison status, and partial-data status.

## Information architecture

### Global shell

The quiet navigation contains `情报`, `游戏分析`, and `原始排行`; GitHub remains
an external utility link. The active page is explicit. Data time and source
status stay in page content rather than becoming decorative header widgets.

### Home page

The first viewport is the product, not a marketing hero:

1. `TapTap制造游戏变化`
2. update cadence and latest successful collection time
3. `最近1小时 / 最近24小时 / 最近7天` segmented control
4. no more than five event rows
5. `查看全部变化` and restrained links to analysis and original rankings
6. an unframed current-snapshot rail with non-interactive reference counts

An event row shows game icon, game name, direct change statement, chart,
platform, and time in one scan path. The whole row opens the event; it does not
add an ambiguous `查看详情` button.

### Complete feed

`changes.html` provides range, event type, platform, and game search filters.
All filter state is encoded in the URL. `清除筛选` appears only while a filter is
active. Essential before/after values never require hover.

### Event detail

Desktop opens a right-side drawer. Mobile opens a full-screen detail surface.
The URL gains the event id, and browser Back closes the detail and restores the
previous filters and scroll position. Actions are concrete:

- close/back icon: return to the feed;
- copy-link icon: copy this event URL and show `链接已复制`;
- `打开 TapTap 游戏页`: open the source game page;
- `在游戏分析中查看`: open the existing analysis page focused on the game.

The detail shows the exact before/after values, first and latest observation
times, chart/platform context, occurrence count, collection status, and the
threshold or rule that caused the event to be recorded.

## Visual system

- true white page background, charcoal primary text, neutral gray dividers;
- restrained cyan brand accent, green for positive changes, red for negative
  changes, with icons and words providing redundant meaning;
- open bands, lists, and tables rather than nested cards or a bento grid;
- 0-8px radii, 1px borders, minimal elevation only for the drawer;
- fixed type scale, zero letter spacing, deliberate control typography;
- compact desktop density with 44px minimum primary mobile touch targets;
- 160-220ms state transitions and a no-motion fallback for
  `prefers-reduced-motion`.

No gradients, glass effects, decorative orbs, large marketing hero, fake
metrics, or inert controls are allowed.

## Copy lock

Primary visible strings:

- page title: `TapTap制造游戏变化`
- supporting copy: `直接查看排名、评分与榜单覆盖的变化。`
- range controls: `最近1小时`, `最近24小时`, `最近7天`
- feed action: `查看全部变化`
- loading: `正在读取最新变化`
- ready empty state: `这段时间没有达到记录阈值的变化`
- baseline state: `正在建立历史比较，下一次采集后开始记录变化`
- error: `暂时无法读取变化数据`
- retry action: `重新读取`
- partial warning:
  `本轮采集不完整，已暂停生成跌出榜单和覆盖减少事件。`

All other user-visible copy in the home, feed, analysis, and ranking surfaces is
audited against the same rules: specific action labels, no pseudo-buttons, no
developer/vendor framing, and no unsupported interpretation.

## Workflow design

- `test.yml` remains the code-change CI and runs the complete Python, JavaScript,
  and Chromium suites.
- Scheduled refresh runs only collection, focused data-contract tests, JSON
  validation, and a lightweight render contract. It does not install Chromium
  or run the full UI suite every 20 minutes.
- The three existing schedules at minute 07, 27, and 47 dispatch one refresh
  each. The refresh workflow no longer holds a runner asleep until the next
  cycle.
- A failed collection or invalid artifact is never saved as the next comparison
  baseline and is never deployed.
- Pages deployment continues to reject artifacts built from stale code.

## Accessibility and responsive behavior

- Every interactive row, segmented control, filter, drawer action, and retry
  action has keyboard focus and an accessible name.
- Event meaning is not color-only, hover-only, or animation-only.
- The mobile first screen shows the feed before secondary snapshot metadata.
- Opening and closing filters or detail restores focus and reading position.
- Loading, baseline, empty, partial, stale, and hard-error states are distinct.
- Long game names wrap without resizing controls or causing horizontal overflow.

## Verification

- Python unit tests cover thresholds, entry/re-entry/exit, score and coverage
  changes, partial-data suppression, two-hour merging, state retention, and
  atomic publication.
- JavaScript unit tests cover URL state, filtering, event copy, and detail URLs.
- E2E tests cover home range switching, full-feed filtering, desktop drawer,
  browser Back, copy feedback, mobile full-screen detail, empty/error states,
  and preservation of analysis and raw-ranking routes.
- Visual QA covers 1440x900, 1024x768, 390x844, and 360x800 with no overlap or
  page-level horizontal overflow.

