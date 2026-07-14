"""TTMRank command-line entry point."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .pipeline import build_analysis_artifacts


def parser() -> argparse.ArgumentParser:
    command = argparse.ArgumentParser(description="Build TTMRank v2 analysis data")
    command.add_argument("--input", type=Path, required=True, help="Legacy rankings.json input")
    command.add_argument("--output", type=Path, required=True, help="v2 output directory")
    return command


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    payload = json.loads(args.input.read_text(encoding="utf-8"))
    manifest = build_analysis_artifacts(payload, args.output)
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
