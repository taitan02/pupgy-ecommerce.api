import { describe, expect, it, vi } from 'vitest';
import { TokenService, hashToken } from './token.service.js';
import type { SessionRepository, SessionRecord } from '../repositories/session.repository.js';

/**
 * The reuse grace window decides whether two tabs refreshing at once is a retry or a
 * theft, so it is tested directly rather than through HTTP: the value is read at
 * application boot, which makes it awkward to vary per e2e suite.
 */
function buildService(graceMs: number, session: SessionRecord) {
  const revokeFamily = vi.fn().mockResolvedValue(1);
  const sessions = {
    findByTokenHash: vi.fn().mockResolvedValue(session),
    // Already spent: this is what a second refresh with the same cookie sees.
    markUsed: vi.fn().mockResolvedValue(false),
    revokeFamily,
    create: vi.fn().mockResolvedValue(session),
  } as unknown as SessionRepository;

  const jwt = { signAsync: vi.fn().mockResolvedValue('access-token') };
  const config = { get: vi.fn().mockImplementation((key: string) => (key === 'REFRESH_REUSE_GRACE_MS' ? graceMs : 30)) };

  const service = new TokenService(
    jwt as never,
    sessions,
    config as never,
  );

  return { service, revokeFamily };
}

function sessionUsedMsAgo(ms: number): SessionRecord {
  return {
    id: 'session-1',
    familyId: 'family-1',
    userId: 'user-1',
    audience: 'STOREFRONT',
    usedAt: new Date(Date.now() - ms),
    revokedAt: null,
    expiresAt: new Date(Date.now() + 86_400_000),
  };
}

describe('TokenService.rotate', () => {
  it('issues new tokens when the same cookie is retried inside the grace window', async () => {
    const { service, revokeFamily } = buildService(10_000, sessionUsedMsAgo(500));

    const result = await service.rotate('token', {});

    expect(result.accessToken).toBe('access-token');
    expect(revokeFamily).not.toHaveBeenCalled();
  });

  it('revokes the family when the token is replayed after the grace window', async () => {
    const { service, revokeFamily } = buildService(10_000, sessionUsedMsAgo(60_000));

    await expect(service.rotate('token', {})).rejects.toThrow('reuse');
    expect(revokeFamily).toHaveBeenCalledWith('family-1');
  });

  it('revokes immediately when the grace window is disabled', async () => {
    const { service, revokeFamily } = buildService(0, sessionUsedMsAgo(10));

    await expect(service.rotate('token', {})).rejects.toThrow('reuse');
    expect(revokeFamily).toHaveBeenCalledWith('family-1');
  });

  it('hashes tokens before they reach the database', () => {
    expect(hashToken('secret')).toMatch(/^[a-f0-9]{64}$/);
    expect(hashToken('secret')).not.toContain('secret');
  });
});
