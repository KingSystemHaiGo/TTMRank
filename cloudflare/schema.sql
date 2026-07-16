CREATE TABLE IF NOT EXISTS game_heat_hourly (
  game_id INTEGER NOT NULL,
  captured_hour INTEGER NOT NULL,
  heat INTEGER,
  score REAL,
  PRIMARY KEY (game_id, captured_hour)
);

CREATE INDEX IF NOT EXISTS idx_heat_hour ON game_heat_hourly(captured_hour);

-- Hourly snapshots are compacted into one UTC-day row before their retention
-- window expires. Sums and counts are stored instead of rounded averages so
-- a complete source day can be replaced without averaging averages. Once that
-- day is archived, the retention watermark rejects replayed hourly snapshots.
CREATE TABLE IF NOT EXISTS game_heat_daily (
  game_id INTEGER NOT NULL,
  captured_day INTEGER NOT NULL,
  first_captured_hour INTEGER NOT NULL,
  last_captured_hour INTEGER NOT NULL,
  sample_count INTEGER NOT NULL,
  heat_min INTEGER NOT NULL,
  heat_max INTEGER NOT NULL,
  heat_sum INTEGER NOT NULL,
  heat_last INTEGER NOT NULL,
  score_sample_count INTEGER NOT NULL DEFAULT 0,
  score_min REAL,
  score_max REAL,
  score_sum REAL NOT NULL DEFAULT 0,
  score_last REAL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, captured_day)
);

CREATE INDEX IF NOT EXISTS idx_heat_day ON game_heat_daily(captured_day);

-- A durable high-water mark prevents a later retention expansion from
-- reopening hours whose complete UTC day was already archived and deleted.
CREATE TABLE IF NOT EXISTS history_retention_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  archived_through INTEGER NOT NULL DEFAULT 0
    CHECK (archived_through >= 0 AND archived_through % 86400 = 0)
);

INSERT OR IGNORE INTO history_retention_state(singleton, archived_through)
SELECT 1, COALESCE(MAX(captured_day) + 86400, 0)
FROM game_heat_daily;

UPDATE history_retention_state
SET archived_through = MAX(
  archived_through,
  COALESCE((SELECT MAX(captured_day) + 86400 FROM game_heat_daily), 0)
)
WHERE singleton = 1;

CREATE TRIGGER IF NOT EXISTS guard_archived_through_regression
BEFORE UPDATE OF archived_through ON history_retention_state
WHEN NEW.archived_through < OLD.archived_through
BEGIN
  SELECT RAISE(ABORT, 'TTMRANK_WATERMARK_REGRESSION');
END;

-- Worker-side reads produce a friendly early rejection. These triggers are
-- the authoritative race guard if maintenance advances the mark after that
-- read but before an ingest batch commits.
CREATE TRIGGER IF NOT EXISTS guard_archived_hour_insert
BEFORE INSERT ON game_heat_hourly
WHEN NEW.captured_hour < COALESCE((
  SELECT archived_through FROM history_retention_state WHERE singleton = 1
), 0)
BEGIN
  SELECT RAISE(ABORT, 'TTMRANK_ARCHIVED_HOUR');
END;

CREATE TRIGGER IF NOT EXISTS guard_archived_hour_update
BEFORE UPDATE OF captured_hour ON game_heat_hourly
WHEN NEW.captured_hour < COALESCE((
  SELECT archived_through FROM history_retention_state WHERE singleton = 1
), 0)
BEGIN
  SELECT RAISE(ABORT, 'TTMRANK_ARCHIVED_HOUR');
END;

-- One row per maintenance invocation makes rolling cleanup observable from
-- GitHub Actions without keeping report artifacts in Git.
CREATE TABLE IF NOT EXISTS history_maintenance_runs (
  run_id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  hourly_cutoff INTEGER NOT NULL,
  daily_cutoff INTEGER NOT NULL,
  hourly_rows_archived INTEGER NOT NULL DEFAULT 0,
  hourly_rows_deleted INTEGER NOT NULL DEFAULT 0,
  daily_rows_deleted INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_maintenance_started ON history_maintenance_runs(started_at);
