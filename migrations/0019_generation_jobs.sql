-- Background generation is optional, idempotent per user+lesson+kind.
-- Quota and lifecycle are tracked separately from completed AI usage.
CREATE TABLE IF NOT EXISTS generation_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  lesson_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('quest')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','done','failed')),
  attempt INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  error TEXT,
  UNIQUE(user_id, lesson_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_generation_jobs_quota ON generation_jobs(started_at, status, user_id);
CREATE INDEX IF NOT EXISTS idx_generation_jobs_state ON generation_jobs(status, lease_until);
