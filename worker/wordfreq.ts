// 英语词频排名（wordfreq，CC BY-SA 4.0，见 THIRD_PARTY.md）：一行一个词，按常用程度排序
import WORDLIST from '../shared/wordfreq-en.txt'

let words: string[] | null = null
let ranks: Map<string, number> | null = null

const list = () => (words ??= WORDLIST.trimEnd().split('\n'))

/** 词频排名，从 1 开始；词表里没有就是 undefined */
export const rankOf = (w: string) => {
  ranks ??= new Map(list().map((x, i) => [x, i + 1]))
  return ranks.get(w)
}

/** 排名对应的词 */
export const wordAt = (rank: number) => list()[rank - 1]
