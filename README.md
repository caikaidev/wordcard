# 词句卡 · wordcard

一个自用的英语词句复习小站：输入单词或句子，Gemini 自动补全音标、释义、例句；按遗忘曲线复习；AI 用待复习的词重新造句；每个词句都能听 Gemini 的自然语音。部署在 Cloudflare 上，用 Zero Trust 登录保护，手机和电脑都能用。

| 复习 | 添加 | 词库 | AI 重组 |
|---|---|---|---|
| 卡片翻转，忘了 / 模糊 / 记得 三档评分 | AI 补全预览，点文字直接改 | 搜索、左滑标记 DONE 或删除 | 用到期词造 3 句，连续播放 |

电脑端快捷键：`空格` 翻转 · `1/2/3` 评分 · `P` 播放 · `D` 标记 DONE。自动跟随系统深色模式。

**PWA**：可"添加到主屏幕"全屏使用。Service Worker（`public/sw.js`）缓存页面代码和听过的语音——打开秒开、听过的发音断网也能播；词库数据始终实时从服务器读取。英文字体随项目打包，中文用系统字体，不依赖 Google Fonts。建议把 Cloudflare Access 的 Session Duration 设为 7 天以上，免得频繁登录。

## 练习（英语教练）

「练习」tab 把"读文章 → 输出 → 批改"做成固定流程：

1. **新练习**：发链接、粘贴正文或上传截图（Reddit 这类打不开的页面用截图），AI 按档位出：难度判断、一句话概要、最多 5 个生词、2–3 个面试句式、3 句输出任务（讲清楚 / 有观点 / 连到自己）、口语题
2. **逐句提交**：AI 按设定批改——只改真正的错误、每次只说一个最重要的改进点、先给提示；通过或改过两次后才显示参考版本；4 项评分
3. **一键加入复习**：生词、句式、批改里"值得记"的表达，点 ⊕ 就变成复习卡片
4. **打卡统计**：本月打卡天数、完成练习数（目标各 20）、连续天数；昨天没练会提醒"不连断两天"

三个档位（设置里选默认，新建时可临时切换）：**入门·填空**（填空模板，15 词内，可写中文括号）/ **进阶·引导**（给句子开头，25 词内）/ **挑战·自由**（只给目标，至少用 1 个今天的句式）。设置页的「教练设定」写你的背景和目标，出题和批改都会参考。

## 架构

```
浏览器 ──► Cloudflare Access（只放行你的邮箱）
            │
            ▼
        Worker（Hono）
        ├── 静态页面：React + Vite + Tailwind（dist/）
        ├── /api/*  ── 再校验一次 Access JWT
        ├── D1  ── 词条与复习进度
        ├── R2  ── TTS 音频缓存（同一句只生成一次）
        └── Gemini API（key 只存在 Worker Secret 里，前端拿不到）
```

目录：`src/` 前端，`worker/` 后端，`shared/` 两端共用的类型和复习算法，`migrations/` 数据库结构。

## 一次性准备（约 15 分钟）

### 1. Gemini API Key

