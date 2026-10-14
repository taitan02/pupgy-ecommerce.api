import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ChatService, type ChatEvent } from '../services/chat.service.js';
import { AiQuotaService } from '../services/quota.service.js';
import {
  AiQuotaDto,
  ConversationDto,
  ConversationMessageDto,
  ConversationPageDto,
  ConversationQueryDto,
  SendMessageDto,
  StartConversationDto,
} from '../dto/ai.dto.js';
import { toCursorPage } from '../../../common/dto/cursor-page.dto.js';
import { CurrentUser, RequireAudience } from '../../../common/decorators/auth.decorators.js';
import { AppError } from '../../../common/errors/app-error.js';
import { logger } from '../../../infra/logger/logger.js';
import type { AuthenticatedUser } from '../../auth/auth.types.js';

@ApiTags('storefront/ai')
@ApiBearerAuth('access-token')
@RequireAudience('STOREFRONT')
@Controller('storefront/ai')
export class StorefrontAiController {
  constructor(
    private readonly chat: ChatService,
    private readonly quota: AiQuotaService,
  ) {}

  @Post('conversations')
  @ApiOperation({ summary: 'Open a chat thread' })
  @ApiCreatedResponse({ type: ConversationDto })
  async start(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: StartConversationDto,
  ): Promise<ConversationDto> {
    return toConversationDto(await this.chat.createConversation(user.id, dto.shopId));
  }

  @Get('conversations')
  @ApiOperation({ summary: 'The buyer’s own threads, most recently active first' })
  @ApiOkResponse({ type: ConversationPageDto })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ConversationQueryDto,
  ): Promise<ConversationPageDto> {
    const rows = await this.chat.list(user.id, { cursor: query.cursor, limit: query.limit });
    const page = toCursorPage(rows, query.limit);
    return { items: page.items.map(toConversationDto), nextCursor: page.nextCursor };
  }

  @Get('conversations/:id/messages')
  @ApiOperation({ summary: 'Everything said in one thread' })
  @ApiOkResponse({ type: [ConversationMessageDto] })
  async messages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ConversationMessageDto[]> {
    const rows = await this.chat.messages(user.id, id);
    return rows.map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      model: row.model,
      stopReason: row.stopReason,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  @Get('quota')
  @ApiOperation({ summary: 'What is left of today’s allowance' })
  @ApiOkResponse({ type: AiQuotaDto })
  usage(@CurrentUser() user: AuthenticatedUser): Promise<AiQuotaDto> {
    return this.quota.snapshot(user.id);
  }

  /**
   * Asks a question and streams the answer back as Server-Sent Events.
   *
   * POST, not GET, which rules out `EventSource` — it only does GET and cannot send an
   * Authorization header. The storefront reads this with `fetch` and a ReadableStream
   * instead. That is the point: the alternative is putting the access token in a query
   * string, where it lands in every access log and proxy cache on the way (ADR-016).
   *
   * Written to the raw response rather than through Nest's `@Sse()` decorator, because
   * this needs the client-disconnect signal to stop paying for an answer nobody is
   * reading, and `@Sse()` hides the socket behind an Observable.
   */
  @Post('conversations/:id/messages')
  @HttpCode(200)
  @ApiOperation({ summary: 'Ask, and stream the answer (text/event-stream)' })
  @ApiProduces('text/event-stream')
  @ApiOkResponse({
    description:
      'SSE frames: `delta` for each chunk of text, `done` with the saved message id, ' +
      '`error` when the answer could not be finished.',
  })
  async send(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
    @Res() response: Response,
  ): Promise<void> {
    const controller = new AbortController();
    // Watched on the *response*, not the request: `request`'s own 'close' fires as
    // soon as the body has been read, which is every request, not a disconnect. On
    // the response it fires when the socket goes, and `writableFinished` separates a
    // tab that was closed from an answer that simply finished.
    response.on('close', () => {
      if (!response.writableFinished) controller.abort();
    });

    const stream = this.chat.streamAnswer({
      userId: user.id,
      conversationId: id,
      content: dto.content,
      signal: controller.signal,
    });

    try {
      for await (const event of stream) {
        if (!response.headersSent) openEventStream(response);
        writeEvent(response, event.type, event);
      }
    } catch (error) {
      // Before the first byte this is an ordinary request and deserves an ordinary
      // problem+json status; after it, the status line is long gone and the only way
      // left to tell the client is an SSE frame.
      if (!response.headersSent) throw error;

      logger.error({ err: error, conversationId: id }, 'AI stream ended in an error frame');
      writeEvent(response, 'error', {
        code: error instanceof AppError ? error.code : 'INTERNAL',
        detail: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    response.end();
  }
}

function openEventStream(response: Response): void {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    // Nginx buffers proxied responses by default, which turns a stream into one
    // delivery at the end. This header is the documented opt-out.
    'x-accel-buffering': 'no',
  });
  response.flushHeaders();
}

function writeEvent(response: Response, event: string, payload: ChatEvent | object): void {
  response.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function toConversationDto(row: {
  id: string;
  shopId: string | null;
  title: string | null;
  createdAt: Date;
  lastMessageAt: Date;
}): ConversationDto {
  return {
    id: row.id,
    shopId: row.shopId,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    lastMessageAt: row.lastMessageAt.toISOString(),
  };
}
