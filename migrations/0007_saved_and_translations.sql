-- 稍后学：只存链接和原文，想学时再生成练习
CREATE TABLE IF NOT EXISTS saved (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT    NOT NULL,
  url        TEXT,
  title      TEXT    NOT NULL DEFAULT '',
  text       TEXT,                           -- 原文；保存时没读到就为空，打开时再读
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_saved_user ON saved (user_id, created_at);

-- 阅读时的段落翻译缓存：按段落内容的哈希存，同一段只翻译一次
CREATE TABLE IF NOT EXISTS translations (
  user_id    TEXT    NOT NULL,
  hash       TEXT    NOT NULL,
  zh         TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, hash)
);
