-- 练习保存原文，用于应用内阅读（点词查义、收藏）；截图生成的练习没有原文
ALTER TABLE lessons ADD COLUMN source_text TEXT;
