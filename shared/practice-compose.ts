export type PracticeComposeSource = 'url' | 'text' | 'image'

const URL_OK = /^https?:\/\/\S+$/

/**
 * 「生成练习」不能点时的原因。空内容时直接告诉用户先贴链接或正文。
 * 返回 null 表示可以生成。
 */
export function practiceGenerateBlock(input: {
  source: PracticeComposeSource
  url: string
  text: string
  imageCount: number
}): string | null {
  if (input.source === 'url') {
    const url = input.url.trim()
    if (!url) return '请先粘贴链接或正文'
    if (!URL_OK.test(url)) return '请输入以 http:// 或 https:// 开头的完整链接'
    return null
  }
  if (input.source === 'text') {
    const text = input.text.trim()
    if (!text) return '请先粘贴链接或正文'
    if (text.length <= 80) return `正文太短，请至少粘贴 80 个字以上（现在 ${text.length} 个）`
    return null
  }
  if (input.imageCount <= 0) return '请先添加截图'
  return null
}
