import re
import sqlite3
import unittest
from pathlib import Path


class HistoryMaintenanceSqlTests(unittest.TestCase):
    ROOT = Path(__file__).parents[1]

    @classmethod
    def setUpClass(cls):
        cls.worker = (cls.ROOT / "cloudflare" / "analytics-worker.js").read_text(encoding="utf-8")
        cls.schema = (cls.ROOT / "cloudflare" / "schema.sql").read_text(encoding="utf-8")

    def extract_sql(self, name):
        match = re.search(rf"const {name} = `(.+?)`;", self.worker, re.DOTALL)
        self.assertIsNotNone(match, f"missing {name}")
        return match.group(1)

    def database(self):
        database = sqlite3.connect(":memory:")
        database.executescript(self.schema)
        return database

    def test_compaction_sql_builds_reproducible_daily_aggregate(self):
        compact_sql = self.extract_sql("COMPACT_DAILY_SQL")
        database = self.database()
        day = 1_800_057_600
        rows = [
            (7, day + 3_600, 100, 8.0),
            (7, day + 7_200, 160, 9.0),
            (8, day + 3_600, 40, None),
        ]
        database.executemany(
            "INSERT INTO game_heat_hourly(game_id,captured_hour,heat,score) VALUES(?,?,?,?)",
            rows,
        )
        database.execute(
            compact_sql,
            (day, day + 86_400, day, day + 86_400, day + 90_000, day, day + 86_400, day),
        )

        aggregate = database.execute(
            "SELECT sample_count,heat_min,heat_max,heat_sum,heat_last,score_sample_count,score_sum,score_last FROM game_heat_daily WHERE game_id=7"
        ).fetchone()
        self.assertEqual(aggregate, (2, 100, 160, 260, 160, 2, 17.0, 9.0))
        no_score = database.execute(
            "SELECT score_sample_count,score_min,score_max,score_sum,score_last FROM game_heat_daily WHERE game_id=8"
        ).fetchone()
        self.assertEqual(no_score, (0, None, None, 0.0, None))

    def test_repeated_compaction_absolutely_replaces_instead_of_accumulating(self):
        compact_sql = self.extract_sql("COMPACT_DAILY_SQL")
        database = self.database()
        day = 1_800_057_600
        database.executemany(
            "INSERT INTO game_heat_hourly(game_id,captured_hour,heat,score) VALUES(?,?,?,?)",
            [(7, day + 3_600, 100, 8.0), (7, day + 7_200, 160, 9.0)],
        )
        bindings = (day, day + 86_400, day, day + 86_400, day + 90_000, day, day + 86_400, day)

        database.execute(compact_sql, bindings)
        database.execute(compact_sql, bindings)

        aggregate = database.execute(
            "SELECT sample_count,heat_sum,score_sample_count,score_sum FROM game_heat_daily WHERE game_id=7"
        ).fetchone()
        self.assertEqual(aggregate, (2, 260, 2, 17.0))

    def test_day_replacement_removes_stale_games_but_empty_retry_preserves_archive(self):
        clear_sql = self.extract_sql("CLEAR_DAILY_DAY_SQL")
        compact_sql = self.extract_sql("COMPACT_DAILY_SQL")
        database = self.database()
        day = 1_800_057_600
        database.executemany(
            "INSERT INTO game_heat_hourly(game_id,captured_hour,heat,score) VALUES(?,?,?,?)",
            [(7, day + 3_600, 100, 8.0), (8, day + 3_600, 40, None)],
        )
        compact_bindings = (day, day + 86_400, day, day + 86_400, day + 90_000, day, day + 86_400, day)
        database.execute(compact_sql, compact_bindings)
        database.execute("DELETE FROM game_heat_hourly WHERE game_id=8")

        database.execute(clear_sql, (day, day, day + 86_400, day))
        database.execute(compact_sql, compact_bindings)
        self.assertEqual(
            database.execute("SELECT game_id FROM game_heat_daily ORDER BY game_id").fetchall(),
            [(7,)],
        )

        database.execute("DELETE FROM game_heat_hourly")
        database.execute(clear_sql, (day, day, day + 86_400, day))
        self.assertEqual(
            database.execute("SELECT game_id FROM game_heat_daily ORDER BY game_id").fetchall(),
            [(7,)],
        )

    def test_hourly_deletion_is_limited_to_one_exact_utc_day(self):
        delete_sql = self.extract_sql("DELETE_HOURLY_DAY_SQL")
        database = self.database()
        day = 1_800_057_600
        database.executemany(
            "INSERT INTO game_heat_hourly(game_id,captured_hour,heat,score) VALUES(?,?,?,?)",
            [
                (7, day - 3_600, 90, 7.0),
                (7, day, 100, 8.0),
                (7, day + 82_800, 160, 9.0),
                (7, day + 86_400, 170, 9.2),
            ],
        )

        database.execute(
            "DELETE FROM game_heat_hourly WHERE captured_hour=?",
            (day - 3_600,),
        )
        database.execute(delete_sql, (day, day + 86_400, day))
        database.execute(
            "INSERT INTO game_heat_hourly(game_id,captured_hour,heat,score) VALUES(7,?,?,?)",
            (day - 3_600, 90, 7.0),
        )

        remaining = database.execute(
            "SELECT captured_hour FROM game_heat_hourly ORDER BY captured_hour"
        ).fetchall()
        self.assertEqual(remaining, [(day - 3_600,), (day + 86_400,)])

    def test_backlog_queries_continue_one_oldest_day_at_a_time(self):
        find_sql = self.extract_sql("FIND_OLDEST_PENDING_SQL")
        delete_sql = self.extract_sql("DELETE_HOURLY_DAY_SQL")
        has_more_sql = self.extract_sql("HAS_MORE_SQL")
        database = self.database()
        daily_cutoff = 1_750_032_000
        hourly_cutoff = daily_cutoff + 640 * 86_400
        event_cutoff = daily_cutoff
        expired_daily_day = daily_cutoff - 86_400
        first_hourly_day = daily_cutoff + 86_400
        second_hourly_day = first_hourly_day + 86_400
        database.execute(
            """INSERT INTO game_heat_daily(
                game_id,captured_day,first_captured_hour,last_captured_hour,
                sample_count,heat_min,heat_max,heat_sum,heat_last,
                score_sample_count,score_sum,updated_at
              ) VALUES(7,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                expired_daily_day,
                expired_daily_day,
                expired_daily_day,
                1,
                10,
                10,
                10,
                10,
                0,
                0,
                hourly_cutoff,
            ),
        )
        database.executemany(
            "INSERT INTO game_heat_hourly(game_id,captured_hour,heat,score) VALUES(?,?,?,?)",
            [
                (7, first_hourly_day + 3_600, 100, 8.0),
                (7, second_hourly_day + 3_600, 120, 8.5),
            ],
        )

        oldest = database.execute(find_sql, (hourly_cutoff, daily_cutoff)).fetchone()
        self.assertEqual(oldest, (first_hourly_day + 3_600, expired_daily_day))
        self.assertEqual(database.execute(has_more_sql, (hourly_cutoff, daily_cutoff, event_cutoff)).fetchone(), (1,))

        database.execute("DELETE FROM game_heat_daily WHERE captured_day=?", (expired_daily_day,))
        database.execute(delete_sql, (first_hourly_day, first_hourly_day + 86_400, first_hourly_day))
        self.assertEqual(database.execute(has_more_sql, (hourly_cutoff, daily_cutoff, event_cutoff)).fetchone(), (1,))

        database.execute(delete_sql, (second_hourly_day, second_hourly_day + 86_400, second_hourly_day))
        self.assertEqual(database.execute(has_more_sql, (hourly_cutoff, daily_cutoff, event_cutoff)).fetchone(), (0,))

    def test_failed_atomic_day_batch_rolls_back_archive_and_source_deletion(self):
        clear_sql = self.extract_sql("CLEAR_DAILY_DAY_SQL")
        compact_sql = self.extract_sql("COMPACT_DAILY_SQL")
        delete_sql = self.extract_sql("DELETE_HOURLY_DAY_SQL")
        database = self.database()
        day = 1_800_057_600
        next_day = day + 86_400
        database.execute(
            """INSERT INTO game_heat_daily(
                game_id,captured_day,first_captured_hour,last_captured_hour,
                sample_count,heat_min,heat_max,heat_sum,heat_last,
                score_sample_count,score_sum,updated_at
              ) VALUES(7,?,?,?,?,?,?,?,?,?,?,?)""",
            (day, day, day, 1, 999, 999, 999, 999, 0, 0, next_day),
        )
        database.executemany(
            "INSERT INTO game_heat_hourly(game_id,captured_hour,heat,score) VALUES(?,?,?,?)",
            [(7, day + 3_600, 100, 8.0), (7, day + 7_200, 160, 9.0)],
        )
        database.commit()

        with self.assertRaises(sqlite3.OperationalError):
            database.execute("BEGIN")
            database.execute(clear_sql, (day, day, next_day, day))
            database.execute(
                compact_sql,
                (day, next_day, day, next_day, next_day, day, next_day, day),
            )
            database.execute(delete_sql, (day, next_day, day))
            database.execute("INSERT INTO table_that_does_not_exist VALUES(1)")
        database.rollback()

        self.assertEqual(
            database.execute(
                "SELECT sample_count,heat_sum FROM game_heat_daily WHERE game_id=7 AND captured_day=?",
                (day,),
            ).fetchone(),
            (1, 999),
        )
        self.assertEqual(
            database.execute(
                "SELECT COUNT(*) FROM game_heat_hourly WHERE captured_hour>=? AND captured_hour<?",
                (day, next_day),
            ).fetchone(),
            (2,),
        )

    def test_schema_migrates_watermark_from_latest_archived_day(self):
        database = sqlite3.connect(":memory:")
        database.executescript("""
            CREATE TABLE game_heat_hourly (
              game_id INTEGER NOT NULL,
              captured_hour INTEGER NOT NULL,
              heat INTEGER NOT NULL,
              score REAL,
              PRIMARY KEY (game_id, captured_hour)
            );
            CREATE TABLE game_heat_daily (
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
        """)
        latest_day = 1_800_057_600
        database.executemany(
            """INSERT INTO game_heat_daily(
                 game_id,captured_day,first_captured_hour,last_captured_hour,
                 sample_count,heat_min,heat_max,heat_sum,heat_last,
                 score_sample_count,score_sum,updated_at
               ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
            [
                (7, latest_day - 86_400, latest_day - 86_400, latest_day - 86_400, 1, 1, 1, 1, 1, 0, 0, latest_day),
                (8, latest_day, latest_day, latest_day, 1, 1, 1, 1, 1, 0, 0, latest_day),
            ],
        )

        database.executescript(self.schema)

        self.assertEqual(
            database.execute(
                "SELECT archived_through FROM history_retention_state WHERE singleton=1"
            ).fetchone(),
            (latest_day + 86_400,),
        )

    def test_schema_reapply_never_lowers_existing_watermark(self):
        database = self.database()
        watermark = 1_800_144_000
        database.execute(
            "UPDATE history_retention_state SET archived_through=? WHERE singleton=1",
            (watermark,),
        )
        with self.assertRaisesRegex(sqlite3.IntegrityError, "TTMRANK_WATERMARK_REGRESSION"):
            database.execute(
                "UPDATE history_retention_state SET archived_through=? WHERE singleton=1",
                (watermark - 86_400,),
            )
        database.executescript(self.schema)
        self.assertEqual(
            database.execute(
                "SELECT archived_through FROM history_retention_state WHERE singleton=1"
            ).fetchone(),
            (watermark,),
        )

    def test_schema_reapply_raises_stale_watermark_to_latest_daily_archive(self):
        database = self.database()
        latest_day = 1_800_057_600
        database.execute(
            "UPDATE history_retention_state SET archived_through=? WHERE singleton=1",
            (latest_day - 86_400,),
        )
        database.execute(
            """INSERT INTO game_heat_daily(
                game_id,captured_day,first_captured_hour,last_captured_hour,
                sample_count,heat_min,heat_max,heat_sum,heat_last,
                score_sample_count,score_sum,updated_at
              ) VALUES(7,?,?,?,?,?,?,?,?,?,?,?)""",
            (latest_day, latest_day, latest_day, 1, 10, 10, 10, 10, 0, 0, latest_day),
        )

        database.executescript(self.schema)

        self.assertEqual(
            database.execute(
                "SELECT archived_through FROM history_retention_state WHERE singleton=1"
            ).fetchone(),
            (latest_day + 86_400,),
        )

    def test_database_guard_rejects_archived_insert_and_update_atomically(self):
        database = self.database()
        watermark = 1_800_057_600
        database.execute(
            "UPDATE history_retention_state SET archived_through=? WHERE singleton=1",
            (watermark,),
        )
        database.commit()
        with self.assertRaisesRegex(sqlite3.IntegrityError, "TTMRANK_ARCHIVED_HOUR"):
            database.execute("BEGIN")
            database.execute(
                "INSERT INTO game_heat_hourly(game_id,captured_hour,heat,score) VALUES(7,?,?,?)",
                (watermark + 3_600, 100, 8.0),
            )
            database.execute(
                "INSERT INTO game_heat_hourly(game_id,captured_hour,heat,score) VALUES(8,?,?,?)",
                (watermark - 3_600, 120, 9.0),
            )
        database.rollback()
        self.assertEqual(database.execute("SELECT COUNT(*) FROM game_heat_hourly").fetchone(), (0,))

        database.execute(
            "INSERT INTO game_heat_hourly(game_id,captured_hour,heat,score) VALUES(7,?,?,?)",
            (watermark + 3_600, 100, 8.0),
        )
        with self.assertRaisesRegex(sqlite3.IntegrityError, "TTMRANK_ARCHIVED_HOUR"):
            database.execute(
                "UPDATE game_heat_hourly SET captured_hour=? WHERE game_id=7",
                (watermark - 3_600,),
            )

        database.execute(
            "UPDATE history_retention_state SET archived_through=? WHERE singleton=1",
            (watermark + 86_400,),
        )
        with self.assertRaisesRegex(sqlite3.IntegrityError, "TTMRANK_ARCHIVED_HOUR"):
            database.execute(
                """INSERT INTO game_heat_hourly(game_id,captured_hour,heat,score)
                   VALUES(7,?,?,?) ON CONFLICT(game_id,captured_hour)
                   DO UPDATE SET heat=excluded.heat""",
                (watermark + 3_600, 200, 9.0),
            )

    def test_watermark_progress_is_monotonic_and_rolls_back_with_failed_day_batch(self):
        advance_sql = self.extract_sql("ADVANCE_ARCHIVED_THROUGH_SQL")
        database = self.database()
        day = 1_800_057_600
        next_day = day + 86_400
        database.execute(
            "INSERT INTO game_heat_hourly(game_id,captured_hour,heat,score) VALUES(7,?,?,?)",
            (day + 3_600, 100, 8.0),
        )
        database.execute(advance_sql, (next_day, day, next_day, day))
        database.execute("DELETE FROM game_heat_hourly WHERE captured_hour>=? AND captured_hour<?", (day, next_day))
        self.assertEqual(
            database.execute(
                "SELECT archived_through FROM history_retention_state WHERE singleton=1"
            ).fetchone(),
            (next_day,),
        )
        database.execute(
            "INSERT INTO game_heat_hourly(game_id,captured_hour,heat,score) VALUES(7,?,?,?)",
            (next_day + 3_600, 110, 8.2),
        )
        database.execute(advance_sql, (day, next_day, next_day + 86_400, next_day))
        self.assertEqual(
            database.execute(
                "SELECT archived_through FROM history_retention_state WHERE singleton=1"
            ).fetchone(),
            (next_day,),
        )
        database.commit()

        with self.assertRaises(sqlite3.OperationalError):
            database.execute("BEGIN")
            database.execute(advance_sql, (next_day + 86_400, next_day, next_day + 86_400, next_day))
            database.execute("INSERT INTO table_that_does_not_exist VALUES(1)")
        database.rollback()
        self.assertEqual(
            database.execute(
                "SELECT archived_through FROM history_retention_state WHERE singleton=1"
            ).fetchone(),
            (next_day,),
        )

    def test_stale_day_selection_does_not_mutate_after_an_earlier_hour_appears(self):
        clear_sql = self.extract_sql("CLEAR_DAILY_DAY_SQL")
        compact_sql = self.extract_sql("COMPACT_DAILY_SQL")
        advance_sql = self.extract_sql("ADVANCE_ARCHIVED_THROUGH_SQL")
        delete_sql = self.extract_sql("DELETE_HOURLY_DAY_SQL")
        database = self.database()
        day = 1_800_057_600
        next_day = day + 86_400
        database.execute(
            """INSERT INTO game_heat_daily(
                game_id,captured_day,first_captured_hour,last_captured_hour,
                sample_count,heat_min,heat_max,heat_sum,heat_last,
                score_sample_count,score_sum,updated_at
              ) VALUES(7,?,?,?,?,?,?,?,?,?,?,?)""",
            (day, day, day, 1, 999, 999, 999, 999, 0, 0, next_day),
        )
        database.executemany(
            "INSERT INTO game_heat_hourly(game_id,captured_hour,heat,score) VALUES(?,?,?,?)",
            [
                (7, day + 3_600, 100, 8.0),
                # This row represents an ingest that won the race after the
                # Worker selected `day` outside its mutation batch.
                (8, day - 3_600, 80, 7.5),
            ],
        )

        database.execute(clear_sql, (day, day, next_day, day))
        database.execute(
            compact_sql,
            (day, next_day, day, next_day, next_day, day, next_day, day),
        )
        database.execute(advance_sql, (next_day, day, next_day, day))
        database.execute(delete_sql, (day, next_day, day))

        self.assertEqual(
            database.execute(
                "SELECT sample_count,heat_sum FROM game_heat_daily WHERE game_id=7 AND captured_day=?",
                (day,),
            ).fetchone(),
            (1, 999),
        )
        self.assertEqual(database.execute("SELECT COUNT(*) FROM game_heat_hourly").fetchone(), (2,))
        self.assertEqual(
            database.execute(
                "SELECT archived_through FROM history_retention_state WHERE singleton=1"
            ).fetchone(),
            (0,),
        )


if __name__ == "__main__":
    unittest.main()
