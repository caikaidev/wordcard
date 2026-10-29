/* ---------------------------- 分级短文阶梯：按词汇档推荐 150–300 词短文 ---------------------------- */

/** 和发现新词同一套档位。0 不是档位，表示自动。 */
export const PASSAGE_BANDS = [3000, 5000, 8000, 12000] as const
export type PassageBand = (typeof PASSAGE_BANDS)[number]

const BAND_NAME: Record<PassageBand, string> = {
  3000: '3千',
  5000: '5千',
  8000: '8千',
  12000: '1.2万',
}

export const bandName = (band: PassageBand) => BAND_NAME[band]

export function isPassageBand(v: number): v is PassageBand {
  return (PASSAGE_BANDS as readonly number[]).includes(v)
}

/** 词汇量数字：选了档位就用档位；自动则用评级估算，没测过按 5000。 */
export function resolveVocabCount(vocabLevel: number, estimated: number | null): number {
  if (vocabLevel > 0) return vocabLevel
  if (estimated == null) return 5000
  return Math.min(20000, Math.max(1000, Math.round(estimated)))
}

/** 估算词汇量落到哪一档。显式的 3千/5千/8千/1.2万会落回自己，不会升档。 */
export function bandOf(vocab: number): PassageBand {
  if (vocab < 4000) return 3000
  if (vocab < 6500) return 5000
  if (vocab < 10000) return 8000
  return 12000
}

export function countWords(text: string): number {
  return text.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g)?.length ?? 0
}

export function excerptOf(text: string, n = 32): string {
  const parts = text.trim().split(/\s+/)
  if (parts.length <= n) return parts.join(' ')
  return `${parts.slice(0, n).join(' ')}…`
}

export interface GradedPassage {
  id: string
  band: PassageBand
  title: string
  text: string
  words: number
}

interface PassageDraft {
  id: string
  band: PassageBand
  title: string
  text: string
}

