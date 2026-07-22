"""Build versioned analysis artifacts from ranking payloads."""

from __future__ import annotations

import gzip
import hashlib
import json
from dataclasses import asdict
from pathlib import Path

from .changes import build_feed, build_observation_state, load_state, write_state_atomic
from .exporters import AtomicPublisher
from .metrics import analysis_boards, calculate_game_metric, summarize_games
from .normalize import normalize_legacy_rankings
from .validators import validate_dataset

SCHEMA_VERSION = "2.0"


def build_analysis_artifacts(
    payload: dict,
    output_dir: Path,
    history_client=None,
    change_state_path: Path | None = None,
) -> dict:
    dataset = normalize_legacy_rankings(payload)
    validation_issues = validate_dataset(dataset.games, dataset.appearances)
    issues = dataset.issues + validation_issues
    errors = [issue.message for issue in issues if issue.severity == "error"]
    if errors:
        raise ValueError("invalid normalized dataset: " + "; ".join(errors))

    games_json = [game.to_dict() for game in dataset.games]
    history_metrics = history_client.metrics(games_json, dataset.observed_at) if history_client else {}
    metrics = [calculate_game_metric(game, dataset.appearances, history_metrics.get(game.id)) for game in dataset.games]
    analysis = {
        "schema_version": SCHEMA_VERSION,
        "updated_at": payload.get("updated_at"),
        "observed_at": dataset.observed_at,
        "games": games_json,
        "appearances": [appearance.to_dict() for appearance in dataset.appearances],
        "metrics": [metric.to_dict() for metric in metrics],
        "summary": summarize_games(dataset.games, metrics),
        "boards": analysis_boards(dataset.games, dataset.appearances, metrics),
    }
    quality = {
        "schema_version": SCHEMA_VERSION,
        "updated_at": payload.get("updated_at"),
        "issues": [asdict(issue) for issue in issues],
    }
    current_change_state = build_observation_state(dataset, payload, issues)
    changes, next_change_state = build_feed(load_state(change_state_path), current_change_state)
    history_ingest = {"configured": False, "status": "not_configured"}
    changes_archive = {"configured": False, "status": "not_configured"}
    if history_client:
        ingest_result = history_client.ingest(games_json, dataset.observed_at)
        status = getattr(history_client, "ingest_status", None)
        history_ingest = status() if callable(status) else {
            "configured": True,
            "status": "success" if ingest_result else "failed",
        }
        archive = getattr(history_client, "archive_events", None)
        if callable(archive):
            try:
                archive_result = archive(changes["events"])
            except Exception:
                archive_result = False
            archive_status = getattr(history_client, "archive_status", None)
            changes_archive = archive_status() if callable(archive_status) else {
                "configured": True,
                "status": "success" if archive_result else "failed",
            }
    compact = json.dumps(analysis, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    digest = hashlib.sha256(compact).hexdigest()
    changes_compact = json.dumps(changes, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    changes_digest = hashlib.sha256(changes_compact).hexdigest()
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "updated_at": payload.get("updated_at"),
        "observed_at": dataset.observed_at,
        "analysis_file": "analysis-current.json",
        "analysis_sha256": digest,
        "analysis_bytes": len(compact),
        "analysis_gzip_bytes": len(gzip.compress(compact)),
        "game_count": len(dataset.games),
        "appearance_count": len(dataset.appearances),
        "quality_issue_count": len(issues),
        "history_available": any(metric.history_available for metric in metrics),
        "history_ingest": history_ingest,
        "changes_file": "changes-current.json",
        "changes_sha256": changes_digest,
        "changes_bytes": len(changes_compact),
        "changes_event_count": len(changes["events"]),
        "changes_comparison_available": changes["comparison_available"],
        "changes_partial": changes["partial"],
        "changes_archive": changes_archive,
    }
    publisher = AtomicPublisher(output_dir)
    publisher.publish_json("analysis-current.json", analysis)
    publisher.publish_json("quality.json", quality, pretty=True)
    publisher.publish_json("changes-current.json", changes)
    publisher.publish_json("manifest.json", manifest, pretty=True)
    if change_state_path is not None:
        write_state_atomic(change_state_path, next_change_state)
    return manifest
