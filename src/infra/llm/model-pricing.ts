import type { LlmUsage } from './llm.types.js';

/**
 * Published prices in USD per million tokens, snapshotted here on purpose.
 *
 * Cost is written onto every usage row at the time of the call, so a price change
 * never rewrites what last month cost — the same reason an order copies its address
 * instead of pointing at one. A model missing from this table is a configuration
 * mistake worth failing on, not a call worth recording as free.
 *
 * Input, output and cache-read rates are the published ones. Cache writes are not
 * published per model; they are the standard 1.25x of the input rate.
 */
const RATES = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
} as const satisfies Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>;

export type PricedModel = keyof typeof RATES;

export function isPricedModel(model: string): model is PricedModel {
  return model in RATES;
}

/** Millionths of a USD. Integer money, for the same reason prices are integer VND. */
export function costMicroUsd(model: string, usage: LlmUsage): number {
  if (!isPricedModel(model)) {
    throw new Error(`No price on record for model "${model}" — add it to model-pricing.ts`);
  }

  const rate = RATES[model];
  const perToken =
    usage.inputTokens * rate.input +
    usage.outputTokens * rate.output +
    usage.cacheReadTokens * rate.cacheRead +
    usage.cacheWriteTokens * rate.cacheWrite;

  // Rates are per million tokens and the result is in millionths of a dollar, so the
  // two factors of a million cancel: the sum above is already micro-USD.
  return Math.round(perToken);
}
