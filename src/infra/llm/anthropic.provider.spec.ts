import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AnthropicProvider } from './anthropic.provider.js';
import type { LlmStreamEvent } from './llm.types.js';

/**
 * Runs the provider against a server that speaks Anthropic's SSE shape.
 *
 * The mapping from stream events to tokens is where the money is decided, and it is
 * the one piece a stubbed `LlmProvider` cannot cover: the e2e suite replaces this
 * class, so a mistake here would pass every test and understate every bill.
 */
describe('AnthropicProvider', () => {
  let server: http.Server;
  let baseURL: string;

  const frame = (event: string, data: unknown) =>
    `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

  beforeAll(async () => {
    server = http.createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(
        frame('message_start', {
          type: 'message_start',
          message: {
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            model: 'claude-opus-5-5',
            content: [],
            stop_reason: null,
            usage: {
              input_tokens: 800,
              output_tokens: 0,
              cache_read_input_tokens: 40,
              cache_creation_input_tokens: 128,
            },
          },
        }),
      );
      response.write(
        frame('content_block_start', {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        }),
      );
      response.write(
        frame('content_block_delta', {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Chào bạn' },
        }),
      );
      response.write(frame('content_block_stop', { type: 'content_block_stop', index: 0 }));
      // As the real API does: the final usage carries the output count and nothing else.
      response.write(
        frame('message_delta', {
          type: 'message_delta',
          delta: { stop_reason: 'max_tokens', stop_sequence: null },
          usage: { output_tokens: 64 },
        }),
      );
      response.write(frame('message_stop', { type: 'message_stop' }));
      response.end();
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  async function collect(): Promise<LlmStreamEvent[]> {
    const config = {
      get: (key: string) =>
        ({ ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: baseURL, AI_MODEL: 'claude-opus-5-5', AI_EFFORT: 'low' })[
          key
        ],
    };

    const provider = new AnthropicProvider(config as never);
    const events: LlmStreamEvent[] = [];
    for await (const event of provider.stream({
      system: 'test',
      messages: [{ role: 'user', content: 'hello' }],
      maxOutputTokens: 256,
    })) {
      events.push(event);
    }
    return events;
  }

  it('keeps the input and cache counts that only message_start reports', async () => {
    const events = await collect();
    const usage = events.filter((event) => event.type === 'usage').at(-1);

    expect(usage).toMatchObject({
      usage: {
        inputTokens: 800,
        outputTokens: 64,
        cacheReadTokens: 40,
        cacheWriteTokens: 128,
      },
    });
  });

  it('reports the model that answered and the reason it stopped', async () => {
    const events = await collect();

    expect(events.filter((event) => event.type === 'text').map((event) => event.text)).toEqual([
      'Chào bạn',
    ]);
    expect(events.at(-1)).toEqual({ type: 'end', stopReason: 'MAX_TOKENS' });
    expect(events.find((event) => event.type === 'usage')?.model).toBe('claude-opus-5-5');
  });
});
