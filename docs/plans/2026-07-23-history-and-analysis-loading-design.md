# Resilient hourly growth and faster analysis loading

## Problem

Production currently has valid 24-hour history for 837 of 989 games but no
one-hour history. The rolling Actions cache is healthy; the latest two refresh
runs were about 114 minutes apart. The one-hour selector only accepts a point
60 to 100 minutes old, so a delayed scheduler can remove the whole window.

The analysis page also blocks its first render on three serial requests. In the
measured production path, the manifest took about 2.7 seconds, the 148 KB gzip
full analysis payload 12.5 seconds, and quality data 1.6 seconds. The page also
loads a multi-file module graph before requesting data.

## Decisions

### One-hour growth

- Keep the existing exact baseline calculation when a valid one-hour point is
  available.
- If that point is missing, use the newest historical observation between 45
  minutes and 3 hours old and normalize its heat change to one hour.
- Mark normalized values with `heat_delta_1h_estimated` and preserve the actual
  observation interval in `heat_delta_1h_basis_hours`.
- Render estimated values with an approximation mark and an explicit estimated
  label. Never silently present a two-hour raw delta as a one-hour delta.
- Continue returning no value when the newest observation is too fresh or more
  than 3 hours old.

### Initial analysis payload

- Publish `analysis-made-current.json` alongside the unchanged full analysis
  artifact. It contains only TapTap-made games, their appearances, metrics,
  summary, and boards.
- Load the made artifact for the default made scope. Load the full artifact only
  for an initial all-site URL or when the user switches to all-site reference.
- Keep the full artifact and all existing analysis behavior available.

### Network and rendering path

- Fetch the manifest through a five-minute version bucket with `no-store`.
- Fetch immutable analysis and quality payloads through SHA-versioned URLs with
  `force-cache`.
- Render analysis immediately after its artifact is parsed; quality information
  updates asynchronously and cannot block the first meaningful screen.
- Bundle the analysis module graph with the existing esbuild dependency and
  serve one small entry asset. Source modules remain the implementation source.

## Non-goals

- No service worker, third-party runtime, WebGL, or visual redesign.
- No fabricated exact history and no changes to the original rankings.
- No eager download of the all-site payload for the default made view.

## Verification

- Python tests cover delayed sampling, stale sampling, manifest hashes, and made
  artifact referential integrity.
- JavaScript tests cover versioned requests and made/full artifact selection.
- Browser tests prove made-first loading, non-blocking quality data, lazy
  all-site loading, details, filters, desktop layout, and mobile layout.
- Production-sized artifacts are measured before and after the change.
