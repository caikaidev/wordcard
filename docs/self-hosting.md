# 自部署指南

这份文档帮你把「拾句」完整部署到自己的 Cloudflare 账号上：数据在你自己的数据库里，AI 调用用你自己的 key。整个过程大约 30 分钟，全部在网页上完成，手机也能操作；用电脑会更顺手。

> Cloudflare 控制台的菜单文字会随版本调整。下面给的是中文界面的叫法，括号里是英文界面的叫法；找不到的话按括号里的英文搜索。

## 需要准备

| 需要 | 说明 |
|---|---|
| GitHub 账号 | fork 仓库、跑自动部署 |
| Cloudflare 账号 | 免费版即可。用到 Workers、D1、R2、Zero Trust（Access） |
| Gemini API key | 在 [Google AI Studio](https://aistudio.google.com/apikey) 创建 |
| Merriam-Webster key（可选） | 英英释义更准。只限非商业使用，见 [THIRD_PARTY.md](../THIRD_PARTY.md)。不填就用免费的 Free Dictionary API |

**费用**：Cloudflare 这几项的免费额度对个人或几个人使用完全够。Gemini 按调用量计费，设置页有费用预估。代码里还有每日调用上限（`wrangler.jsonc` 的 `DAILY_*` / `USER_DAILY_*`），防止异常情况把账单刷高。

部署分两个阶段：

1. **初始化部署**：还没配置登录。Worker 照常发布，你能拿到访问地址，但所有接口一律拒绝（不读数据、不调 AI）。
2. **正式部署**：配置好 Cloudflare Access 登录以后，重新部署一次，App 就可以正常使用了。

---

## 1. Fork 仓库并启用 Actions

1. 在 GitHub 上 fork 本仓库。
2. 打开你 fork 的仓库 → **Actions** 标签页。fork 出来的仓库默认不运行工作流，页面上会提示启用，点 **I understand my workflows, go ahead and enable them**。

## 2. 创建 Gemini API key

在 [Google AI Studio](https://aistudio.google.com/apikey) 创建 key，先记下来。

建议在 Google Cloud 控制台做两件事：给这个 key 加上 API 限制（只允许 Generative Language API），再设一个预算提醒。

## 3. 创建 Cloudflare 资源

需要一个 D1 数据库和一个 R2 存储桶。**名字要和下面完全一致**，想换名字就同时改 `wrangler.jsonc`。

**方式 A：网页控制台**

1. 存储和数据库 → **D1** → 创建数据库，名称填 `wordcard`。创建后在详情页复制 **数据库 ID**（Database ID，一串 UUID）。
2. **R2** → 创建存储桶，名称填 `wordcard-audio`。第一次用 R2 时，Cloudflare 可能要求先开通 R2；免费额度内不收费。

**方式 B：命令行**（需要 Node 22+）

```bash
npx wrangler login
npx wrangler d1 create wordcard            # 输出里的 database_id 就是数据库 ID
npx wrangler r2 bucket create wordcard-audio
```

## 4. 创建 Cloudflare API Token

1. 右上角头像 → 我的个人资料（My Profile）→ **API 令牌**（API Tokens）→ 创建令牌。
2. 选模板「**编辑 Cloudflare Workers**」（Edit Cloudflare Workers），再加一条权限：**帐户 → D1 → 编辑**（Account → D1 → Edit）。
3. 创建后复制 token，它只显示一次。
4. 顺便记下 **帐户 ID**（Account ID）：Workers 和 Pages 概览页右侧栏就有。

## 5. 填写 GitHub Secrets

仓库 → Settings → Secrets and variables → Actions → **New repository secret**，逐个添加：

| 名称 | 必填 | 值 |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | 是 | 第 4 步的 token |
| `CLOUDFLARE_ACCOUNT_ID` | 是 | 第 4 步的帐户 ID |
| `D1_DATABASE_ID` | 是 | 第 3 步的数据库 ID |
| `GEMINI_API_KEY` | 是 | 第 2 步的 key |
| `ACCESS_TEAM_DOMAIN` | 第 7 步再填 | 形如 `yourteam.cloudflareaccess.com` |
| `ACCESS_AUD` | 第 7 步再填 | 64 位十六进制的 AUD |
| `ADMIN_EMAILS` | 建议 | 你的登录邮箱，多个用英文逗号隔开。管理员可以改模型、管理语音缓存、查看各成员用量 |
| `MW_LEARNERS_KEY` / `MW_COLLEGIATE_KEY` | 否 | Merriam-Webster key，二选一或都填 |

Secret 只存在 GitHub 和 Cloudflare 里，不会出现在代码、构建产物或前端页面中。

## 6. 初始化部署

1. **Actions** → 左侧选 **Deploy** → **Run workflow**。
2. 大约两分钟后运行结束。打开这次运行的摘要页，应该看到「**初始化部署**」，以及下一步提示。
   - 如果显示红色错误，说明缺了哪个 Secret，或者格式不对。按提示补上后重新运行。
3. 到 Cloudflare 控制台 → Workers 和 Pages → **wordcard**，找到访问地址，形如 `https://wordcard.<你的子域>.workers.dev`。第一次用 Workers 时，会先让你选一个 `workers.dev` 子域。

这时打开地址，页面能加载，但会提示「尚未配置 Cloudflare Access」。这是预期行为：没配好登录之前，接口拒绝一切请求。

## 7. 配置 Cloudflare Access（登录）

### 7.1 开通 Zero Trust

第一次使用时，打开控制台的 **Zero Trust**，按引导选一个**团队名**，选 Free 计划（50 人以内免费）。团队名决定了团队域名 `<团队名>.cloudflareaccess.com`。开通过程中 Cloudflare 可能要求绑定付款方式；免费计划不收费。

### 7.2 给 Worker 打开 Access

1. Workers 和 Pages → **wordcard** → 设置（Settings）→ **域和路由**（Domains & Routes）。
2. 在 `workers.dev` 那一行打开 **Cloudflare Access**。它会自动建好一个 Access 应用。
3. 弹窗里会显示这个应用的值：**团队域名**和 **AUD**。复制下来。之后也可以在 Zero Trust → Access → 应用程序里找到。

### 7.3 设置谁能登录

在这个 Access 应用的策略（Policy）里：

- 操作：**允许**（Allow）
- 包含（Include）→ **电子邮件**（Emails）→ 填你的邮箱。要给别人用，就把他们的邮箱也加上。
- 登录方式用默认的「一次性 PIN」（One-time PIN，邮箱验证码）即可。
- 建议把会话时长（Session Duration）设成 7 天以上，免得频繁登录。

### 7.4 正式部署

1. 回到 GitHub Secrets，填上 `ACCESS_TEAM_DOMAIN` 和 `ACCESS_AUD`。这两项必须同时填。
2. Actions → Deploy → **Run workflow**。摘要页应显示「**正式部署**」。
3. 打开访问地址 → 输入邮箱 → 填收到的验证码 → 进入 App。

Worker 会校验每个 `/api` 请求上的 Access 登录凭证（JWT 的签名、签发方和 AUD）。就算有人绕过登录页直接请求接口，也拿不到数据，也刷不了你的 AI 额度。

### 使用自定义域名（可选）

1. 在 `wrangler.jsonc` 里打开 `routes`，填你的域名（域名需要托管在 Cloudflare），并把 `workers_dev` 改成 `false`。
2. Zero Trust → Access → 应用程序 → 添加 → **自托管**（Self-hosted），域名填这个域名，策略同 7.3。
3. 把这个应用的 AUD 更新到 `ACCESS_AUD`，重新部署。

## 读取文章链接的方式

发一个链接后，App 会依次尝试以下方式，直到读到完整正文：

1. **直接抓取**：大部分网站用这种方式就够了。正文由开源库 Defuddle 提取，保留标题、段落和列表，去掉导航、侧栏和页脚。
2. **浏览器渲染**（Cloudflare Browser Run）：给需要执行 JavaScript 才显示内容的页面用。`wrangler.jsonc` 里默认开启了 `browser` 绑定；免费版每天有 10 分钟浏览器时间，个人使用够用。不想用可以删掉那一段配置。
3. **Gemini 读取**：网站拦截云服务器请求时（常见 403）使用，每篇大约多花 1–2 美分。
4. 以上都失败时，App 会提示你粘贴正文或上传截图。需要登录或有付费墙的页面，只能用这种方式。

原文会完整保存，最多 10 万字符，供「读原文」使用；生成练习时只取前 1.4 万字符交给 AI，控制费用。

## 8. 日常使用

- **更新到最新版本**：在 fork 仓库页面点 **Sync fork**。推送到 `main` 会自动部署。
- **手动重新部署**：Actions → Deploy → Run workflow。
- **邀请别人**：把对方邮箱加进 7.3 的放行名单。每个人的词库、练习和用量相互隔离；每人每天的 AI 额度见 `wrangler.jsonc` 的 `USER_DAILY_*`。
- **装到手机主屏幕**：手机浏览器打开 → 分享或菜单 → 「添加到主屏幕」。
- **备份数据**：`npx wrangler d1 export wordcard --remote --output backup.sql`。

## 故障排查

| 现象 | 原因与处理 |
|---|---|
| 部署摘要显示「缺少 Secret …」 | 按提示补上对应的 Secret，再重新运行 |
| 「Access 配置不完整」 | `ACCESS_TEAM_DOMAIN` 和 `ACCESS_AUD` 只填了一个，两个要同时填 |
| 页面提示「尚未配置 Cloudflare Access」 | 还在初始化阶段，完成第 7 步 |
| 「登录已失效，请刷新页面」且刷新无效 | `ACCESS_AUD` 和 Worker 实际使用的 Access 应用对不上（比如换过域名或重建过应用）。到 Zero Trust 里核对 AUD，更新 Secret 后重新部署 |
| 输入邮箱后收不到验证码 | 这个邮箱不在 7.3 的放行名单里 |
| 上传 Secret 失败，提示名字已被占用（already in use） | `wrangler.jsonc` 的 `vars` 里有和 Secret 同名的变量。删掉同名变量再部署 |
| AI 报 `User location is not supported` | 见下方「关于执行区域」 |
| AI 报模型不存在（404） | Google 调整了模型列表。管理员可以在设置页换模型，或修改 `wrangler.jsonc` 里的 `GEMINI_TEXT_MODEL` / `GEMINI_TTS_MODEL` |
| AI 报 429 / 今日额度已用完 | 触发了自带的费用上限或 Gemini 的速率限制。第二天自动恢复，或在 `wrangler.jsonc` 里调高 `DAILY_*` |
| Chrome 提示「无法安装此应用」 | 安装检查读取 manifest 和图标时被 Access 拦住了。可以在 Access 应用里给 `/manifest.webmanifest`、`/icon-*.png`、`/icon.svg`、`/apple-touch-icon.png` 加一条「绕过」（Bypass）策略。这些文件不含任何数据 |

## 关于执行区域

`wrangler.jsonc` 里的 `placement.region` 是一项**请求路由设置**：让 Worker 在美国的数据中心执行，调用 Gemini 等外部服务的请求也从那里发出。这样可以避免请求落到 Gemini 不支持的地区时报 `User location is not supported`。

它只决定代码在哪儿运行，**不是**任何国家或地区的合规方案。你把服务提供给他人时，需要自己确认所在地区对 AI 服务、个人信息保护等方面的要求。

## 数据与隐私

- 词库、复习进度、练习和批改记录存在你自己的 D1 数据库里，按登录邮箱隔离。
- 语音缓存存在你自己的 R2 存储桶里，同一段文字的语音全站共用。
- 发给 Gemini 的内容包括：你添加的词句、练习文章和你写的句子。Gemini 的数据使用规则见 [THIRD_PARTY.md](../THIRD_PARTY.md)。
- 分享卡片在浏览器本地生成，不经过服务器。
