#!/usr/bin/env bash

github_retry() {
  local attempt delay status
  for attempt in 1 2 3 4 5; do
    if "$@"; then
      return 0
    else
      status=$?
    fi

    if [ "$attempt" -eq 5 ]; then
      echo "::error::GitHub command failed after 5 attempts (exit ${status})." >&2
      return "$status"
    fi

    delay=$((5 * 2 ** (attempt - 1)))
    echo "::warning::GitHub command failed (attempt ${attempt}/5); retrying in ${delay}s." >&2
    sleep "$delay"
  done
}

restore_schedule_watchdogs() {
  local workflow state
  for workflow in schedule-refresh-07.yml schedule-refresh-27.yml schedule-refresh-47.yml; do
    state="$(github_retry gh api \
      "repos/${GITHUB_REPOSITORY}/actions/workflows/${workflow}" \
      --jq '.state')" || return "$?"

    # Respect intentional operator changes; only undo GitHub's inactivity policy.
    if [ "$state" = "disabled_inactivity" ]; then
      github_retry gh workflow enable "$workflow" --repo "$GITHUB_REPOSITORY" || return "$?"
      echo "Restored ${workflow} after automatic inactivity disablement."
    fi
  done
}
