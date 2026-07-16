"""Deterministic vendor registry with conservative, evidence-first labels."""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable


@dataclass(frozen=True, slots=True)
class VendorProfile:
    name: str
    scale: str = "unverified"
    account_role: str = "unverified"
    verification: str = "unverified"
    source: str = ""
    note: str = "身份与规模尚未核实，不用于推断个人开发可行性。"

    def to_dict(self) -> dict:
        return asdict(self)


def canonical_vendor_name(value: object) -> str:
    """Apply only mechanical Unicode/whitespace normalization to an account name."""

    raw = "" if value is None else str(value)
    normalized = unicodedata.normalize("NFKC", raw)
    return re.sub(r"\s+", " ", normalized, flags=re.UNICODE).strip() or "未知"


def load_vendor_overrides(path: Path) -> dict[str, VendorProfile]:
    if not path.exists():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    profiles = {}
    for row in payload.get("vendors", []):
        canonical_name = canonical_vendor_name(row.get("name"))
        profile = VendorProfile(
            name=canonical_name,
            scale=row.get("scale", "unverified"),
            account_role=row.get("account_role", "unverified"),
            verification=row.get("verification", "unverified"),
            source=row.get("source", ""),
            note=row.get("note", "身份与规模尚未核实，不用于推断个人开发可行性。"),
        )
        existing = profiles.get(canonical_name)
        if existing and existing != profile:
            raise ValueError(f"conflicting vendor overrides after normalization: {canonical_name}")
        profiles[canonical_name] = profile
    return profiles


def build_vendor_registry(names: Iterable[str], overrides: dict[str, VendorProfile]) -> list[dict]:
    aliases_by_name: dict[str, set[str]] = {}
    for value in names:
        raw_alias = "未知" if value is None or not str(value).strip() else str(value)
        canonical_name = canonical_vendor_name(raw_alias)
        aliases_by_name.setdefault(canonical_name, set()).add(raw_alias)

    registry = []
    for canonical_name in sorted(aliases_by_name):
        profile = overrides.get(canonical_name, VendorProfile(name=canonical_name))
        row = profile.to_dict()
        row.update(
            {
                "name": canonical_name,
                "canonical_name": canonical_name,
                "raw_aliases": sorted(aliases_by_name[canonical_name], key=lambda value: (canonical_vendor_name(value), value)),
            }
        )
        registry.append(row)
    return registry
