// 生成 README 截图用的演示数据（全部是虚构内容，不含任何真实用户数据）。
// 用法：node scripts/demo/seed.mjs > .demo/seed.sql
//      npx wrangler d1 execute DB --local --persist-to .demo/state --file .demo/seed.sql
const USER = 'demo@example.com'
const now = Date.now()
const day = 86_400_000
const q = (v) => (v === null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replaceAll("'", "''")}'`)

const lesson = {
  title: 'Why Some Teams Swear by Walking Meetings',
  fit: 'ok',
  fitNote: '生词不多，句子结构清楚，适合做引导练习',
  summary:
    'Walking meetings trade the conference room for a loop around the block. Supporters say people talk more openly side by side, but the habit only works if someone captures the decisions afterwards.',
  words: [
    { word: 'candid', ipa: '/ˈkændɪd/', meaning: '坦率的；直言不讳的', quote: 'People tend to be more candid side by side than face to face.' },
    { word: 'stagnant', ipa: '/ˈstæɡnənt/', meaning: '停滞的；没有进展的', quote: 'Ideas feel stagnant after an hour in the same room.' },
    { word: 'tangent', ipa: '/ˈtændʒənt/', meaning: '离题的话', quote: 'It is easy to go off on a tangent when you are walking.' },
    { word: 'follow-through', ipa: '/ˈfɑːloʊ θruː/', meaning: '后续落实', quote: 'The weak spot is follow-through: nobody takes notes.' },
  ],
  expressions: [
    { pattern: "It's easier to … when …", meaning: '在……的时候更容易……', example: "It's easier to be honest when you're not staring at each other." },
    { pattern: 'The catch is that …', meaning: '美中不足的是……；问题在于……', example: 'The catch is that nobody remembers the action items.' },
  ],
  tasks: [
    { goal: '讲清楚', prompt: '用一句话概括文章的核心观点：走着开会为什么有效。', template: 'The article argues that …' },
    { goal: '有观点', prompt: '你同意吗？给出一个理由，试着用上 The catch is that …', template: 'I partly agree, but the catch is that …' },
    { goal: '连到自己', prompt: '说说你自己的一次类似经历。', template: 'In my last job, …' },
  ],
  speaking: [
    { question: 'Would walking meetings work for your team? Why or why not?', hint: '先给结论，再讲一个理由和一个例子' },
    { question: 'Describe the most useful meeting you have had recently.', hint: '可以用 It was useful because …' },
  ],
}

const grade = {
  verdict: 'revise',
  praise: '抓住了文章的核心：压力更小、更敢说。',
  corrections: [
    { original: 'walking meetings is', fixed: 'walking meetings are', reason: '主语 meetings 是复数，动词用 are' },
    { original: 'effective, because', fixed: 'effective because', reason: 'because 引出必要原因时一般不加逗号' },
  ],
  keyPoint: '主谓一致：写之前先找到主语，再决定用 is 还是 are。这是口语里最容易带到书面上的错误。',
  hint: '把括号里的中文换成文章里的生词，再检查一遍动词。',
  reference: '',
  translations: [{ zh: '坦率', en: 'candid' }],
  scores: { content: 4, grammar: 3, naturalness: 3, expression: 3 },
  remember: { text: 'open up', meaning: '敞开心扉；愿意多说', example: 'People tend to open up more on a walk.' },
}

