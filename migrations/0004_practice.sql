-- 练习：一篇文章生成一份练习（生词 / 句式 / 3 句输出任务 / 口语题）
CREATE TABLE IF NOT EXISTS lessons (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  level      INTEGER NOT NULL DEFAULT 1,      -- 1 入门·填空 / 2 进阶·引导 / 3 挑战·自由
  source_url TEXT,
  title      TEXT    NOT NULL DEFAULT '',
  content    TEXT    NOT NULL                 -- JSON：LessonContent
);
CREATE INDEX IF NOT EXISTS idx_lessons_created ON lessons (created_at);

-- 每一次提交（逐句）及 AI 批改结果
CREATE TABLE IF NOT EXISTS submissions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id  INTEGER NOT NULL REFERENCES lessons (id) ON DELETE CASCADE,
  idx        INTEGER NOT NULL,                -- 第几句：0 讲清楚 / 1 有观点 / 2 连到自己
  attempt    INTEGER NOT NULL,                -- 这句的第几次提交，从 1 开始
  text       TEXT    NOT NULL,
  passed     INTEGER NOT NULL DEFAULT 0,
  result     TEXT    NOT NULL,                -- JSON：GradeResult
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_submissions_lesson ON submissions (lesson_id, idx);
CREATE INDEX IF NOT EXISTS idx_submissions_created ON submissions (created_at);
