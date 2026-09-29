-- 词条表：单词和句子共用一张表
CREATE TABLE IF NOT EXISTS items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT    NOT NULL CHECK (type IN ('word', 'sentence')),
  text       TEXT    NOT NULL,
  meta       TEXT    NOT NULL DEFAULT '{}',          -- JSON：音标/释义/例句/短语
  status     TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'done')),
  interval   REAL    NOT NULL DEFAULT 0,             -- 当前间隔（天）
  due_at     INTEGER NOT NULL,                       -- 下次复习时间（毫秒时间戳）
  reps       INTEGER NOT NULL DEFAULT 0,             -- 复习次数
  lapses     INTEGER NOT NULL DEFAULT 0,             -- 忘记次数
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_items_text ON items (text COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_items_due ON items (status, due_at);
