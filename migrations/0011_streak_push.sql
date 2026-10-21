-- 打卡：一天一行。done = 当天完成了每日目标（复习够数，或做了练习）；freeze = 断签那天用掉了一张「连胜保护」
CREATE TABLE IF NOT EXISTS checkins (
  user_id    TEXT    NOT NULL,
  day        INTEGER NOT NULL,                -- 北京时间的日序号：floor((ts + 8h) / 1 天)
  kind       TEXT    NOT NULL DEFAULT 'done' CHECK (kind IN ('done', 'freeze')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
);

-- 每个人的连胜状态：手里的保护卡、历史最长连续天数
CREATE TABLE IF NOT EXISTS streaks (
  user_id TEXT    PRIMARY KEY,
  freezes INTEGER NOT NULL DEFAULT 0,
  best    INTEGER NOT NULL DEFAULT 0
);

-- 旧数据补成打卡：练习过的日子，以及复习满 5 张（默认每日目标）的日子
INSERT OR IGNORE INTO checkins (user_id, day, kind, created_at)
SELECT user_id, CAST((created_at + 28800000) / 86400000 AS INTEGER), 'done', MIN(created_at)
FROM submissions WHERE user_id != '' GROUP BY 1, 2;

INSERT OR IGNORE INTO checkins (user_id, day, kind, created_at)
SELECT user_id, CAST((ts + 28800000) / 86400000 AS INTEGER), 'done', MIN(ts)
FROM reviews WHERE user_id != '' GROUP BY 1, 2 HAVING COUNT(*) >= 5;

-- Web Push 订阅：一个设备（浏览器）一行
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint   TEXT    PRIMARY KEY,
  user_id    TEXT    NOT NULL,
  p256dh     TEXT    NOT NULL,
  auth       TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subs (user_id);
