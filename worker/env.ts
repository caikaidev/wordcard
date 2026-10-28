export interface Env {
  /** 当前请求的用户（登录邮箱）；由 aiEnv() 注入，供记账和限额使用 */
  USER_ID?: string
  IS_ADMIN?: boolean
  /** User-selected text generation provider, set by aiEnv. */
  TEXT_PROVIDER?: 'cloudflare' | 'gemini'
  /** 管理员邮箱，逗号分隔（GitHub Secret，不写进代码） */
  ADMIN_EMAILS?: string
  /** 普通用户每天最多几次文本类 AI 调用 */
  USER_DAILY_TEXT_LIMIT?: string
  /** 普通用户每天最多生成几段新语音 */
  USER_DAILY_TTS_LIMIT?: string
  /** 仅本地开发：AUTH_DISABLED 时模拟的登录邮箱 */
  DEV_USER?: string
  /** Optional reliable background generation queue (created by deploy CI). */
  GENERATION_QUEUE?: Queue<{ jobId: number }>
  DB: D1Database
  AUDIO: R2Bucket
  AI: Ai // Cloudflare Workers AI · MeloTTS
  ASSETS: Fetcher
  GEMINI_API_KEY: string
  GEMINI_TEXT_MODEL: string
  GEMINI_TTS_MODEL: string
  GEMINI_VOICE: string
  /** 可选：换成 Cloudflare AI Gateway 等代理地址，默认直连 Google */
  GEMINI_BASE_URL?: string
  /** Merriam-Webster 学习者词典 key（可选，优先使用） */
  MW_LEARNERS_KEY?: string
  /** Merriam-Webster 大学词典 key（可选） */
  MW_COLLEGIATE_KEY?: string
  /** 仅本地测试：把词典请求指向模拟服务 */
  DICT_TEST_BASE?: string
  /** 仅本地测试：把 HN / Reddit 请求指向模拟服务 */
  SOURCE_TEST_BASE?: string
  /** 可选：Cloudflare Browser Run，渲染需要执行 JS 的页面 */
  BROWSER?: Fetcher
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
  /** 每分钟最多生成几段 MeloTTS 语音（应用安全上限） */
  TTS_PER_MINUTE_LIMIT?: string
  /** Web Push（每日提醒）的 VAPID 公钥 / 私钥（base64url），用 scripts/vapid-keys.mjs 生成；不配就没有提醒功能 */
  VAPID_PUBLIC_KEY?: string
  VAPID_PRIVATE_KEY?: string
  /** 可选：推送服务联系方式（mailto: 或 https:），默认用第一个管理员邮箱 */
  VAPID_SUBJECT?: string
  /** 可选：Reddit 应用（script 类型）的 client id / secret。不配的话从云服务器读 Reddit 经常被拒 */
  REDDIT_CLIENT_ID?: string
  REDDIT_CLIENT_SECRET?: string
  /** 外部接口导入练习：两次之间至少间隔多少秒（默认 180）、每人每天最多几次（默认 30） */
  EXT_IMPORT_INTERVAL?: string
  EXT_IMPORT_DAILY_LIMIT?: string
  /** 仅本地开发使用："true" 时跳过 Access 校验 */
  AUTH_DISABLED?: string
}

/** Hono 上下文：Bindings 是 Worker 环境，Variables 是鉴权中间件放进去的当前用户 */
export type AppEnv = { Bindings: Env; Variables: { user: string; admin: boolean } }
