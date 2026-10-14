/**
 * The seam between this application and whichever model writes the answers.
 *
 * Deliberately narrow: streaming text, plus what the call cost. Tool calling arrives
 * in Phase 10 and will extend `LlmStreamEvent` rather than this interface, because a
 * tool round is an event in a stream, not a different kind of request.
 */
export interface LlmProvider {
  /** Streams one assistant turn. Throws before yielding if the request is rejected. */
  stream(request: LlmRequest, signal?: AbortSignal): AsyncIterable<LlmStreamEvent>;
}

export const LLM_PROVIDER = Symbol('LlmProvider');

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmRequest {
  system: string;
  messages: LlmMessage[];
  maxOutputTokens: number;
}

export type LlmStreamEvent =
  | { type: 'text'; text: string }
  /**
   * Running totals, emitted whenever the provider revises them — last one wins.
   * Separate from `end` so that a stream cut short (the browser left, the process is
   * shutting down) still leaves the caller holding real token counts: those tokens
   * were generated and billed whether or not anyone read them.
   */
  | { type: 'usage'; model: string; usage: LlmUsage }
  /** Only on a stream that ran to completion. */
  | { type: 'end'; stopReason: LlmStopReason };

export type LlmStopReason = 'END_TURN' | 'MAX_TOKENS' | 'TOOL_USE' | 'REFUSAL';

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}
