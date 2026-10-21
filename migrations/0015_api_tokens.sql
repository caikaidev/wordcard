-- 外部调用用的个人令牌：只存哈希，明文只在创建时显示一次
CREATE TABLE IF NOT EXISTS api_tokens (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT    NOT NULL,
  name         TEXT    NOT NULL,
  hash         TEXT    NOT NULL UNIQUE,         -- SHA-256(令牌) 的十六进制
  prefix       TEXT    NOT NULL,                -- 令牌开头几位，列表里用来辨认
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens (user_id);
