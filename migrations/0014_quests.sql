-- 闯关：每份练习一套题库（AI 出一次，反复用）和闯关进度
CREATE TABLE IF NOT EXISTS quests (
  lesson_id  INTEGER PRIMARY KEY,
  user_id    TEXT    NOT NULL,
  content    TEXT    NOT NULL,                -- JSON：QuestContent
  progress   TEXT    NOT NULL DEFAULT '{"stages":{},"xp":0}',  -- JSON：QuestProgress
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quests_user ON quests (user_id, updated_at);
