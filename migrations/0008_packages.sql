-- 学习包：一篇文章 / 一本书对应一个包，导入的卡片归属于它
CREATE TABLE IF NOT EXISTS packages (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          TEXT    NOT NULL,
  title            TEXT    NOT NULL,
  source_url       TEXT,
  source_type      TEXT,
  difficulty_order TEXT,                      -- JSON：建议学习顺序（章节 key 数组）
  created_at       INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_packages_user_title ON packages (user_id, title COLLATE NOCASE);

-- 卡片所属的包、在原文中的出处（如 Ch2）、难度 1–5
ALTER TABLE items ADD COLUMN package_id INTEGER;
ALTER TABLE items ADD COLUMN source_ref TEXT;
ALTER TABLE items ADD COLUMN difficulty INTEGER;
CREATE INDEX IF NOT EXISTS idx_items_package ON items (user_id, package_id);
