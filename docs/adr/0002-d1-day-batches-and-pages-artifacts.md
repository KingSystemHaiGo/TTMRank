# ADR-0002: Use one-day D1 batches and immutable Pages artifacts

## Status

Accepted

## Context

TTMRank collects roughly 900 game observations per refresh. Keeping every snapshot in Git causes permanent repository growth, while compacting hundreds of historical days in one D1 request can exceed transaction limits. Retrying an additive daily UPSERT can also double-count replayed hours. The site must remain a static GitHub Pages deployment, and existing Git history must not be rewritten without separate authorization.

Non-functional requirements are: bounded work per request, no deletion unless aggregation succeeds, idempotent retries, UTC-stable metric definitions, diagnosable failures, read-only scheduled access to Git, and graceful operation when optional D1 secrets are absent.

## Decision

Maintenance selects only the oldest pending UTC day. It absolutely replaces that complete day's aggregate, advances a durable `archived_through` watermark, and deletes only the same day's hourly source in one D1 batch. Every mutation rechecks oldest-day ordering. D1 triggers reject writes below the watermark even if ingest races maintenance. The same batch records a completed audit row and returns a post-mutation `has_more` flag. GitHub Actions calls this endpoint in a bounded loop and resumes remaining work on the next run.

Scheduled refreshes and code pushes both generate a fresh `app/` directory, validate it, upload it as a GitHub Pages artifact, and deploy that artifact. Before deployment, each workflow verifies that the artifact source SHA is still the default-branch head; stale refresh artifacts are skipped, and a code push may cancel an older Pages publication. Scheduled jobs never commit generated snapshots. Existing repository history is left untouched.

## Consequences

### Positive

- Retry-safe daily values and atomic aggregate/delete behavior.
- Predictable D1 work even after a long outage.
- Repository history stops growing from 20-minute data commits.
- A code push cannot overwrite the live site with an old checked-in snapshot.
- A delayed refresh artifact cannot overwrite a newer default-branch deployment.
- Action summaries preserve successful and failed maintenance responses.

### Negative

- A backlog larger than the Action cap needs multiple daily/manual runs.
- The latest generated snapshot lives in the Pages deployment artifact rather than a Git commit.
- Both deployment workflows perform collection and validation, increasing Actions runtime.

### Neutral

- D1 remains optional for local development; long-range metrics degrade gracefully without it.
- Destructive cleanup of already-existing Git history remains a separate, explicitly authorized operation.

## Alternatives considered

- **Additive daily UPSERT:** rejected because replay after source deletion double-counts data.
- **Compact the entire backlog in one request:** rejected because work is unbounded and likely to exceed D1 limits.
- **Keep committing snapshots and use shallow checkout:** rejected because it reduces runner download cost but not remote repository growth.
- **Force-replace a dedicated snapshot branch:** not chosen because it adds destructive branch semantics and still couples publication to Git object maintenance.
- **Rewrite existing history now:** rejected because it changes commit hashes and requires explicit coordination and force-push authorization.

## References

- `docs/history-retention.md`
- `.github/workflows/history-maintenance.yml`
- `cloudflare/analytics-worker.js`
