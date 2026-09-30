// 用本地演示数据截 README 用图。先启动：npx wrangler dev --port 8788 --persist-to .demo/state --var DEV_USER:demo@example.com
// 用法：node scripts/demo/shots.mjs [输出目录]
import { chromium } from 'playwright'
const out = process.argv[2] ?? 'docs/images/raw'
const base = process.env.DEMO_URL ?? 'http://localhost:8788'
const b = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' })
for (const scheme of ['light', 'dark']) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme, locale: 'zh-CN' })
  const p = await ctx.newPage()
  p.on('pageerror', (e) => console.log('ERR', e.message))
  // 页面在内部容器里滚动（不是 window），把元素滚到顶部再往回留一点空
  const scrollTo = (loc, gap) =>
    loc.evaluate((el, gap) => {
      el.scrollIntoView({ block: 'start' })
      let n = el.parentElement
      while (n && !(n.scrollHeight > n.clientHeight && /auto|scroll/.test(getComputedStyle(n).overflowY))) n = n.parentElement
      ;(n ?? document.scrollingElement).scrollTop -= gap
    }, gap)
  const shot = async (name) => { await p.waitForTimeout(500); await p.screenshot({ path: `${out}/${name}-${scheme}.png` }) }

  // 1 文章：练习首页
  await p.goto(`${base}/practice`); await p.waitForLoadState('networkidle')
  await p.locator('input[inputmode=url]').fill('https://example.com/walking-meetings')
  await p.getByRole('radio', { name: '引导' }).click()
  await shot('1-article')

  // 2 输出：在还没提交的那份练习里写第 1 句
  await p.goto(`${base}/practice/2`); await p.waitForLoadState('networkidle')
  const area = p.locator('#task-0')
  await area.fill('The article argues that walking meetings help people open up, because they talk side by side instead of face to face.')
  await scrollTo(p.getByRole('button', { name: /讲清楚/ }), 80)
  await shot('2-write')

  // 3 批改：已提交过的那份
  await p.goto(`${base}/practice/1`); await p.waitForLoadState('networkidle')
  await scrollTo(p.getByText('第 1 次 · 需修改'), 150)
  await shot('3-feedback')

  // 4 复习：翻开第一张卡
  await p.goto(`${base}/`); await p.waitForLoadState('networkidle'); await p.waitForTimeout(600)
  await p.getByText('candid', { exact: true }).first().click()
  await shot('4-review')
  // 5 分享卡片：练习页“今天已打卡” → 生成卡片；两种样式各截一张
  await p.goto(`${base}/practice`); await p.waitForLoadState('networkidle')
  await p.getByRole('button', { name: /生成分享卡片/ }).click()
  await p.getByRole('img', { name: '今日打卡卡片' }).waitFor()
  await p.waitForTimeout(400)
  await shot('5-share')
  const img = p.getByRole('img', { name: '今日打卡卡片' })
  for (const style of ['paper', 'indigo']) {
    await p.getByRole('radio', { name: style === 'paper' ? '纸白' : '靛蓝' }).click()
    await p.waitForTimeout(500)
    const src = await img.getAttribute('src')
    const b64 = await p.evaluate(async (u) => {
      const r = await fetch(u); const buf = new Uint8Array(await r.arrayBuffer())
      let s = ''; for (const x of buf) s += String.fromCharCode(x); return btoa(s)
    }, src)
    ;(await import('node:fs')).writeFileSync(`${out}/card-${style}-${scheme}.png`, Buffer.from(b64, 'base64'))
  }
  await ctx.close()
}
await b.close()
