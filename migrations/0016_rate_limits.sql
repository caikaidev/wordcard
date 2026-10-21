-- 外部接口限流：固定时间窗计数。key 形如 import:<用户> / authfail:<IP>
CREATE TABLE IF NOT EXISTS rate_limits (
  key          TEXT    PRIMARY KEY,
  window_start INTEGER NOT NULL,              -- 当前窗口开始时间（毫秒）
  count        INTEGER NOT NULL
);
