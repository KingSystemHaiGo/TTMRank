CREATE TABLE IF NOT EXISTS game_heat_hourly (
  game_id INTEGER NOT NULL,
  captured_hour INTEGER NOT NULL,
  heat INTEGER,
  score REAL,
  PRIMARY KEY (game_id, captured_hour)
);

CREATE INDEX IF NOT EXISTS idx_heat_hour ON game_heat_hourly(captured_hour);
