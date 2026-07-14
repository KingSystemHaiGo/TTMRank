"""Build versioned analysis artifacts from ranking payloads."""

from __future__ import annotations

import gzip
import hashlib
import json
from dataclasses import asdict
from pathlib import Path

from .exporters import AtomicPublisher
from .metrics import analysis_boards, calculate_game_metric, summarize_games
from .normalize import normalize_legacy_rankings
from .validators import validate_dataset

SCHEMA_VERSION = "2.0"


def build_analysis_artifacts(payload: dict, output_dir: Path, history_client=None) -> dict:
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
    compact = json.dumps(analysis, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    digest = hashlib.sha256(compact).hexdigest()
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
    }
    publisher = AtomicPublisher(output_dir)
    publisher.publish_json("analysis-current.json", analysis)
    publisher.publish_json("quality.json", quality, pretty=True)
    publisher.publish_json("manifest.json", manifest, pretty=True)
    if history_client:
        history_client.ingest(games_json, dataset.observed_at)
    return manifest
