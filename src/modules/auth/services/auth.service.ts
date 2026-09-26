import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { UserRepository } from '../repositories/user.repository.js';
import { PasswordService } from './password.service.js';
import { TokenService, type IssuedTokens } from './token.service.js';
import { AppError } from '../../../common/errors/app-error.js';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import type { TokenAudience } from '../../../generated/prisma/enums.js';

interface ClientInfo {
  userAgent?: string;
  ip?: string;
}

export interface AuthResult extends IssuedTokens {
  user: { id: string; email: string; fullName: string | null };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  async register(
    input: { email: string; password: string; fullName?: string; phone?: string },
    audience: TokenAudience,
    client: ClientInfo,
  ): Promise<AuthResult> {
    const existing = await this.users.findByEmail(input.email);
    if (existing) {
      // Registration necessarily reveals that an email is taken — there is no way to
      // create an account without saying so. Login, which does not have that
      // constraint, stays deliberately vague.
      throw AppError.conflict('Email is already registered');
    }

    const user = await this.users.create({
      id: uuidv7(),
      email: input.email,
      passwordHash: await this.passwords.hash(input.password),
      fullName: input.fullName,
      phone: input.phone,
    });

    const tokens = await this.tokens.issue(user.id, audience, client);
    return { ...tokens, user: { id: user.id, email: user.email, fullName: user.fullName } };
  }

  async login(
    input: { email: string; password: string },
    audience: TokenAudience,
    client: ClientInfo,
  ): Promise<AuthResult> {
    const user = await this.users.findByEmail(input.email);

    // Hash even when the user does not exist, so response time does not reveal
    // which emails are registered.
    const passwordMatches = user
      ? await this.passwords.verify(user.passwordHash, input.password)
      : await this.passwords
          .hash(input.password)
          .then(() => false);

    if (!user || !passwordMatches) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 401, 'Invalid email or password');
    }

    if (user.status !== 'ACTIVE') {
      throw AppError.forbidden('This account is suspended');
    }

    const tokens = await this.tokens.issue(user.id, audience, client);
    return { ...tokens, user: { id: user.id, email: user.email, fullName: user.fullName } };
  }

  async refresh(refreshToken: string, client: ClientInfo): Promise<IssuedTokens> {
    return this.tokens.rotate(refreshToken, client);
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (refreshToken) {
      await this.tokens.revokeFamilyOf(refreshToken);
    }
  }

  async me(userId: string): Promise<{ id: string; email: string; fullName: string | null }> {
    const user = await this.users.findById(userId);
    if (!user) {
      // The token was valid but the account is gone: treat as unauthenticated.
      throw new AppError(ErrorCode.UNAUTHENTICATED, 401, 'Account no longer exists');
    }
    return { id: user.id, email: user.email, fullName: user.fullName };
  }
}
