-- 每次复习评分的流水，用于每周回顾（从上线这一刻起记录）
CREATE TABLE IF NOT EXISTS reviews (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT    NOT NULL,
  item_id INTEGER NOT NULL,
  grade   INTEGER NOT NULL,          -- 0 忘了 / 1 模糊 / 2 记得
  ts      INTEGER NOT NULL           -- 毫秒时间戳
);
CREATE INDEX IF NOT EXISTS idx_reviews_user_ts ON reviews (user_id, ts);
