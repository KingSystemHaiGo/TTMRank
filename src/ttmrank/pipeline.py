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
from .vendor_registry import build_vendor_registry, canonical_vendor_name, load_vendor_overrides

SCHEMA_VERSION = "2.0"


def build_analysis_artifacts(payload: dict, output_dir: Path, history_client=None, vendor_overrides_path: Path | None = None) -> dict:
    dataset = normalize_legacy_rankings(payload)
    validation_issues = validate_dataset(dataset.games, dataset.appearances)
    issues = dataset.issues + validation_issues
    errors = [issue.message for issue in issues if issue.severity == "error"]
    if errors:
        raise ValueError("invalid normalized dataset: " + "; ".join(errors))

    games_json = [game.to_dict() for game in dataset.games]
    overrides_path = vendor_overrides_path or Path(__file__).parents[2] / "config" / "vendor-overrides.json"
    vendor_registry = build_vendor_registry((game.developer for game in dataset.games), load_vendor_overrides(overrides_path))
    vendor_map = {vendor["canonical_name"]: vendor for vendor in vendor_registry}
    vendor_coverage = {
        vendor["canonical_name"]: {"game_count": 0, "maker_game_count": 0, "heat_total": 0}
        for vendor in vendor_registry
    }
    for game in games_json:
        developer_raw = str(game.get("developer") or "未知")
        vendor_name = canonical_vendor_name(developer_raw)
        vendor = vendor_map[vendor_name]
        game["developer_raw"] = developer_raw
        game["developer_canonical"] = vendor_name
        game["developer"] = vendor_name
        game["vendor_scale"] = vendor["scale"]
        game["vendor_role"] = vendor["account_role"]
        game["vendor_verification"] = vendor["verification"]
        coverage = vendor_coverage[vendor_name]
        coverage["game_count"] += 1
        coverage["maker_game_count"] += int(bool(game.get("is_taptap_made")))
        coverage["heat_total"] += int(game.get("heat") or 0)
    for vendor in vendor_registry:
        vendor.update(vendor_coverage[vendor["canonical_name"]])
    coverage_summary = {
        "game_count": len(games_json),
        "maker_game_count": sum(bool(game.get("is_taptap_made")) for game in games_json),
        "heat_total": sum(int(game.get("heat") or 0) for game in games_json),
    }
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
    history_ingest = {"configured": False, "status": "not_configured"}
    if history_client:
        ingest_result = history_client.ingest(games_json, dataset.observed_at)
        status = getattr(history_client, "ingest_status", None)
        history_ingest = status() if callable(status) else {
            "configured": True,
            "status": "success" if ingest_result else "failed",
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
        "vendor_count": len(vendor_registry),
        "verified_vendor_count": sum(vendor["verification"] == "verified" for vendor in vendor_registry),
        "vendor_file": "vendors.json",
        "history_available": any(metric.history_available for metric in metrics),
        "history_ingest": history_ingest,
    }
    publisher = AtomicPublisher(output_dir)
    publisher.publish_json("analysis-current.json", analysis)
    publisher.publish_json(
        "vendors.json",
        {
            "schema_version": "1.1",
            "updated_at": payload.get("updated_at"),
            "coverage": coverage_summary,
            "vendors": vendor_registry,
        },
        pretty=True,
    )
    publisher.publish_json("quality.json", quality, pretty=True)
    publisher.publish_json("manifest.json", manifest, pretty=True)
    return manifest
