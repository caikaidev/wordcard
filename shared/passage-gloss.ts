/** 分级短文里超档词的「本句中文语境义」，以及用来对上英英义项的提示。 */

export interface WordGloss {
  zh: string
  hint: string
}

const RAW = `
acknowledges	承认	admit recognize accept
adds	加上	put something extra
agrees	同意	same opinion accept
align	让人站到一边	bring into line agreement
ambiguity	含糊不清	more than one meaning unclear
annoyed	有点烦	slightly angry irritated
apples	苹果	round fruit
artifact	交出去的那一份	object made produced
asks	问	question request answer
backlog	积压下来的事	work not yet done
bags	袋子	container for carrying
bandwidth	还能分出去的精力	capacity communication
bounded	有边界的	limited within limits
bowls	碗	round deep dish
buys	买	pay money for
carrot	胡萝卜	orange vegetable
ceiling	天花板	top inside surface room
chairs	椅子	seat for one person
chooses	选了	pick one option
clap	鼓掌	strike hands together
cleaner	更干净、更清楚	not dirty free error
clock	钟	instrument that shows time
closing	关上	shut turn off
coat	外套	outer garment
coherent	前后连得上	logical consistent clear
colder	更冷淡	lower temperature less warm
colleague	同事	person you work with
comma	逗号	punctuation mark
compares	对照	examine differences similarities
constraint	限制	something that limits
cooks	做饭	prepare food heat
crosses	划掉	draw a line through
crowded	挤满了	too many people
cuts	切	divide with a knife
deadline	截止时间	time by which something must be finished
decides	决定	make a choice
decisive	说了算的	settling an issue firm
deletes	删掉	remove text
deliberate	故意放慢、想清楚	done on purpose careful
disappear	消失	stop being visible
disappears	消失不见	stop being visible
discrepancy	对不上的地方	difference between things that should match
dislikes	不喜欢	not like
drip	滴下来的水	fall in small drops
evenings	晚上	late part of the day
expects	指望	believe something will happen
feared	担心会发生的	afraid something bad
fixes	修好	repair make work
fridge	冰箱	machine that keeps food cold
guesses	猜测	opinion without enough facts
harsher	更苛刻	cruel severe strict
hungry	饿	want food
hurrying	赶着	move faster rush
implicit	没说出口的	suggested not stated
interpret	解读	explain the meaning
jumps	蹦出去	push yourself off a surface
kinder	更宽厚	gentle friendly
knocks	敲门	hit a door
lamp	灯	device that gives light
lands	掉到	come down onto
laughs	笑	sound of amusement
leak	漏水	liquid escaping a hole
listens	听	pay attention to sound
mattered	要紧	be important
mixes	搅	combine together stir
narrower	更窄	less wide
neighbor	邻居	person living nearby
nods	点头	move head down agreement
noon	中午	middle of the day
notebook	笔记本	book of paper for writing
notices	注意到	become aware
onion	洋葱	vegetable with a strong smell
opens	开门	move so that it is no longer closed
oranges	橙子	citrus fruit
overlook	漏看	fail to notice
paradigm	一套范式	typical pattern model
pays	付钱	give money
picks	挑	choose from a group
ping	一声提示	short high sound notification
plainly	明白地	clearly without decoration
plausible	说得通	seeming reasonable
pot	锅	container for cooking
publishes	发出去	make public print
pulls	拉	move toward yourself
pushes	往前推	move away with force
quieter	更安静	less noise
reads	读	look at and understand writing
rebuilding	重新搭	build again
reluctance	不情愿	unwillingness
replies	回复	answer
residual	剩下的那一点	remaining leftover
sends	发出	cause to go
shines	发亮	give out light
shops	店铺	place that sells things
shoulders	肩膀	part of the body between neck and arm
sits	坐	rest on a chair
skepticism	怀疑	doubt that something is true
sleeps	睡觉	rest with eyes closed
slept	睡过	past of sleep
slips	滑走、偏了	slide lose footing
smells	闻起来	notice a scent
smiles	微笑	turn up the corners of the mouth
sneaks	偷偷溜回来	move quietly to avoid notice
soup	汤	liquid food
stops	停下	no longer move
stretches	伸展	extend the body
tastes	尝	flavor in the mouth
teammate	一起做的人	member of the same team
tentative	试探性的	not certain hesitant
tradeoff	取舍	balance between two things
undermines	削弱	weaken gradually
understands	明白	know the meaning
unsure	拿不准	not certain
upstairs	楼上	on a higher floor
usable	能用	fit to be used
vague	含糊	not clear
vegetables	蔬菜	plants used as food
visiting	来住几天	stay with someone
waits	等	stay until something happens
wakes	醒来	stop sleeping
walks	走	move on foot
wash	洗	clean with water
washes	洗	clean with water
watches	看着	look for a period of time
waves	挥手	move the hand in greeting
`.trim()

const table = new Map<string, WordGloss>()
for (const line of RAW.split('\n')) {
  const [key, zh, hint] = line.split('\t')
  if (!key || !zh || !hint) continue
  table.set(key, { zh, hint })
}

export function glossFor(surface: string): WordGloss | undefined {
  return table.get(surface.toLowerCase())
}
