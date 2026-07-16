# ADR 0001: Self-Sustaining Refresh Scheduling

Status: Accepted; artifact publication amended by ADR-0002

Date: 2026-07-15

## Context

TTMRank needs a ranking snapshot about every 20 minutes. GitHub scheduled
workflows are best-effort. In production, the `*/20` schedule created roughly
one run per hour and then stopped creating runs for more than two hours, while
the collector and Pages deployment themselves remained healthy. Splitting the
cron into three independent workflows also failed to create its first natural
event within the validation window.

The repository has no configured external scheduler credentials. Ranking data
must continue to be collected and deployed to GitHub Pages. ADR-0002 later
replaced scheduled Git snapshot commits with direct Pages artifacts.

## Decision

`Refresh Data` records its cycle start, performs collection and deployment,
waits until 20 minutes after that start, and dispatches the next `Refresh Data`
run with the workflow-scoped GitHub token. Collection and continuation each have
a 30-minute job timeout; Pages deployment has a 10-minute timeout, so a stuck
deployment cannot hold the serialized refresh chain for GitHub's default six-hour
job limit.

The three independent cron workflows remain as watchdogs. They query active
`Refresh Data` runs and dispatch only when no run is queued or in progress.
The central workflow's concurrency group serializes delayed or manual starts.

The refresh workflow publishes its generated `app/` tree directly as a Pages
artifact. The artifact records its source revision, and the deploy job compares
that SHA with the latest default branch before publication. A stale refresh is
skipped instead of overwriting a newer code deployment. Code-push deployments
may cancel an older in-progress Pages publication. The workflow does not depend
on a recursive `workflow_run` event.

## Consequences

- Normal capture starts are approximately 20 minutes apart without depending
  on GitHub cron delivery.
- A public GitHub-hosted runner remains allocated while waiting for the next
  cycle, normally about 15-17 minutes per run.
- If a cycle is cancelled or times out before it can dispatch its successor,
  any later watchdog event restarts the chain.
- Manual or delayed watchdog starts do not branch the chain while another
  refresh is active.
- If the repository becomes private or runner usage must be reduced, migrate
  the 20-minute trigger to Cloudflare Cron, Vercel Cron, or another external
  scheduler and retain the central refresh workflow as the dispatch target.

## Alternatives Considered

- A single `*/20` GitHub cron: rejected after repeated missed production runs.
- Three independent cron workflows as the primary scheduler: retained only as
  watchdogs because GitHub still provides no delivery guarantee.
- A third-party cron service: operationally preferable, but requires an
  external account and a protected GitHub dispatch credential that are not
  currently configured.