const card = (text, meta, dueOffset, extra = {}) => ({ type: /\s/.test(text) ? 'sentence' : 'word', text, meta, due: now + dueOffset, ...extra })
const blank = { ipa: '', pos: '', meaning: '', example: '', exampleZh: '', highlight: '', phrases: [] }
const items = [
  card('candid', {
    ...blank,
    ipa: '/ˈkændɪd/',
    pos: 'adj.',
    meaning: '坦率的；直言不讳的',
    example: 'People tend to be more candid on a walk than in a meeting room.',
    exampleZh: '比起在会议室里，人们散步时往往更坦率。',
    highlight: 'candid',
    phrases: [
      { text: 'candid feedback', meaning: '坦诚的反馈' },
      { text: 'to be candid', meaning: '说实话' },
    ],
    cloze: { scene: '想请同事直接指出你方案的问题，不用客气', sentence: 'Please be ____ — what would you change?', answer: 'candid' },
  }, -60_000),
  card('open up', {
    ...blank,
    meaning: '敞开心扉；愿意多说',
    example: 'People tend to open up more on a walk.',
    exampleZh: '人在散步时更容易敞开心扉。',
    highlight: 'open up',
  }, -30_000),
  card('The catch is that …', {
    ...blank,
    meaning: '美中不足的是……；问题在于……',
    example: 'The catch is that nobody remembers the action items.',
    exampleZh: '问题在于，没人记得要落实的事项。',
    highlight: 'The catch is that',
  }, -20_000),
  card('stagnant', { ...blank, ipa: '/ˈstæɡnənt/', pos: 'adj.', meaning: '停滞的；没有进展的', example: 'Ideas feel stagnant after an hour in the same room.', exampleZh: '在同一个房间待一个小时，想法就停滞了。', highlight: 'stagnant' }, -10_000),
  card('tangent', { ...blank, ipa: '/ˈtændʒənt/', pos: 'n.', meaning: '离题的话', example: 'We went off on a tangent about lunch.', exampleZh: '我们聊着聊着就扯到午饭上去了。', highlight: 'tangent' }, 2 * day),
  card('follow-through', { ...blank, ipa: '/ˈfɑːloʊ θruː/', pos: 'n.', meaning: '后续落实', example: 'Great plan, weak follow-through.', exampleZh: '计划很好，落实很差。', highlight: 'follow-through' }, 5 * day),
  card('touch base', { ...blank, meaning: '简单沟通一下', example: "Let's touch base on Friday.", exampleZh: '我们周五碰一下。', highlight: 'touch base' }, 3 * day, { status: 'done' }),
]

const sql = []
for (const t of ['submissions', 'lessons', 'items', 'usage', 'user_settings']) sql.push(`DELETE FROM ${t};`)
for (const it of items) {
  sql.push(
    `INSERT INTO items (type, text, meta, status, interval, due_at, reps, lapses, created_at, updated_at, user_id) VALUES (${[
      it.type, it.text, JSON.stringify(it.meta), it.status ?? 'active', it.due > now ? 3 : 1, it.due, 2, 0, now - 4 * day, now - day, USER,
    ].map(q).join(', ')});`,
  )
}
// 第 1 份：已做完第 1 句（需修改），用于“批改”截图；第 2 份：还没提交，用于“输出”截图
for (const [id, subs, title] of [[1, true, 'Walking Meetings, Revisited'], [2, false, lesson.title]]) {
  sql.push(
    `INSERT INTO lessons (id, created_at, level, source_url, title, content, user_id) VALUES (${[id, now - (2 - id) * day, 2, null, title, JSON.stringify({ ...lesson, title }), USER].map(q).join(', ')});`,
  )
  if (subs) {
    sql.push(
      `INSERT INTO submissions (lesson_id, idx, attempt, text, passed, result, created_at, user_id) VALUES (${[
        id, 0, 1, 'The article argues that walking meetings is more effective, because people feel less pressure and more (坦率).', 0, JSON.stringify(grade), now - 3_600_000, USER,
      ].map(q).join(', ')});`,
    )
  }
}
// 近两周的练习打卡，让练习页的日历不是空的（挂在一份更早的练习上，不影响截图里的两份）
sql.push(
  `INSERT INTO lessons (id, created_at, level, source_url, title, content, user_id) VALUES (${[3, now - 10 * day, 2, null, 'The Case for Shorter Emails', JSON.stringify(lesson), USER].map(q).join(', ')});`,
)
for (let d = 1; d <= 9; d++) {
  if (d === 4 || d === 7) continue
  sql.push(
    `INSERT INTO submissions (lesson_id, idx, attempt, text, passed, result, created_at, user_id) VALUES (${[3, d % 3, d, 'demo', 1, JSON.stringify({ ...grade, verdict: 'pass' }), now - d * day, USER].map(q).join(', ')});`,
  )
}
sql.push(`INSERT INTO user_settings (user_id, key, value) VALUES ('${USER}', 'reviewMode', 'recognition');`)
console.log(sql.join('\n'))
