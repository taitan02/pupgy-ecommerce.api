import { describe, expect, it } from 'vitest';
import { costMicroUsd } from './model-pricing.js';

const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

describe('costMicroUsd', () => {
  it('prices a million input tokens at the published dollar rate', () => {
    // $4 per million input tokens = 4_000_000 millionths of a dollar.
    expect(costMicroUsd('claude-opus-5-5', { ...usage, inputTokens: 1_000_000 })).toBe(4_000_000);
  });

  it('charges output tokens at five times input, as published', () => {
    expect(costMicroUsd('claude-opus-5-5', { ...usage, outputTokens: 1_000 })).toBe(20_000);
  });

  it('prices a cached prefix at a twentieth of the input rate', () => {
    expect(costMicroUsd('claude-opus-5-5', { ...usage, cacheReadTokens: 1_000_000 })).toBe(200_000);
  });

  it('rounds to whole millionths rather than storing a fraction', () => {
    // 1 cached token at $0.20/MTok is 0.2 micro-USD — not representable as an integer.
    expect(costMicroUsd('claude-opus-5-5', { ...usage, cacheReadTokens: 1 })).toBe(0);
    expect(costMicroUsd('claude-opus-5-5', { ...usage, cacheReadTokens: 3 })).toBe(1);
  });

  it('refuses to price a model it has no published rate for', () => {
    // Recording an unpriced call as free would quietly understate the bill.
    expect(() => costMicroUsd('claude-made-up-9', usage)).toThrow(/No price on record/);
  });
});
