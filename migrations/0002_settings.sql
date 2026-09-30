-- 页面上可修改的设置（模型、音色等），覆盖 wrangler.jsonc 里的默认值
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
