-- 分级短文阶梯：读完哪几篇。只追加，不改已有词库。
CREATE TABLE IF NOT EXISTS passage_reads (
  user_id      TEXT    NOT NULL,
  passage_id   TEXT    NOT NULL,
  completed_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, passage_id)
);
