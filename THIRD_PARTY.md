# 第三方内容与授权说明

本仓库的**代码**以 [MIT 许可证](LICENSE) 发布。下面这些内容**不属于** MIT 授权的范围，各自遵循原提供方的条款。自己部署时，请以各服务的最新条款为准。

## 词典数据（运行时查询，不随仓库分发）

英英释义由部署者自己的 Worker 在运行时查询，仓库里不包含任何词典数据。

### Merriam-Webster Dictionary API（可选）

- 用途：添加单词时查询英英释义。查询顺序是 Learner's Dictionary → Collegiate Dictionary。
- 需要部署者**自己**在 [dictionaryapi.com](https://dictionaryapi.com/) 申请 key，并填进 GitHub Secrets（`MW_LEARNERS_KEY` / `MW_COLLEGIATE_KEY`）。不填也能用，会退回下面的 Free Dictionary API。
- 条款要点：免费 key **只限非商业使用**，每个 key 每天不超过 1000 次查询。商业用途（广告或收费）需要先联系 Merriam-Webster 另谈授权。
- 释义原文版权归 Merriam-Webster 所有，**不在本项目的 MIT 授权范围内**。
- 品牌：应用内按其[品牌规范](https://dictionaryapi.com/info/branding-guidelines)展示官方标志（50px，原样不改），出处写产品全称。标志文件在 CI 构建时从官网下载，不提交进仓库。

### Free Dictionary API（默认兜底）

- 服务地址：[dictionaryapi.dev](https://dictionaryapi.dev/)，不需要 key。
- 数据来自 [Wiktionary](https://www.wiktionary.org/)，该接口返回的数据标注为 CC BY-SA 许可。转载或再分发释义内容时，需要署名并以相同方式共享。

## AI 生成内容

- 卡片补全、练习题、批改和语音由部署者自己的 Gemini API key 生成，受 [Gemini API 条款](https://ai.google.dev/gemini-api/terms)约束。
- 注意：Gemini 免费层级的数据可能会被 Google 用于改进产品。部署给别人用时，建议使用付费层级，并在你自己的隐私说明里告知用户。

## 网页正文提取

- [Defuddle](https://github.com/kepano/defuddle)（MIT）：从网页里提取正文。
- [linkedom](https://github.com/WebReflection/linkedom)（ISC）：在 Worker 里解析 HTML。
- [@cloudflare/puppeteer](https://github.com/cloudflare/puppeteer)（Apache-2.0）：可选，通过 Cloudflare Browser Run 渲染需要执行 JS 的页面。

读取到的文章只保存在部署者自己的数据库里，供本人阅读和练习使用。版权归原作者所有，请勿用本工具转载或再分发他人的文章。

## 字体

- [Newsreader](https://github.com/productiontype/Newsreader)（通过 `@fontsource-variable/newsreader` 打包），SIL Open Font License 1.1。

## 依赖

npm 依赖各自的许可证见 `node_modules/*/LICENSE`，或运行 `npx license-checker --summary` 查看。

## 演示素材

`docs/images/` 下的截图和动画，由 `scripts/demo/` 用虚构的演示数据生成，不含任何真实用户数据，随代码一起以 MIT 许可证发布。