const DRAFTS: PassageDraft[] = [
  {
    id: 'p3000-1',
    band: 3000,
    title: 'The early market',
    text: `Mary goes to the market every morning before work. She likes the street when it is still quiet and the light is soft. The bread shop opens first. The smell of warm bread comes through the open door and makes her hungry. Mary buys bread for her family and one small cake for her child. The man behind the counter knows her name. He asks if she slept well and if the bus was on time yesterday. She says she slept well, and that she will come home before dark.

On the way to the bus stop she stops at the fruit stand. The fruit looks fresh and the prices are not too high. She picks four apples, three oranges, and a bag of green leaves for dinner. A woman she knows waves from the other side of the street. The woman says the bus is late today because of a small accident near the school. Mary looks at the clock on the shop wall. She still has time if she walks a little faster. She pays, puts the food in her bag, and says thank you.

The street is getting busy. People carry bags, talk about the weather, and wait for cars to pass. Mary walks to the bus stop and stands with the others. When the bus comes she finds a seat by the window. She watches the shops go by and thinks about dinner. Tonight she will cook the green leaves with eggs and rice. Her child will wash the fruit and set the table. It is a small plan, but it makes the morning feel clear and easy. She holds the bag on her legs and smiles at her own face in the window.`,
  },
  {
    id: 'p3000-2',
    band: 3000,
    title: 'The late bus',
    text: `Chen leaves the office a little later than usual. The sky is already dark, and the wind is cold. He walks fast to the bus stop because he wants to have dinner with his sister. She is visiting for two days and he promised to cook. At the stop, a small crowd is waiting. The board says the next bus will come in four minutes, but those four minutes pass and no bus comes.

A man next to him looks at his phone and says the road is closed near the river. Cars are moving very slowly. Chen feels tired. His bag is heavy with his computer and a book he did not open all day. He thinks about calling his sister to say he will be late. He does not want her to wait by the door and worry. He sends a short message: start without me if you are hungry, I will be home soon.

While he waits, he watches the shop across the street. A woman is closing the lights. A child pulls her coat and points at a cake in the window. Chen smiles. He used to do the same with his sister when they were small. Twenty minutes later the bus finally turns the corner. People get on in a quiet line. Chen finds a seat, puts his bag down, and lets his shoulders drop. The city lights run along the window. He plans the dinner in his head: rice, eggs, and the soup his sister likes. Being late is not a big problem if the evening is still warm when he opens the door.`,
  },
  {
    id: 'p3000-3',
    band: 3000,
    title: 'Soup for a friend',
    text: `On Sunday morning Maya and her friend Jo cook together. The kitchen is small, so they take turns at the table. Maya washes the vegetables. Jo cuts them into pieces that are not too big and not too small. They are making soup because the weather turned cold in the night and they both want something warm.

Maya reads the steps from a note on her phone. First they heat the pot. Then they add onion and wait until it smells sweet. Jo talks about his week while he mixes the pot. He says work was busy, but a kind word from his manager made the hard day better. Maya listens and tells him about a book she started. She does not explain the ending, because she is not there yet. They laugh when a piece of carrot jumps off the board and lands on the floor.

The soup needs time. They sit by the window with tea and watch people walk their dogs. The radio plays a slow song. When the soup is ready, Maya tastes it and adds a little salt. Jo cuts bread and puts two bowls on the table. They eat without hurrying. Outside, the sun comes out for a few minutes and the wet street shines. Maya says they should do this again next week. Jo agrees and washes the pot before he leaves. The kitchen is quiet again, but it still smells like onion, bread, and a morning that went well.`,
  },
  {
    id: 'p5000-1',
    band: 5000,
    title: 'The first real meeting',
    text: `Nora starts a new job on a Monday that already feels full. Her manager sends the agenda before nine: a client call, a review of last month's report, and a short talk about the schedule for the new project. Nora reads it twice on the train. She wants to sound clear, not just busy. In her notebook she writes three points she can actually explain, and she crosses out two that are only guesses.

The meeting room is bright and a little too warm. People speak quickly. When the client asks why a date moved, Nora feels her face get hot. She looks at the email she saved that morning and answers with the facts she has. The delay came from a missing file, not from a lack of care. She says the team can send the next version on Thursday if everyone keeps the same deadline. Her manager nods and lets her finish. That small signal makes her more confident.

After the call, Nora stays to write the notes while they are still fresh. She marks what the client liked and what still needs work. A colleague stops by and says her answer was easy to follow. Nora smiles, then asks for feedback anyway. She knows one good meeting does not mean she understands the whole job. On the way home she adds a line to her own list: next time, send the agenda questions a day early, so nobody has to guess in the room. The mistake she feared did not happen. The improvement she wants is still in front of her, and that feels like a fair start.`,
  },
  {
    id: 'p5000-2',
    band: 5000,
    title: 'Rain on the weekend',
    text: `The rain starts on Friday night and is still talking on the windows on Saturday morning. Alex had planned to spend the weekend in the garden, but the ground is soft and the tools would only make a mess. He makes tea and looks at the list on the fridge. Most of the items are small: answer two emails, fix the lamp in the hall, and buy nothing unless he really needs it.

Around noon a neighbor knocks. Water is coming into her kitchen from a corner of the ceiling. She is not angry, just unsure, and she asks if Alex has a minute. He puts on a coat and follows her upstairs. The leak is slow, not a flood. Together they move a table, set a pot under the drip, and dry the floor. Alex does not pretend to be an expert. He says she should call the building office, and he helps her write a short note with the time and a photo. Clear facts are better than a long worry.

Back in his own apartment, Alex feels the day change shape. The garden can wait. He fixes the lamp, replies to the emails, and cooks a simple lunch big enough for two. Then he takes a bowl across the hall. His neighbor laughs and says the soup is better advice than any tool. They eat standing up because the chairs are still crowded with the things they moved. Outside, the rain keeps going. Inside, the weekend is smaller than the plan and somehow more useful.`,
  },
  {
    id: 'p5000-3',
    band: 5000,
    title: 'A smaller evening habit',
    text: `Priya notices that her evenings disappear inside her phone. She sits down to rest and then looks up an hour later, still tired, with nothing she meant to do actually done. The habit is not dramatic. It is just a chain of messages, short videos, and replies that could have waited until morning. She decides to try a smaller rule for two weeks: after dinner, the phone stays in the kitchen, and the first thirty minutes belong to one real thing.

The first night is awkward. She keeps walking toward the counter, then stops and laughs at herself. She picks up a book she already owns and reads ten pages. The story is not exciting yet, but her attention stays in the room. The second night she writes a letter she has been meaning to send. The third night she stretches on the floor while the radio plays. None of these choices looks important from the outside. Together they give the evening a shape.

On Sunday she checks the screen time chart and sees the drop. She does not turn the number into a prize. She only notices that she sleeps a little earlier and wakes up less annoyed. A friend asks for the trick. Priya says there is no trick, only a place for the phone that is not her hand. She still replies to people she cares about. She just does it before dinner, when her mind is still open, instead of letting every small ping decide the night. The habit is young. She keeps it because the quiet feels like something she chose.`,
  },
  {
    id: 'p8000-1',
    band: 8000,
    title: 'Before the launch',
    text: `The team has one hour before they talk to the client, and the room still does not have a consensus. A colleague argues that they should delay the launch until the numbers are cleaner. Another says the threshold they set last month has already been met, and waiting will only spend the momentum they have. Lena listens, then asks each person to separate facts from assumptions. The heat in the discussion drops once the two lists are on the board.

She does not want a clever speech. She wants a recommendation the client can use. They acknowledge the weak spot in the report: a small sample, and a subtle change in how people answered the second question. They also acknowledge what is working. The new flow is faster, and the support team has fewer repeated tickets. Lena suggests they negotiate the date instead of defending it. Offer a limited release on Thursday, and keep the full release behind one clear check.

The incentive to sound certain is strong. Lena pushes the other way. She asks the group to be deliberate about the words they will not say. No promise that every edge case is gone. No claim that the last test was larger than it was. When they practice the opening, the story is shorter and more honest. Someone laughs and says it feels less like a performance. That, Lena thinks, is the point. A client can accept a careful limit. A client cannot use a confident story that will not survive the first real week.`,
  },
  {
    id: 'p8000-2',
    band: 8000,
    title: 'The park on paper',
    text: `The city posts a long plan for the park by the river, and Mateo reads it on his lunch break. The summary is smooth. The details are less so. One section says the new path will improve access. A later section indicates that the same path will narrow the space where the weekend market stands. Mateo marks both lines. He wants to interpret the document, not just agree with its tone.

He walks over after work to compare the paper with the ground. The scope of the change is larger than the drawings suggest at first glance. A row of trees sits where the plan shows a clean curve. Moving them might be possible, but the outcome would not be neutral. Shade, noise, and the way people cross the street would all shift. The tension is not between friends and enemies of the park. It is between two goods: a safer path, and a place that already works for the people who use it every day.

At the community table he keeps his comment specific. He compares the promise in the introduction with the map on page six. He says the plan has enough information to be useful, but not yet sufficient to decide. He asks for one more drawing that shows the market on a busy Sunday, not an empty morning. The staff member writes it down. Mateo does not expect to win a debate. He expects the next version to show its emphasis in a picture, so neighbors can see the trade before they are asked to clap for it.`,
  },
  {
    id: 'p8000-3',
    band: 8000,
    title: 'Feedback without a speech',
    text: `Jordan has to tell a teammate that a draft missed the point. He dislikes this part of the job. A vague compliment would be easier, and a sharp speech would feel decisive, but neither would help the work. He chooses a deliberate structure. First he names what the draft was asked to do. Then he points at the paragraph where the argument slips. Then he stops talking.

The teammate, Priya, is quiet for a moment. She says she wrote fast because the deadline moved and she assumed speed mattered more than shape. Jordan acknowledges the pressure. He also says the assumption led them to a text that a reader cannot follow. The main claim appears, disappears, and returns with different words. A subtle fix will not save it. The piece needs a new opening that states the decision and the reason, and a middle that stays with that reason.

They spend forty minutes rebuilding the outline on a large board. Jordan does not take the pen the whole time. When Priya finds the sentence that should have been first, the rest of the draft looks less mysterious. She asks whether this kind of feedback will always be so direct. Jordan says he would rather be clear once than polite three times. The incentive is not to win the conversation. It is to send something a stranger can use without guessing what the team meant. Priya nods, keeps the old file, and starts the new one from the sentence she just found.`,
  },
  {
    id: 'p12000-1',
    band: 12000,
    title: 'A coherent afternoon',
    text: `By early afternoon the task list has become a kind of noise. Iris can still name every item, yet none of them feels tangible enough to begin. Each one is plausible on its own. Together they create friction: a little reluctance, a little switching, and the quiet fiction that preparation is the same thing as progress. She closes the extra windows and writes the day in one sentence. If the sentence needs a comma and a rescue clause, the day is still too vague.

What she wants is not a heroic plan. She wants a coherent block of work with an edge she can feel. The implicit rule of her morning was that every request deserved a slice of attention. The provisional rule of her afternoon is harsher and kinder: one artifact leaves the desk, and everything else is allowed to wait without being a moral failure. She chooses the memo that other people are actually blocked on. The rest stay visible, so she does not have to pretend they vanished.

Half an hour in, she notices the old pull to polish a paragraph nobody is waiting for. She lets the pull pass. The inherent difficulty of the memo is not the vocabulary. It is the moment where she has to say what the team will not do. She writes that sentence plainly, then the reasons under it, then the ask. When she reads it back, one soft claim still tries to overlook the cost. She deletes it. The page is less charming and more usable. That trade feels like the opposite of reluctance. It feels like attention finally agreeing to land.`,
  },
  {
    id: 'p12000-2',
    band: 12000,
    title: 'Against a tidy paradigm',
    text: `The review begins with a diagram that looks inevitable. Boxes flow into boxes, and the caption calls the picture a paradigm for how the product should grow. Naomi is not opposed to order. She is opposed to a diagram that hides the constraint it cannot draw. The team has a limited number of people, a contingent partnership, and a backlog of promises that were reasonable one at a time. The picture makes those facts look like a temporary mood.

She asks where the discrepancy sits between the diagram and last month's support notes. The notes are full of ambiguity: customers using the feature for a job the team did not quite intend, and a residual path that everyone hoped would fade. It did not fade. If the new design undermines that path without saying so, the launch will feel like a correction to the people who shipped it and like a loss to the people who rely on it. Naomi would rather put that tension on the page than discover it in public.

The room goes quieter, not colder. A tentative alternative appears in the margin: keep the old path for one cycle, name it as temporary, and measure who still needs it. The suggestion is not elegant. It refuses the pleasure of a single clean model. Naomi calls that a virtue. A paradigm is useful when it explains the world the team actually has, including the awkward remainder. A paradigm that only explains the world they wish they had is just a poster. They leave the meeting with fewer boxes and a sentence they are willing to defend.`,
  },
  {
    id: 'p12000-3',
    band: 12000,
    title: 'Learning in public',
    text: `Evan agrees to explain a decision in a short public note, then spends two days not writing it. The reluctance is specific. He can describe the choice in a meeting, where tone and follow-up questions do half the work. A note has to stand alone. It will be read by people with less context, more skepticism, and no obligation to be kind. He worries that a careful sentence will still be quoted as if it were the whole thought.

He starts by listing what a fair reader deserves: the constraint, the options he actually compared, and the reason he did not pick the louder one. He cuts the paragraph that tries to sound more certain than the evidence. Certainty would be easier to align around, and it would also be a little false. The plausible story is narrower. They chose the option that reduced one kind of harm and accepted another. Pretending the second harm is imaginary would undermine the trust he is trying to earn.

A colleague reads the draft and marks the places where an implicit assumption sneaks back in. Evan is grateful and a bit exposed. That exposure is the point of learning in public. Bandwidth is limited, so the note stays under a page. It does not become a manifesto. It becomes a record of a tradeoff that future-him might otherwise remember as pure insight. He publishes it in the afternoon, then leaves the comments closed until morning. The coherent act was not the applause he will not control. It was putting a true, bounded account where other people can use it.`,
  },
]

