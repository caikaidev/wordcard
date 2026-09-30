-- 每次调用 Gemini 的 token 用量，用于设置页的费用预估
CREATE TABLE IF NOT EXISTS usage (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            INTEGER NOT NULL,           -- 毫秒时间戳
  kind          TEXT    NOT NULL,           -- enrich | remix | tts
  model         TEXT    NOT NULL,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0  -- 含思考 token（按输出计费）
);
CREATE INDEX IF NOT EXISTS idx_usage_ts ON usage (ts);
