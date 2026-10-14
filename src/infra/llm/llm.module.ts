import { Module } from '@nestjs/common';
import { AnthropicProvider } from './anthropic.provider.js';
import { LLM_PROVIDER } from './llm.types.js';

/**
 * One provider, behind a token. Swapping it — for a second vendor, or for a stub in
 * tests — is a change to this binding and nothing else.
 */
@Module({
  providers: [{ provide: LLM_PROVIDER, useClass: AnthropicProvider }],
  exports: [LLM_PROVIDER],
})
export class LlmModule {}
