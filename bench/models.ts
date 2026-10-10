// The two benchmark models and their published prices in USD per million tokens (checked 2026-10-09 on
// https://platform.claude.com/docs/en/about-claude/pricing). Cache writes use the 5-minute TTL.
export const MODELS = { opus: 'claude-opus-5-5', haiku: 'claude-haiku-5-5' } as const
export type ModelKey = keyof typeof MODELS
export interface Usage { input_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number; output_tokens: number }

interface Price { input: number; cacheWrite: number; cacheRead: number; output: number }
const OPUS: Price = { input: 4, cacheWrite: 5, cacheRead: 0.2, output: 20 }
// Haiku 5.5 bills a request whose prompt (input + cache reads + cache writes) is over 100,000 tokens at higher prices.
const HAIKU: Price = { input: 0.1, cacheWrite: 0.125, cacheRead: 0.01, output: 0.5 }
const HAIKU_LONG: Price = { input: 0.5, cacheWrite: 0.625, cacheRead: 0.05, output: 2.5 }

export function costUsd(model: ModelKey, u: Usage): number {
  const prompt = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
  const p = model === 'opus' ? OPUS : prompt > 100_000 ? HAIKU_LONG : HAIKU
  return (u.input_tokens * p.input + u.cache_creation_input_tokens * p.cacheWrite + u.cache_read_input_tokens * p.cacheRead + u.output_tokens * p.output) / 1e6
}

// Upper bounds for the spending cap. Text never has more tokens than UTF-8 bytes. A 1280×900 screenshot is about
// 1,536 tokens, and no image these models accept has more than 4,784. A request's framing (the tool-use system prompt,
// role markers) stays under 2,000 tokens.
const IMAGE_TOKENS = 5_000
const FRAMING_TOKENS = 2_000

/** At most this many prompt tokens: the JSON's UTF-8 bytes, with each image counted as IMAGE_TOKENS. */
export function tokensAtMost(value: unknown): number {
  let images = 0
  const json = JSON.stringify(value, (_key, v) => (v?.type === 'image' && v.source ? (images++, null) : v))
  return Buffer.byteLength(json ?? '') + images * IMAGE_TOKENS
}

/** The most one request can cost: the whole prompt at the cache-write price (the highest input price) plus max_tokens
 *  of output, at Haiku's higher tier. */
export function worstCaseUsd(model: ModelKey, promptTokens: number, maxTokens: number): number {
  const p = model === 'opus' ? OPUS : HAIKU_LONG
  return ((promptTokens + FRAMING_TOKENS) * p.cacheWrite + maxTokens * p.output) / 1e6
}
