/**
 * Mailpit's HTTP API, so a test can assert on what was actually delivered over SMTP
 * rather than on the fact that a function was called.
 */
const BASE = process.env.MAILPIT_URL ?? 'http://localhost:8025';

export interface CapturedMessage {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

export async function clearMailbox(): Promise<void> {
  await fetch(`${BASE}/api/v1/messages`, { method: 'DELETE' });
}

/** True when the message went to this address. Matching on the subject alone is not
 *  enough: several tests produce the same subject, and delivery is asynchronous, so a
 *  test can otherwise pick up the previous one's email. */
export const addressedTo = (email: string) => (message: CapturedMessage) =>
  message.To.some((recipient) => recipient.Address === email);

/** Polls, because SMTP delivery finishes slightly after `sendMail` resolves. */
export async function waitForMessage(
  predicate: (message: CapturedMessage) => boolean,
  // Generous by default: a BullMQ worker attaches to the queue a moment after its
  // context boots, so the first job of a spec file can sit waiting for a second or
  // two. Callers asserting that *nothing* arrives pass a short timeout explicitly.
  timeoutMs = 15_000,
): Promise<CapturedMessage> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const response = await fetch(`${BASE}/api/v1/messages?limit=50`);
    const body = (await response.json()) as { messages: CapturedMessage[] };
    // Mailpit lists newest first, so this is the most recent match — what a person
    // would open.
    const found = body.messages.find(predicate);
    if (found) return found;

    if (Date.now() > deadline) {
      throw new Error(
        `No matching message within ${timeoutMs}ms. Saw: ${body.messages.map((m) => `${m.Subject} -> ${m.To.map((r) => r.Address).join(',')}`).join(' | ') || '(nothing)'}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** The rendered HTML, for asserting on what the recipient actually sees. */
export async function messageHtml(id: string): Promise<string> {
  const response = await fetch(`${BASE}/api/v1/message/${id}`);
  const body = (await response.json()) as { HTML: string; Text: string };
  return body.HTML;
}
