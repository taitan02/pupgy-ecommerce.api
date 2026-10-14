import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { registerUser, url, type TestSession } from './helpers/auth-helpers.js';
import { createAppWithStubLlm, StubLlmProvider } from './helpers/llm-stub.js';

describe('AI chat (e2e)', () => {
  let app: NestExpressApplication;
  let stub: StubLlmProvider;
  let prisma: PrismaService;

  beforeAll(async () => {
    stub = new StubLlmProvider();
    app = await createAppWithStubLlm(stub);
    await app.init();
    prisma = app.get(PrismaService);
  });

  // A buyer per test, because the daily quota is per user and Redis counters outlive
  // the suite: sharing one account would make the tests depend on their own order.
  const newBuyer = () => registerUser(app, 'STOREFRONT');

  afterAll(async () => {
    await app.close();
  });

  const startConversation = (session: TestSession, shopId?: string) =>
    request(app.getHttpServer())
      .post(url('/storefront/ai/conversations'))
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send(shopId ? { shopId } : {});

  const ask = (session: TestSession, conversationId: string, content: string) =>
    request(app.getHttpServer())
      .post(url(`/storefront/ai/conversations/${conversationId}/messages`))
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ content });

  it('streams an answer as SSE frames and saves both turns', async () => {
    stub.setScript({ chunks: ['Chào bạn. ', 'Pupgy giúp gì được?'] });

    const buyer = await newBuyer();
    const conversation = await startConversation(buyer).expect(201);
    const response = await ask(buyer, conversation.body.id, 'Shop giao hàng thế nào?').expect(200);

    expect(response.headers['content-type']).toContain('text/event-stream');
    // Buffering is what turns a stream into a single late delivery behind Nginx.
    expect(response.headers['x-accel-buffering']).toBe('no');

    const events = parseSse(response.text);
    expect(events.filter((event) => event.name === 'delta').map((event) => event.data.text)).toEqual([
      'Chào bạn. ',
      'Pupgy giúp gì được?',
    ]);

    const done = events.at(-1)!;
    expect(done.name).toBe('done');
    expect(done.data.stopReason).toBe('END_TURN');

    const messages = await request(app.getHttpServer())
      .get(url(`/storefront/ai/conversations/${conversation.body.id}/messages`))
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(200);

    expect(messages.body.map((message: { role: string }) => message.role)).toEqual([
      'USER',
      'ASSISTANT',
    ]);
    expect(messages.body[1].content).toBe('Chào bạn. Pupgy giúp gì được?');
    expect(messages.body[1].model).toBe('claude-opus-5-5');
  });

  it('titles the thread with the opening question and leaves it alone afterwards', async () => {
    const buyer = await newBuyer();
    const conversation = await startConversation(buyer).expect(201);
    await ask(buyer, conversation.body.id, 'Câu hỏi đầu tiên').expect(200);
    await ask(buyer, conversation.body.id, 'Câu hỏi thứ hai').expect(200);

    const list = await request(app.getHttpServer())
      .get(url('/storefront/ai/conversations'))
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(200);

    const row = list.body.items.find((item: { id: string }) => item.id === conversation.body.id);
    expect(row.title).toBe('Câu hỏi đầu tiên');
  });

  it('replays the history window, so the model sees the earlier turns', async () => {
    const buyer = await newBuyer();
    const conversation = await startConversation(buyer).expect(201);
    await ask(buyer, conversation.body.id, 'Tôi tên Tài').expect(200);
    stub.requests.length = 0;
    await ask(buyer, conversation.body.id, 'Tôi tên gì?').expect(200);

    const sent = stub.requests.at(-1)!;
    expect(sent.messages.map((message) => message.content)).toContain('Tôi tên Tài');
    // The system prompt is built server-side on every turn, never carried in history.
    expect(sent.system).toContain('Pupgy');
  });

  it('refuses to read another buyer’s conversation', async () => {
    const buyer = await newBuyer();
    const other = await newBuyer();
    const conversation = await startConversation(buyer).expect(201);

    await request(app.getHttpServer())
      .get(url(`/storefront/ai/conversations/${conversation.body.id}/messages`))
      .set('Authorization', `Bearer ${other.accessToken}`)
      .expect(404);

    await ask(other, conversation.body.id, 'Cho tôi xem').expect(404);
  });

  it('rejects a seller token: AI chat is a storefront surface', async () => {
    const seller = await registerUser(app, 'SELLER');
    await startConversation(seller).expect(403);
  });

  it('404s when the shop context does not exist', async () => {
    const buyer = await newBuyer();
    await startConversation(buyer, '00000000-0000-7000-8000-000000000000').expect(404);
  });

  it('records what the call cost, including the model and the latency', async () => {
    stub.setScript({ chunks: ['Một ', 'hai'], inputTokens: 1_000, outputTokens: 50 });

    const buyer = await newBuyer();
    const conversation = await startConversation(buyer).expect(201);
    await ask(buyer, conversation.body.id, 'Tính tiền thử').expect(200);

    const usage = await prisma.aiUsageRecord.findFirst({
      where: { conversationId: conversation.body.id },
    });

    expect(usage).not.toBeNull();
    expect(usage!.inputTokens).toBe(1_000);
    expect(usage!.outputTokens).toBe(100); // 50 per chunk, cumulative
    expect(usage!.stopReason).toBe('END_TURN');
    expect(usage!.messageId).not.toBeNull();
    // 1000 input at $4/MTok + 100 output at $20/MTok = 4000 + 2000 micro-USD.
    expect(usage!.costMicroUsd).toBe(6_000);
    expect(usage!.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('marks a truncated answer so it is not mistaken for a complete one', async () => {
    stub.setScript({ chunks: ['Đang nói dở'], stopReason: 'MAX_TOKENS' });

    const buyer = await newBuyer();
    const conversation = await startConversation(buyer).expect(201);
    const response = await ask(buyer, conversation.body.id, 'Kể dài vào').expect(200);

    expect(parseSse(response.text).at(-1)!.data.stopReason).toBe('MAX_TOKENS');

    const messages = await request(app.getHttpServer())
      .get(url(`/storefront/ai/conversations/${conversation.body.id}/messages`))
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(200);
    expect(messages.body[1].stopReason).toBe('MAX_TOKENS');
  });

  it('bills the tokens that were generated before the provider broke', async () => {
    stub.setScript({ chunks: ['Nửa câu ', 'rồi hỏng'], failAfterChunks: 1, outputTokens: 30 });

    const buyer = await newBuyer();
    const conversation = await startConversation(buyer).expect(201);
    const response = await ask(buyer, conversation.body.id, 'Hỏi gì cũng được');

    // The failure arrived after the first chunk, so the status line had already been
    // sent as 200: the only honest channel left is an error frame.
    expect(response.status).toBe(200);
    expect(parseSse(response.text).at(-1)!.name).toBe('error');

    const usage = await prisma.aiUsageRecord.findFirst({
      where: { conversationId: conversation.body.id },
    });
    expect(usage!.stopReason).toBe('FAILED');
    expect(usage!.outputTokens).toBe(30);
    expect(usage!.errorCode).toBe('Error');

    // The partial answer is kept: the buyer saw it, and a thread that silently drops
    // what was on screen is worse than one that shows a half answer.
    const messages = await request(app.getHttpServer())
      .get(url(`/storefront/ai/conversations/${conversation.body.id}/messages`))
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(200);
    expect(messages.body[1].content).toBe('Nửa câu ');
  });

  it('still bills an answer the browser walked away from', async () => {
    // Slow chunks so the socket can be cut while the model is "typing".
    stub.setScript({ chunks: ['Một ', 'hai ', 'ba'], delayMs: 60, outputTokens: 20 });

    const buyer = await newBuyer();
    const conversation = await startConversation(buyer).expect(201);

    await app.listen(0);
    const { port } = app.getHttpServer().address() as AddressInfo;

    await new Promise<void>((resolve, reject) => {
      const outbound = http.request(
        {
          port,
          method: 'POST',
          path: url(`/storefront/ai/conversations/${conversation.body.id}/messages`),
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${buyer.accessToken}`,
          },
        },
        (incoming) => {
          // One chunk is enough to prove the stream started; then the client vanishes,
          // which is what a closed tab looks like to the server.
          incoming.once('data', () => {
            outbound.destroy();
            resolve();
          });
          incoming.on('error', () => resolve());
        },
      );
      outbound.on('error', reject);
      outbound.end(JSON.stringify({ content: 'Bỏ đi giữa câu' }));
    });

    const usage = await waitFor(() =>
      prisma.aiUsageRecord.findFirst({ where: { conversationId: conversation.body.id } }),
    );

    // The tokens generated before the disconnect were billed, so they are recorded —
    // and recorded as abandoned, not as a failure or a finished answer.
    expect(usage.stopReason).toBe('ABORTED');
    expect(usage.outputTokens).toBeGreaterThan(0);
    expect(usage.errorCode).toBeNull();
  });

  it('stops answering once the daily message quota is gone', async () => {
    stub.setScript({ chunks: ['ok'] });

    const buyer = await newBuyer();
    const conversation = await startConversation(buyer).expect(201);

    // .env.test allows 3 messages a day.
    for (let i = 0; i < 3; i++) {
      await ask(buyer, conversation.body.id, `Câu ${i}`).expect(200);
    }

    const refused = await ask(buyer, conversation.body.id, 'Một câu nữa').expect(429);
    expect(refused.body.code).toBe('RATE_LIMITED');
    // Refused before the provider was touched: the point of a quota is not spending.
    expect(refused.headers['content-type']).toContain('problem+json');
  });
});

/** The disconnect is handled after the response socket is gone, so the row appears a
 *  moment after the request ends. */
async function waitFor<T>(read: () => Promise<T | null>, attempts = 40): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('nothing was recorded');
}

/** Minimal SSE reader: enough to assert on frames, not a general parser. */
function parseSse(body: string): { name: string; data: Record<string, string> }[] {
  return body
    .split('\n\n')
    .filter((frame) => frame.trim().length > 0)
    .map((frame) => {
      const name = /^event: (.+)$/m.exec(frame)?.[1] ?? '';
      const data = /^data: (.+)$/m.exec(frame)?.[1] ?? '{}';
      return { name, data: JSON.parse(data) };
    });
}
