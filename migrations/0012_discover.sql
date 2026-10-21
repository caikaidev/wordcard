-- 发现新词：从 HN / Reddit 找出来、AI 挑过的候选词。new 待定 / added 已加入词库 / known 已认识
CREATE TABLE IF NOT EXISTS discoveries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT    NOT NULL,
  text       TEXT    NOT NULL,
  meta       TEXT    NOT NULL DEFAULT '{}',      -- JSON：CardMeta + why
  source     TEXT    NOT NULL DEFAULT '',        -- HN / r/xxx
  url        TEXT,                               -- 例句原帖
  hits       INTEGER NOT NULL DEFAULT 0,         -- 出现在多少条内容里
  status     TEXT    NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'added', 'known')),
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_discoveries_user_text ON discoveries (user_id, text COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_discoveries_user_status ON discoveries (user_id, status, created_at);

-- 标记为「认识」的词：以后发现新词时跳过
CREATE TABLE IF NOT EXISTS known_words (
  user_id    TEXT    NOT NULL,
  word       TEXT    NOT NULL COLLATE NOCASE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, word)
);