export const PASSAGES: GradedPassage[] = DRAFTS.map((p) => ({ ...p, words: countWords(p.text) }))

const byId = new Map(PASSAGES.map((p) => [p.id, p]))

export function passageById(id: string): GradedPassage | undefined {
  return byId.get(id)
}

export function passagesInBand(band: PassageBand): GradedPassage[] {
  return PASSAGES.filter((p) => p.band === band)
}

export type PassageState = 'done' | 'current' | 'locked'

export interface LadderItem {
  id: string
  band: PassageBand
  title: string
  words: number
  state: PassageState
  /** 当前篇和已读篇才有开头；锁住的篇不带正文，避免提前看到 */
  excerpt?: string
}

export interface PassageLadder {
  band: PassageBand
  bandName: string
  /** 用来定档的词汇量。自动档是估算值，手选档是 3000/5000/8000/12000 */
  vocab: number
  /** setting：手选档位；estimate：词汇评级；default：还没测，按 5千 */
  source: 'setting' | 'estimate' | 'default'
  items: LadderItem[]
  today: { id: string; title: string; words: number; excerpt: string } | null
}

/**
 * 只推荐当前档的短文。读完一篇，下一篇才从 locked 变成 current。
 * 入门档不会因为评级很高就改推更难的文章：手选档位优先。
 */
