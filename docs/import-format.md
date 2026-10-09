# 学习包导入格式 `shiju-import-v1`

助手把一本书 / 一篇文章做成 UTF-8 编码的 `.json`，在词库页「导入学习包」上传。内容已预置完整，网站导入时**不调 AI、不补全**。单包最多 500 张卡片。示例：[`examples/mom-test-sample.json`](examples/mom-test-sample.json)。

## 顶层

| 字段 | 必填 | 说明 |
|---|---|---|
| `format` | 是 | 固定 `shiju-import-v1` |
| `package.title` | 是 | 包名，词库按它分组；同名包会合并 |
| `package.source_url` / `source_type` / `created_at` / `card_count` | 否 | 原文链接 / `book`·`article`·`video` / `YYYY-MM-DD` / 卡片数 |
| `package.difficulty_order` | 否 | 建议学习顺序（章节 key，与卡片的 `source_ref` 忽略大小写匹配）。复习时先学靠前的 |
| `cards` | 是 | 卡片数组 |

## 卡片

| 字段 | 必填 | 说明 |
|---|---|---|
| `term` | 是 | 单词 / 词组 / 短句 |
| `definition_cn` | 是 | 中文释义 |
| `example_en` / `example_cn` | 是 | 原文例句及翻译 |
| `phonetic` / `pos` | 否 | 美式音标 / 词性 |
| `phrases` | 否 | 相关词组，字符串数组（最多 5 个） |
| `memory_tip` | 否 | 记忆钩子，显示在卡片背面 |
| `source_ref` | 否 | 来源章节，如 `Ch2` |
| `difficulty` | 否 | 1–5 |

## 导入行为

- 校验 `format`；版本不识别 → 「不支持的导入格式版本」；`cards` 不是数组 → 报错。
- 缺少必填字段的卡片被忽略，并在报告里列出。
- 去重：`term` 与词库里已有的卡片相同（忽略大小写，不限包）→ 跳过，报告「新增 X 条，跳过 Y 条」。
- 全部进入「进行中」，归属到该学习包；包内卡片全部 DONE = 学完。
- 前端每 100 张一批提交并显示进度；中途失败后重新选同一个文件即可继续（已导入的自动跳过）。

## 版本演进

后续版本只新增可选字段，不删除、不改必填，旧包永远可导入；破坏性变更才升大版本。
