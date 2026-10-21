# 练习导入格式 `shiju-lesson-v1`

把**一篇英文文章**按这个格式整理成 UTF-8 编码的 JSON，传给「拾句」就会生成一份练习。可以只给原文，让拾句的 AI 出题；也可以把练习内容和闯关题库都整理好一起传进来，这样导入时**完全不调 AI**。

- 示例文件：[`examples/lesson-sample.json`](examples/lesson-sample.json)
- 这份文档的原始文本（适合直接交给 AI 助手）：<https://raw.githubusercontent.com/caikaidev/wordcard/main/docs/lesson-format.md>

## 两种传法

**1. 页面上传**：练习页「最近的练习」右边点「＋ 导入 JSON」，选文件。带了闯关题库的话，导入后直接进入闯关。

**2. 接口调用**（给脚本、快捷指令、AI 助手用）：

```bash
curl -X POST https://你的域名/api/ext/lessons \
  -H "Authorization: Bearer shiju_你的令牌" \
  -H "Content-Type: application/json" \
  -d @lesson.json
```

- 令牌在设置页「API 令牌」里创建，明文只显示一次；不用了随时删除。
- 部署者需要先在 Cloudflare Access 里给 `/api/ext` 放行，见[部署指南 7.5](self-hosting.md#75-给外部接口放行可选)。
- 可以先用 `GET /api/ext/me`（同样带令牌）测试，返回令牌对应的邮箱。

成功返回 `201`：

```json
{ "id": 51, "title": "…", "generatedLesson": false, "hasQuest": true, "dropped": 0, "url": "https://你的域名/practice/51/path" }
```

| 字段 | 说明 |
|---|---|
| `generatedLesson` | `true` 表示没传 `lesson`，练习内容是 AI 根据原文生成的（花一次 AI 调用） |
| `hasQuest` | 传了可用的闯关题库，`url` 直接指向闯关页 |
| `dropped` | 不完整、被跳过的题目数（见下面每种题的要求） |

格式不对返回 `400`，`error` 里用中文说明缺了什么；令牌不对返回 `401`。

### 鉴权与限流

| 规则 | 默认 | 超出时 |
|---|---|---|
| 必须带个人令牌 `Authorization: Bearer shiju_…` | — | `401` |
| 同一 IP 10 分钟内令牌错 10 次 | 之后 10 分钟内这个 IP 的请求一律拒绝（包括正确的令牌） | `429` |
| 同一个人两次导入的间隔 | 180 秒（换令牌也绕不过） | `429` |
| 同一个人 24 小时内的导入次数 | 30 次（从这一轮第一次调用开始算） | `429` |
| 请求体大小 | 1 MB | `413` |

- `429` 会带 `Retry-After` 响应头（秒）和 `retryAfter` 字段，脚本照着等就行。
- 格式错误（`400`）不计入次数，调试时不会被卡住；格式正确但 AI 出题失败的那次会计入。
- `GET /api/ext/me` 会返回当前生效的限流设置。部署者可以在 `wrangler.jsonc` 里改 `EXT_IMPORT_INTERVAL`（秒）和 `EXT_IMPORT_DAILY_LIMIT`。
- 令牌是 24 字节随机数，服务器只存它的 SHA-256；令牌泄露了就在设置页删掉，立刻失效。

---

## 给 AI 助手：怎么整理

> 如果你是 AI 助手，用户把这份文档发给了你，请按下面的步骤，把用户给的英文文章整理成一个 JSON。

1. **原文**放进 `text`，保持原样（去掉导航、广告即可），不要改写。
2. **练习内容** `lesson`：挑最多 5 个生词（`words`，必须是文章里出现过的，`quote` 是包含它的原句）、2–3 个可以直接用的句式（`expressions`）、固定 3 个写作任务（`tasks`：讲清楚 / 有观点 / 连到自己）、1–2 个口语题（`speaking`）。讲解用中文，示例用英文。
3. **闯关题库** `quest`（可选，但强烈建议）：按下面四种题出题，干扰项要「看起来合理但意思不对」，不能也是对的。
4. **自查**后只输出一个 JSON，不要注释，不要多余文字。

### 自查清单

- [ ] `format` 是 `shiju-lesson-v1`，有 `title`
- [ ] 至少有 `text` 或 `lesson` 之一；`text` 不超过 10 万字符
- [ ] `lesson.words[].quote` 和 `quest.cloze[].sentence`、`quest.reading[].passage` 都能在原文里找到
- [ ] 每道选择题有 1 个正确答案 + 3 个干扰项，干扰项和答案不重复
- [ ] `cloze[].sentence` 里**恰好有一个** `____`（四个下划线）
- [ ] `listening[].extra` 是 2 个单词，不含空格
- [ ] 是合法 JSON：没有注释、没有末尾多余的逗号

---

## 顶层

| 字段 | 必填 | 说明 |
|---|---|---|
| `format` | 是 | 固定 `shiju-lesson-v1` |
| `title` | 是* | 标题。只给 `text` 不给 `title` 时用 AI 起的标题 |
| `text` | 二选一 | 文章原文，最多 10 万字符。闯关的「读原文」、点词查义都用它 |
| `lesson` | 二选一 | 整理好的练习内容；不给就由 AI 根据 `text` 生成 |
| `quest` | 否 | 闯关题库；不给就在第一次进入闯关时由 AI 生成 |
| `source_url` | 否 | 原文链接，仅 http(s) |
| `level` | 否 | 档位 1 入门·填空 / 2 进阶·引导 / 3 挑战·自由，不给用设置里的默认档位 |

## `lesson`

| 字段 | 说明 |
|---|---|
| `summary` | 一句英文概括 |
| `fit` / `fitNote` | 难度判断 `ok` / `hard` / `easy`，和一句中文说明（可省略） |
| `words` | 最多 5 个：`word`、`ipa`（美式音标，可空）、`meaning`（中文）、`quote`（原文里的句子） |
| `expressions` | 最多 3 个：`pattern`（用 `...` 表示可替换部分）、`meaning`、`example` |
| `tasks` | 3 个写作任务：`goal`（讲清楚 / 有观点 / 连到自己）、`prompt`（中文要求）、`template`（填空模板或句子开头，挑战档留空） |
| `speaking` | 最多 2 个：`question`（英文）、`hint`（中文思路） |

## `quest`：四种题

每种题不完整就会被跳过，并计入返回的 `dropped`。

| 字段 | 每条 | 用在哪一关 | 要求 |
|---|---|---|---|
| `words` | `en`、`zh`、`distractors` | 认词：配对、看词选意思 | 最多 6 条；`zh` 10 个字以内；`distractors` 3 个中文干扰项（至少 2 个） |
| `listening` | `en`、`zh`、`distractors`、`extra` | 听：听句子选意思、听句子排单词 | 最多 4 条；`en` 6–14 个词；`distractors` 3 个中文干扰翻译；`extra` 2 个干扰单词 |
| `cloze` | `sentence`、`answer`、`distractors`、`zh` | 读：选词填空 | 最多 3 条；`sentence` 恰好一个 `____`；`answer` 是被挖掉的原词；`distractors` 3 个同词性英文干扰词 |
| `reading` | `passage`、`questions[]` | 读：理解题 | 最多 2 段，每段 40–90 词原文；`questions` 每段 1–2 题：`question`、`answer`、`distractors`（中文）、`explain`（一句中文解析） |

完整例子见 [`examples/lesson-sample.json`](examples/lesson-sample.json)。
