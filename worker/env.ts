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
  /** 仅本地开发使用："true" 时跳过 Access 校验 */
  AUTH_DISABLED?: string
}
