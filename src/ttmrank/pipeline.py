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
from .visual_artifact import build_visual_artifact

SCHEMA_VERSION = "2.0"


def _analysis_payload(games, appearances, metrics, *, updated_at, observed_at) -> dict:
    return {
        "schema_version": SCHEMA_VERSION,
        "updated_at": updated_at,
        "observed_at": observed_at,
        "games": [game.to_dict() for game in games],
        "appearances": [appearance.to_dict() for appearance in appearances],
        "metrics": [metric.to_dict() for metric in metrics],
        "summary": summarize_games(games, metrics),
        "boards": analysis_boards(games, appearances, metrics),
    }


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
    analysis = _analysis_payload(
        dataset.games,
        dataset.appearances,
        metrics,
        updated_at=payload.get("updated_at"),
        observed_at=dataset.observed_at,
    )
    made_games = [game for game in dataset.games if game.is_taptap_made]
    made_ids = {game.id for game in made_games}
    made_appearances = [row for row in dataset.appearances if row.game_id in made_ids]
    made_metrics = [metric for metric in metrics if metric.game_id in made_ids]
    made_analysis = _analysis_payload(
        made_games,
        made_appearances,
        made_metrics,
        updated_at=payload.get("updated_at"),
        observed_at=dataset.observed_at,
    )
    visual = build_visual_artifact(
        dataset.games,
        metrics,
        updated_at=payload.get("updated_at"),
        observed_at=dataset.observed_at,
    )
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
    made_compact = json.dumps(made_analysis, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    made_digest = hashlib.sha256(made_compact).hexdigest()
    quality_compact = json.dumps(quality, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    quality_digest = hashlib.sha256(quality_compact).hexdigest()
    changes_compact = json.dumps(changes, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    changes_digest = hashlib.sha256(changes_compact).hexdigest()
    visual_compact = json.dumps(visual, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    visual_digest = hashlib.sha256(visual_compact).hexdigest()
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "updated_at": payload.get("updated_at"),
        "observed_at": dataset.observed_at,
        "analysis_file": "analysis-current.json",
        "analysis_sha256": digest,
        "analysis_bytes": len(compact),
        "analysis_gzip_bytes": len(gzip.compress(compact)),
        "analysis_made_file": "analysis-made-current.json",
        "analysis_made_sha256": made_digest,
        "analysis_made_bytes": len(made_compact),
        "analysis_made_gzip_bytes": len(gzip.compress(made_compact)),
        "quality_file": "quality.json",
        "quality_sha256": quality_digest,
        "quality_bytes": len(quality_compact),
        "quality_gzip_bytes": len(gzip.compress(quality_compact)),
        "visual_file": "visual-current.json",
        "visual_sha256": visual_digest,
        "visual_bytes": len(visual_compact),
        "visual_gzip_bytes": len(gzip.compress(visual_compact)),
        "game_count": len(dataset.games),
        "taptap_made_game_count": sum(game.is_taptap_made for game in dataset.games),
        "appearance_count": len(dataset.appearances),
        "quality_issue_count": len(issues),
        "history_available": any(metric.history_available for metric in metrics),
        "history_windows": {
            "1h": any(metric.heat_delta_1h is not None for metric in metrics),
            "24h": any(metric.heat_delta_24h is not None for metric in metrics),
            "7d": any(metric.heat_delta_7d is not None for metric in metrics),
        },
        "history_estimates": {
            "1h": sum(metric.heat_delta_1h_estimated for metric in metrics),
        },
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
    publisher.publish_json("analysis-made-current.json", made_analysis)
    publisher.publish_json("quality.json", quality)
    publisher.publish_json("changes-current.json", changes)
    publisher.publish_json("visual-current.json", visual)
    publisher.publish_json("manifest.json", manifest, pretty=True)
    if change_state_path is not None:
        write_state_atomic(change_state_path, next_change_state)
    return manifest
