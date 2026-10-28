-- Existing/imported banks remain complete; only newly generated banks use the buffer.
ALTER TABLE quests ADD COLUMN ready_phase TEXT NOT NULL DEFAULT 'complete'
  CHECK(ready_phase IN ('starter', 'complete'));

-- Extend the kind constraint while preserving ids (already queued messages use them).
CREATE TABLE generation_jobs_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  lesson_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('quest', 'quest_tail')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','done','failed')),
  attempt INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  error TEXT,
  lease_owner TEXT NOT NULL DEFAULT '',
  UNIQUE(user_id, lesson_id, kind)
);
INSERT INTO generation_jobs_v2
  (id,user_id,lesson_id,kind,status,attempt,lease_until,created_at,updated_at,started_at,error)
SELECT id,user_id,lesson_id,kind,status,attempt,lease_until,created_at,updated_at,started_at,error
FROM generation_jobs;
DROP TABLE generation_jobs;
ALTER TABLE generation_jobs_v2 RENAME TO generation_jobs;
CREATE INDEX idx_generation_jobs_quota ON generation_jobs(created_at, user_id);
CREATE INDEX idx_generation_jobs_state ON generation_jobs(status, lease_until);

-- Shared by interactive generation and Queue consumers, not just one Worker isolate.
CREATE TABLE quest_generation_locks (
  lesson_id INTEGER PRIMARY KEY,
  owner TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
