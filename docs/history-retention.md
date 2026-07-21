# History retention

TTMRank separates three lifecycles: source code stays in Git, the latest generated
site is published as a GitHub Pages artifact, and time-series history rolls forward
inside Cloudflare D1. Scheduled refreshes do not commit generated snapshots, so new
20-minute data runs no longer grow Git history.

## Retention and metric contract

| Layer | Entity and grain | Default retention | Purpose |
| --- | --- | ---: | --- |
| GitHub Pages artifact | latest generated site | current deployment | public static site |
| `game_heat_hourly` | game × UTC hour | 90 complete UTC days | recent growth and detailed charts |
| `game_heat_daily` | game × UTC day | 730 complete UTC days | long-range trend reference |
| `game_change_events` | one structured game-change event | 180 days | optional durable change ledger |
| `history_maintenance_runs` | one row per API call | 730 days | operational diagnosis |

The UTC day is inclusive at `00:00` and exclusive at the next `00:00`. A daily
row stores sample counts, sums, extrema, and the last observation. Heat average is
`heat_sum / sample_count`; score average uses only non-null score observations.
This avoids averages of averages and keeps the calculation reproducible.

`POST /v1/snapshots` accepts an entire batch or rejects it atomically. A captured
hour must be aligned to an hour, must not be older than the current hourly
retention cutoff, must be at or beyond the durable `archived_through` watermark,
and may be no more than one aligned hour ahead of the Worker clock. The Worker
pre-reads the watermark for a clear response; D1 insert/update triggers are the
authoritative race guard if maintenance advances it before the ingest commits.
This also keeps old archives closed if hourly retention is later expanded.

For `GET /v1/series?grain=day`, the Worker merges archived daily rows with live
daily aggregates calculated from the recent hourly table. When both sources
contain the same UTC day, live hourly data wins. Hourly and daily ranges both use
the half-open interval `[from, to)`.

## Bounded maintenance sequence

`Maintain History` starts daily at 03:17 UTC. One `POST /v1/maintenance` request
processes at most the oldest pending UTC day:

1. Find the oldest expired hourly day or expired daily day.
2. If the hourly day still belongs in daily retention, absolutely replace that
   complete day's aggregate; never add it to a previous total.
3. Reconfirm inside every mutation that the selected hourly day is still the
   oldest one. Advance `archived_through`, record the completed audit, delete only
   that UTC day's source/expired rows, prune old audit rows, and calculate
   post-mutation `has_more` in one D1 batch.
4. Return `processed_day`, `has_more`, cutoffs, retention settings, and row counts.

D1 batches are transactional. If aggregation or any later statement fails, the
daily replacement, source deletion, and completed audit all roll back. The Worker
then writes a separate `failed` audit record. A retry after a successful deletion
cannot erase an existing valid archive because daily clearing requires source
hours to exist. If an earlier hour wins a race after day selection, all guarded
mutations become no-ops and the next call selects the true oldest day.

Even when no history day is pending, maintenance records the completed call and
prunes audit rows older than daily retention in one D1 batch. An idle database
therefore does not accumulate maintenance audit rows without bound.

Change events use the same ingest token as heat snapshots. `POST /v1/events`
accepts at most 500 validated events and inserts them idempotently by stable
`event_id`; retries therefore cannot duplicate a change. `GET /v1/events`
requires a `since` timestamp, accepts only the `made` or `all` scope, and caps
responses at 500 rows. The static seven-day feed remains the primary Pages
source: an archive write failure is reported as `changes_archive.status=failed`
in the manifest but never blocks publication.

Each maintenance call also deletes at most 5,000 events older than
`EVENT_RETENTION_DAYS`, which defaults to 180 days. The response includes
`retention.event_days`, `cutoffs.events`, and `rows.events_deleted`; `has_more`
stays true while either heat or event cleanup remains. This bounds individual D1
mutations while allowing the existing Action loop to drain a backlog.

The Action follows `has_more` for at most 100 calls per run. Each call receives a
unique run id. This bounds database and runner work during a first deployment or
long outage; remaining days continue on the next scheduled or manual run. HTTP
status, response body, and curl errors are captured separately, and both success
and failure are written to the Action summary.

Refresh and code-push summaries also report the current snapshot ingest state as
`success`, `failed`, or `not_configured`. A failed or absent optional D1 does not
block the static site, but it is no longer silent. The public manifest records only
that safe status and never includes the history URL, token, or exception text.

## One-time deployment

Apply `cloudflare/schema.sql` to the existing D1 database before deploying the
updated Worker. Configure:

- Worker secret `INGEST_TOKEN`.
- GitHub secret `TTMRANK_HISTORY_TOKEN` with the same value.
- Worker secret `MAINTENANCE_TOKEN`.
- GitHub secret `TTMRANK_MAINTENANCE_TOKEN` with the same value.
- GitHub secret `TTMRANK_HISTORY_URL` with the Worker base URL.

Optional Worker variables `HOURLY_RETENTION_DAYS` and
`DAILY_RETENTION_DAYS` default to `90` and `730`.
`EVENT_RETENTION_DAYS` defaults to `180`. The Worker constrains all ranges and
requires daily heat retention to be longer than hourly heat retention.

After deployment, manually run `Maintain History` once and inspect its summary.
If `has_more` remains true after 100 calls, rerun it until the backlog is clear.

## Git history boundary

Artifact publication stops future scheduled data commits, but it does not shrink
objects already present in the remote repository. Rewriting existing Git history
changes commit hashes and requires coordinated force-pushes. It is deliberately
outside this implementation and must only happen as a separate, explicitly
approved maintenance operation.
