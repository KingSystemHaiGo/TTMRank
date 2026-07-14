"""Typed domain models shared by collection, analysis and export layers."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field as dc_field
from typing import Any, Literal


@dataclass(slots=True)
class Game:
    id: int
    title: str
    icon_source_url: str = ""
    icon_proxy_url: str | None = None
    url: str = ""
    developer: str = "未知"
    tags: list[str] = dc_field(default_factory=list)
    supported_platforms: list[str] = dc_field(default_factory=list)
    released_at: int | None = None
    score: float | None = None
    heat: int | None = None
    reserve: int | None = None
    is_taptap_made: bool = False
    observed_at: int = 0
    quality_flags: list[str] = dc_field(default_factory=list)

    def __post_init__(self) -> None:
        if not isinstance(self.id, int) or self.id <= 0:
            raise ValueError("game id must be a positive integer")
        if not self.title.strip():
            raise ValueError("game title must not be empty")
        if self.heat is not None and self.heat < 0:
            raise ValueError("game heat must not be negative")

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class Appearance:
    game_id: int
    platform: str
    chart: str
    rank: int
    observed_at: int
    source: Literal["live", "cache"] = "live"

    def __post_init__(self) -> None:
        if self.source not in {"live", "cache"}:
            raise ValueError("appearance source must be live or cache")
        if self.rank <= 0:
            raise ValueError("appearance rank must be positive")

    @property
    def identity(self) -> tuple[int, str, str]:
        return self.game_id, self.platform, self.chart

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class CollectionResult:
    ok: bool
    data: dict[str, Any] | None = None
    error: str | None = None
    attempts: int = 1
    source: Literal["live", "cache"] = "live"

    def __post_init__(self) -> None:
        if not self.ok and not self.error:
            raise ValueError("failed collection result requires an error")
        if self.ok and self.data is None:
            raise ValueError("successful collection result requires data")


@dataclass(slots=True)
class DataQualityIssue:
    code: str
    message: str
    severity: Literal["info", "warning", "error"] = "warning"
    game_id: int | None = None
    platform: str | None = None
    chart: str | None = None
    field: str | None = None
    values: list[Any] = dc_field(default_factory=list)


@dataclass(slots=True)
class GameMetric:
    game_id: int
    age_hours: float | None = None
    heat_per_hour_lifetime: float | None = None
    heat_per_day_lifetime: float | None = None
    heat_delta_1h: int | None = None
    heat_delta_24h: int | None = None
    heat_delta_7d: int | None = None
    growth_per_hour_24h: float | None = None
    chart_coverage: int = 0
    platform_coverage: int = 0
    short_sample: bool = False
    history_available: bool = False

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
