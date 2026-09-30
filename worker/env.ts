export interface Env {
  DB: D1Database
  AUDIO: R2Bucket
  ASSETS: Fetcher
  GEMINI_API_KEY: string
  GEMINI_TEXT_MODEL: string
  GEMINI_TTS_MODEL: string
  GEMINI_VOICE: string
  /** 可选：换成 Cloudflare AI Gateway 等代理地址，默认直连 Google */
  GEMINI_BASE_URL?: string
  /** Zero Trust 团队域名，如 yourteam.cloudflareaccess.com */
  ACCESS_TEAM_DOMAIN?: string
  /** Access 应用的 Application Audience (AUD) Tag */
  ACCESS_AUD?: string
  /** 紧急开关："true" 时拒绝所有 Gemini 调用（已缓存的语音照常播放） */
  AI_DISABLED?: string
  /** 每天最多几次文本调用（补全 / 重组 / 生成练习 / 批改） */
  DAILY_TEXT_LIMIT?: string
  /** 每天最多生成几段语音（命中缓存不算） */
  DAILY_TTS_LIMIT?: string
  /** 每分钟最多几次 Gemini 调用，防止前端 bug 死循环 */
  PER_MINUTE_LIMIT?: string
  /** 仅本地开发使用："true" 时跳过 Access 校验 */
  AUTH_DISABLED?: string
}
