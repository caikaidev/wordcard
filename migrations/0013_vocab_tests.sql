-- 词汇评级测试：开始时存下抽到的词（含假词和释义），交卷后写入估算结果
CREATE TABLE IF NOT EXISTS vocab_tests (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT    NOT NULL,
  words      TEXT    NOT NULL,                -- JSON：[{ word, rank, meaning }]，rank = 0 表示假词
  vocab      INTEGER,                         -- 估算词汇量；还没交卷为空
  bands      TEXT,                            -- JSON：每段认识的比例
  created_at INTEGER NOT NULL,
  done_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_vocab_tests_user ON vocab_tests (user_id, done_at);
