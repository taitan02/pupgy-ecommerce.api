import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from '../../src/app.module.js';
import { configureApp, NEST_OPTIONS } from '../../src/bootstrap/create-app.js';
import {
  LLM_PROVIDER,
  type LlmProvider,
  type LlmRequest,
  type LlmStopReason,
  type LlmStreamEvent,
} from '../../src/infra/llm/llm.types.js';

/**
 * A provider that answers from a script instead of from Anthropic.
 *
 * The e2e suite must not depend on a network, a key, or a bill, and it must be able to
 * ask for the paths a real provider makes hard to reach: an answer cut off at
 * `max_tokens`, a refusal, a mid-stream failure.
 */
export class StubLlmProvider implements LlmProvider {
  requests: LlmRequest[] = [];

  constructor(
    private script: {
      chunks: string[];
      stopReason?: LlmStopReason;
      inputTokens?: number;
      outputTokens?: number;
      failAfterChunks?: number;
      /** Pause before each chunk, so a test can disconnect mid-answer. */
      delayMs?: number;
    } = { chunks: ['Xin chào! ', 'Tôi có thể giúp gì?'] },
  ) {}

  setScript(script: StubLlmProvider['script']): void {
    this.script = script;
  }

  async *stream(request: LlmRequest, signal?: AbortSignal): AsyncIterable<LlmStreamEvent> {
    this.requests.push(request);

    const usage = {
      inputTokens: this.script.inputTokens ?? 100,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
    yield { type: 'usage', model: 'claude-opus-5-5', usage };

    let sent = 0;
    for (const chunk of this.script.chunks) {
      if (this.script.delayMs) await sleep(this.script.delayMs, signal);
      if (signal?.aborted) return;
      if (this.script.failAfterChunks !== undefined && sent === this.script.failAfterChunks) {
        throw new Error('stub provider failure');
      }
      yield { type: 'text', text: chunk };
      sent += 1;
      yield {
        type: 'usage',
        model: 'claude-opus-5-5',
        usage: { ...usage, outputTokens: (this.script.outputTokens ?? 10) * sent },
      };
    }

    yield { type: 'end', stopReason: this.script.stopReason ?? 'END_TURN' };
  }
}

/** The real app, with only the provider swapped. */
export async function createAppWithStubLlm(
  stub: StubLlmProvider,
): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(LLM_PROVIDER)
    .useValue(stub)
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>(
    new ExpressAdapter(),
    NEST_OPTIONS,
  );
  return configureApp(app);
}

/** Rejects on abort the way a real provider's in-flight request does. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    });
  });
}
