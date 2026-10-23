-- One editable response per user/lesson/stage; replaying does not multiply samples.
CREATE TABLE IF NOT EXISTS quest_feedback (
  user_id TEXT NOT NULL,
  lesson_id INTEGER NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('words', 'listen', 'read', 'speak')),
  difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'right', 'hard')),
  accuracy REAL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, lesson_id, stage)
);
CREATE INDEX IF NOT EXISTS idx_quest_feedback_recent ON quest_feedback(user_id, created_at DESC);
