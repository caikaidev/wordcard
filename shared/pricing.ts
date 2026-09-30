/**
 * Gemini 付费层级单价（美元 / 100 万 token），来源：https://ai.google.dev/gemini-api/docs/pricing
 * 部分模型 2027-01-01 起调价，按调用发生的时间套用。免费层级（未绑定结算）实际不收费。
 */
type Price = { input: number; output: number }
type Tiered = { until?: number; price: Price }[]

const JAN_2027 = Date.UTC(2026, 11, 31, 16) // 2027-01-01 00:00 北京时间

export const PRICES: Record<string, Tiered> = {
  'gemini-3.8-flash': [
    { until: JAN_2027, price: { input: 0.75, output: 3.75 } },
    { price: { input: 1.5, output: 7.5 } },
  ],
  'gemini-3.7-flash': [
    { until: JAN_2027, price: { input: 0.75, output: 3.75 } },
    { price: { input: 1.5, output: 7.5 } },
  ],
  'gemini-3.5-flash': [{ price: { input: 1.5, output: 9 } }],
  'gemini-3.5-flash-lite': [{ price: { input: 0.3, output: 2.5 } }],
  'gemini-3.1-flash-lite': [{ price: { input: 0.25, output: 1.5 } }],
  'gemini-3.8-flash-tts': [
    { until: JAN_2027, price: { input: 0.5, output: 9 } },
    { price: { input: 1, output: 18 } },
  ],
  'gemini-3.8-flash-lite-tts': [
    { until: JAN_2027, price: { input: 0.5, output: 6 } },
    { price: { input: 1, output: 12 } },
  ],
}

export const PRICING_URL = 'https://ai.google.dev/gemini-api/docs/pricing'

export function priceAt(model: string, ts: number): Price | null {
  const tiers = PRICES[model]
  if (!tiers) return null
  return (tiers.find((t) => t.until === undefined || ts < t.until) ?? tiers[tiers.length - 1]).price
}

/** 估算一次调用的费用（美元）；未知模型返回 null */
export function costOf(model: string, ts: number, input: number, output: number): number | null {
  const p = priceAt(model, ts)
  if (!p) return null
  return (input * p.input + output * p.output) / 1e6
}
