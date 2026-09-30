-- 多用户：每条数据记录属于谁（Cloudflare Access 登录邮箱）。
-- 旧数据 user_id 为空，管理员（ADMIN_EMAILS）第一次访问时自动认领。
ALTER TABLE items ADD COLUMN user_id TEXT NOT NULL DEFAULT '';
ALTER TABLE lessons ADD COLUMN user_id TEXT NOT NULL DEFAULT '';
ALTER TABLE submissions ADD COLUMN user_id TEXT NOT NULL DEFAULT '';
ALTER TABLE usage ADD COLUMN user_id TEXT NOT NULL DEFAULT '';

-- 同一个人不能重复添加同一个词，不同人可以
DROP INDEX IF EXISTS idx_items_text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_items_user_text ON items (user_id, text COLLATE NOCASE);
DROP INDEX IF EXISTS idx_items_due;
CREATE INDEX IF NOT EXISTS idx_items_user_due ON items (user_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_lessons_user ON lessons (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_submissions_user ON submissions (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_user ON usage (user_id, ts);

-- 每个人自己的设置（教练设定、练习档位、复习方式）；模型、音色仍在全局 settings 表
CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT NOT NULL,
  key     TEXT NOT NULL,
  value   TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);
