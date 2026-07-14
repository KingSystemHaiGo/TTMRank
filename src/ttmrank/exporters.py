"""Atomic JSON publication helpers."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any


class AtomicPublisher:
    def __init__(self, root: Path) -> None:
        self.root = root

    def publish_json(self, relative_path: str, payload: Any, *, errors: list[str] | None = None, pretty: bool = False) -> Path:
        if errors:
            raise ValueError("publication blocked: " + "; ".join(errors))
        target = self.root / relative_path
        target.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temp_name = tempfile.mkstemp(prefix=target.name + ".", suffix=".tmp", dir=target.parent)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, ensure_ascii=False, indent=2 if pretty else None, separators=None if pretty else (",", ":"))
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp_name, target)
        except Exception:
            try:
                os.remove(temp_name)
            except OSError:
                pass
            raise
        return target

