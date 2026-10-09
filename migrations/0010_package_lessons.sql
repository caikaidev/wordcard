-- 为学习包生成的练习：记录每套练习用了包里的哪些卡片，用来显示进度、下一套避开已练过的词
ALTER TABLE lessons ADD COLUMN package_id INTEGER;
CREATE TABLE IF NOT EXISTS lesson_cards (
  lesson_id INTEGER NOT NULL,
  user_id   TEXT    NOT NULL,
  item_id   INTEGER NOT NULL,
  PRIMARY KEY (lesson_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_lesson_cards_item ON lesson_cards (user_id, item_id);