到 [Google AI Studio](https://aistudio.google.com/apikey) 创建 key。建议在 Google Cloud 控制台给它加上 API 限制（只允许 Generative Language API）和预算提醒。

### 2. Cloudflare 资源

需要 Node 22+。在本仓库目录执行：

```bash
npm install
npx wrangler login
npx wrangler d1 create wordcard          # 记下输出里的 database_id
npx wrangler r2 bucket create wordcard-audio
```

`database_id` 可以直接填进 `wrangler.jsonc`，也可以放到下面的 GitHub Secret `D1_DATABASE_ID` 里（CI 会自动替换）。

### 3. GitHub Secrets

仓库 → Settings → Secrets and variables → Actions → New repository secret：

| 名称 | 值 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens → 用「Edit Cloudflare Workers」模板创建，再加上 **D1: Edit** 权限 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 控制台右侧栏的 Account ID |
| `D1_DATABASE_ID` | 第 2 步的 database_id（已写进 wrangler.jsonc 的话可以不填） |
| `GEMINI_API_KEY` | 第 1 步的 key |
| `ACCESS_TEAM_DOMAIN` | 第 5 步的团队域名，如 `yourteam.cloudflareaccess.com` |
| `ACCESS_AUD` | 第 5 步的 Application Audience (AUD) Tag |

### 4. 首次部署

推送到 `main`（或在 Actions 里手动运行 Deploy）。工作流会：构建前端 → 执行 D1 迁移 → 上传 Secret → 部署 Worker。之后每次 push 都自动发布。

> 第 5 步拿到 AUD 之前，线上 `/api` 会返回"未配置 Cloudflare Access"——这是故意的：没配好登录就拒绝一切请求。

### 5. 用 Zero Trust 加登录

部署后会得到 `https://wordcard.<你的子域>.workers.dev`。二选一：

- **最简单（workers.dev）**：Workers & Pages → wordcard → Settings → Domains & Routes → workers.dev 那一行打开 **Cloudflare Access**。它会自动建好一个 Access 应用。
- **自定义域名**：在 `wrangler.jsonc` 里打开 `routes` 填你的域名、把 `workers_dev` 改成 `false`；然后 Zero Trust → Access → Applications → Add → Self-hosted，域名填这个域名。

然后在这个 Access 应用里：

1. Policy：Action = Allow，Include → Emails = 你的邮箱（登录方式用默认的 One-time PIN 邮箱验证码即可）。
2. 复制应用概览里的 **Application Audience (AUD) Tag** → GitHub Secret `ACCESS_AUD`。
3. Zero Trust → Settings → Custom Pages 里能看到团队域名 `xxx.cloudflareaccess.com` → GitHub Secret `ACCESS_TEAM_DOMAIN`。
4. 在 Actions 里重新运行一次 Deploy。

Worker 里的 `requireAccess` 会校验每个 `/api` 请求上的 Access JWT（签名、签发方、AUD），所以就算有人绕开 Access 直接打接口，也拿不到数据、刷不了你的 Gemini 额度。

## 本地开发

```bash
cp .dev.vars.example .dev.vars   # 填入 GEMINI_API_KEY；AUTH_DISABLED=true 会跳过 Access 校验
npm run db:migrate:local
npm run build                    # wrangler dev 需要 dist/ 存在
npm run dev:api                  # 终端 1：Worker + 本地 D1/R2，端口 8787
npm run dev                      # 终端 2：Vite 前端，/api 自动转发到 8787
```

## 可调的配置

`wrangler.jsonc` 的 `vars`：

| 变量 | 默认 | 说明 |
|---|---|---|
| `GEMINI_TEXT_MODEL` | `gemini-3.8-flash` | 补全和造句用的模型 |
| `GEMINI_TTS_MODEL` | `gemini-3.8-flash-tts` | 语音模型，以 AI Studio 当前可用列表为准 |
| `GEMINI_VOICE` | `Kore` | 音色，可换 `Puck`、`Charon`、`Aoede` 等 |
| `GEMINI_BASE_URL` | Google 官方地址 | 想走 Cloudflare AI Gateway 时填网关地址 |

**产出型复习**：除了"看英文想意思"，卡片还会以"看中文情境、说出空里的英文表达"的方式出现（AI 补全时生成一个与原例句不同的新情境；老卡片用原例句挖空）。设置里可选：混合（默认，新卡先认读、之后交替）/ 只认读 / 只产出。

**英英释义**：添加单词时先查词典，AI 只负责从词典义项里选出和语境对应的那一条，释义本身是词典原文。查询顺序：Merriam-Webster 学习者词典（Secret `MW_LEARNERS_KEY`）→ Merriam-Webster 大学词典（`MW_COLLEGIATE_KEY`）→ [Free Dictionary API](https://dictionaryapi.dev/)（Wiktionary 数据，无需 key）。Merriam-Webster 的 key 在 [dictionaryapi.com](https://dictionaryapi.com/) 免费申请（非商业、每天 1000 次）。按其[品牌规范](https://dictionaryapi.com/info/branding-guidelines)，应用内展示官方标志（设置页「词典来源」与添加预览，50px，原样不改），出处使用产品全称；标志文件在 CI 构建时从官网下载，不随仓库分发。

**关于地区**：Gemini API 不对中国大陆和香港开放，而大陆访问 Cloudflare 常落在香港节点。所以 `wrangler.jsonc` 里用 `placement.region = "gcp:us-central1"` 把 Worker 固定在美国执行，避免 `User location is not supported`。

## 复习规则

极简版间隔重复（`shared/srs.ts`）：

- **忘了**：10 分钟后再出现（本轮会排到队尾再来一次），间隔重置为 1 天
- **模糊**：间隔 × 1.2，首次 1 天
- **记得**：间隔 × 2.5，首次 3 天
- **DONE**：不再参与复习和 AI 重组；在词库的 DONE 页可以随时恢复

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/stats` | 进行中 / DONE / 今日到期 数量 |
| GET | `/api/items?status=active\|done&q=` | 词库列表 |
| POST | `/api/items` | 保存 |
| PATCH | `/api/items/:id` | 修改、标记 DONE / 恢复 |
| DELETE | `/api/items/:id` | 删除 |
| GET | `/api/review` | 今日到期列表 |
| POST | `/api/review/:id` | `{grade: 0\|1\|2}` |
| POST | `/api/enrich` | `{text}` → AI 补全预览（不保存） |
| POST | `/api/remix` | `{exclude?: id[]}` → 用待复习词造 3 句 |
| GET | `/api/tts?text=&slow=1` | 先查 R2 缓存，没有再调 Gemini |