export function ladderView(vocabLevel: number, estimated: number | null, doneIds: Iterable<string>): PassageLadder {
  const vocab = resolveVocabCount(vocabLevel, estimated)
  const band = bandOf(vocab)
  const done = new Set(doneIds)
  let opened = false
  const items: LadderItem[] = passagesInBand(band).map((p) => {
    let state: PassageState
    if (done.has(p.id)) state = 'done'
    else if (!opened) {
      state = 'current'
      opened = true
    } else state = 'locked'
    const item: LadderItem = { id: p.id, band: p.band, title: p.title, words: p.words, state }
    if (state !== 'locked') item.excerpt = excerptOf(p.text)
    return item
  })
  const current = items.find((i) => i.state === 'current')
  const today = current ? { id: current.id, title: current.title, words: current.words, excerpt: current.excerpt ?? '' } : null
  const source = vocabLevel > 0 ? 'setting' : estimated == null ? 'default' : 'estimate'
  return { band, bandName: bandName(band), vocab, source, items, today }
}

/** 这篇之后，下一篇若已解锁（当前或已读）就返回它的 id */
export function nextReadableId(items: LadderItem[], id: string): string | null {
  const idx = items.findIndex((i) => i.id === id)
  if (idx < 0) return null
  const nxt = items.slice(idx + 1).find((i) => i.state !== 'locked')
  return nxt?.id ?? null
}
