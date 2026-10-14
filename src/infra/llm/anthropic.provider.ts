import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import type { LlmProvider, LlmRequest, LlmStopReason, LlmStreamEvent, LlmUsage } from './llm.types.js';
import type { Env } from '../../config/env.schema.js';

@Injectable()
export class AnthropicProvider implements LlmProvider {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly effort: Env['AI_EFFORT'];

  constructor(config: ConfigService<Env, true>) {
    const baseURL = config.get('ANTHROPIC_BASE_URL', { infer: true });
    this.client = new Anthropic({
      apiKey: config.get('ANTHROPIC_API_KEY', { infer: true }),
      ...(baseURL ? { baseURL } : {}),
    });
    this.model = config.get('AI_MODEL', { infer: true });
    this.effort = config.get('AI_EFFORT', { infer: true });
  }

  async *stream(request: LlmRequest, signal?: AbortSignal): AsyncIterable<LlmStreamEvent> {
    const stream = this.client.messages.stream(
      {
        model: this.model,
        max_tokens: request.maxOutputTokens,
        // The system prompt is the stable prefix, so it is the thing worth caching:
        // every turn of every conversation re-sends it (ADR-016).
        system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
        messages: request.messages,
        // Thinking cannot be switched off on this model family; effort is the control,
        // and it is `low` by default because a shopper is waiting.
        output_config: { effort: this.effort },
      },
      { signal },
    );

    // Reported by the provider, not inferred from our own request: the model that
    // answered can differ from the one asked for (a fallback), and only it is billed.
    let model = this.model;
    // Merged, never replaced. The input and cache counts arrive once in message_start;
    // message_delta then reports the growing output count and may omit everything
    // else, so overwriting the object would quietly drop the larger half of the bill.
    let usage: LlmUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };

    for await (const event of stream) {
      switch (event.type) {
        case 'message_start':
          model = event.message.model;
          usage = mergeUsage(usage, event.message.usage);
          yield { type: 'usage', model, usage };
          break;
        case 'content_block_delta':
          if (event.delta.type === 'text_delta') yield { type: 'text', text: event.delta.text };
          break;
        case 'message_delta':
          usage = mergeUsage(usage, event.usage);
          yield { type: 'usage', model, usage };
          break;
      }
    }

    const message = await stream.finalMessage();
    yield { type: 'end', stopReason: toStopReason(message.stop_reason) };
  }
}

function mergeUsage(
  current: LlmUsage,
  reported: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  },
): LlmUsage {
  return {
    inputTokens: reported.input_tokens ?? current.inputTokens,
    outputTokens: reported.output_tokens ?? current.outputTokens,
    cacheReadTokens: reported.cache_read_input_tokens ?? current.cacheReadTokens,
    cacheWriteTokens: reported.cache_creation_input_tokens ?? current.cacheWriteTokens,
  };
}

/**
 * `stop_sequence` and `pause_turn` are folded into END_TURN: this request sets no stop
 * sequences and uses no server tools, so neither can occur, and inventing enum values
 * for impossible states makes every reader wonder when they happen.
 */
function toStopReason(reason: string | null): LlmStopReason {
  switch (reason) {
    case 'max_tokens':
      return 'MAX_TOKENS';
    case 'tool_use':
      return 'TOOL_USE';
    case 'refusal':
      return 'REFUSAL';
    default:
      return 'END_TURN';
  }
}
