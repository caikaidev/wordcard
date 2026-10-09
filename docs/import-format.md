# 学习包导入格式 `shiju-import-v1`

把一本书 / 一篇文章做成 UTF-8 编码的 `.json`，在「拾句」词库页点「＋ 导入学习包」上传。内容已预置完整，网站导入时**不调 AI、不补全**，单包最多 500 张卡片。

- 示例文件：[`examples/mom-test-sample.json`](examples/mom-test-sample.json)
- 这份文档的原始文本（适合直接交给 AI 助手）：<https://raw.githubusercontent.com/caikaidev/wordcard/main/docs/import-format.md>

---

## 给 AI 助手：怎么生成学习包

> 如果你是 AI 助手，用户把这份文档的链接发给了你，请按下面的步骤，用用户提供的英文资料生成一个学习包 JSON。

### 步骤

1. **读完资料**。资料可以是文章、书的章节、字幕、笔记。分章节的资料给每章起一个简短的 key（如 `Ch1`、`conclusion`），用作每张卡片的 `source_ref`。
2. **挑词**。选对学习者有价值的词、词组和地道的短句，优先日常口语和职场表达，跳过过于基础的词。除非用户另有要求，一个包 30–200 张比较合适；超过 500 张要拆成多个包。
3. **每张卡片都从原文取例句**。`example_en` 必须是原文里真实出现的句子，且包含 `term`（词形变化可以，如 term 是 `compliment`，句中是 `compliments`）。不要自己编例句。
4. **补全其余字段**：`definition_cn` 写这个词在**这个语境里**的意思；`example_cn` 翻译整个例句；`phonetic` 用美式音标；可选地写 `memory_tip`（谐音、拆词、画面）。
5. **整理 `difficulty_order`**（可选）：把章节 key 按建议的学习顺序排好，由易到难；卡片的 `source_ref` 与它忽略大小写匹配。
6. **自查后再输出**（见下面的清单）。
7. **输出**：只给一个 JSON 文件（或一个 JSON 代码块），不要在 JSON 里加注释，不要有多余文字。

### 自查清单

- [ ] `format` 是 `shiju-import-v1`，`package.title` 非空
- [ ] 每张卡片都有 `term`、`definition_cn`、`example_en`、`example_cn` 四个必填字段
- [ ] 每个 `example_en` 都能在原文里找到（抽查，或用搜索逐条核对），并且包含对应的 `term`
- [ ] `term` 没有重复（忽略大小写）
- [ ] `source_ref` 的写法在整个包里一致，且都出现在 `difficulty_order` 里（如果写了 `difficulty_order`）
- [ ] `difficulty` 如果写了，是 1–5 的整数
- [ ] `source_url` 如果写了，以 `http://` 或 `https://` 开头
- [ ] 是合法 JSON：没有注释，没有末尾多余的逗号，字符串里的引号已转义
- [ ] 卡片不超过 500 张

### 常见错误

| 错误 | 后果 |
|---|---|
| 自己编例句，原文里没有 | 语境复习（原句挖空）失去意义 |
| `example_en` 里没有 `term` | 这张卡无法做挖空练习，只能认读 |
| 缺少必填字段 | 这张卡被忽略，导入报告里会列出 |
| 同一个词出现两次 | 后一张被当作已存在而跳过 |
| `format` 写错或缺失 | 整个文件被拒绝：「不支持的导入格式版本」 |

---

## 顶层

| 字段 | 必填 | 说明 |
|---|---|---|
| `format` | 是 | 固定 `shiju-import-v1` |
| `package.title` | 是 | 包名，词库按它分组；同名包会合并 |
| `package.source_url` / `source_type` / `created_at` / `card_count` | 否 | 原文链接（仅 http(s)）/ `book`·`article`·`video` / `YYYY-MM-DD` / 卡片数 |
| `package.difficulty_order` | 否 | 建议学习顺序（章节 key，与卡片的 `source_ref` 忽略大小写匹配）。复习时先学靠前的 |
| `cards` | 是 | 卡片数组 |

## 卡片

| 字段 | 必填 | 说明 |
|---|---|---|
| `term` | 是 | 单词 / 词组 / 短句 |
| `definition_cn` | 是 | 中文释义，多义用分号分隔 |
| `example_en` / `example_cn` | 是 | 原文例句及翻译 |
| `phonetic` / `pos` | 否 | 美式音标 / 词性 |
| `phrases` | 否 | 相关词组，字符串数组（最多 5 个） |
| `memory_tip` | 否 | 记忆钩子，显示在卡片背面 |
| `source_ref` | 否 | 来源章节，如 `Ch2` |
| `difficulty` | 否 | 1–5 |

## 最小示例

```json
{
  "format": "shiju-import-v1",
  "package": { "title": "The Mom Test", "source_type": "book", "difficulty_order": ["ch1", "ch2"] },
  "cards": [
    {
      "term": "compliment",
      "phonetic": "/ˈkɑːmplɪmənt/",
      "pos": "n./v.",
      "definition_cn": "恭维；赞美",
      "example_en": "You want facts and commitments, not compliments.",
      "example_cn": "你想要的是事实和承诺，而不是恭维。",
      "source_ref": "Ch2"
    }
  ]
}
```

## 导入行为

- 校验 `format`；版本不识别 → 「不支持的导入格式版本」；`cards` 不是数组 → 报错。
- 缺少必填字段的卡片被忽略，并在报告里列出。
- 去重：`term` 与词库里已有的卡片相同（忽略大小写，不限包）→ 跳过，报告「新增 X 条，跳过 Y 条」。
- 全部进入「进行中」，归属到该学习包；包内卡片全部 DONE = 学完。
- 前端每 100 张一批提交并显示进度；中途失败后重新选同一个文件即可继续（已导入的自动跳过）。
- 导入后可在词库页按包筛选，并「为这个包生成练习」。

## 版本演进

后续版本只新增可选字段，不删除、不改必填，旧包永远可导入；破坏性变更才升大版本。
