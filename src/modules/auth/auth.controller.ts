import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import {
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AuthService } from './services/auth.service.js';
import { PasswordResetService } from './services/password-reset.service.js';
import {
  AuthResponseDto,
  AuthUserDto,
  LoginDto,
  RegisterDto,
  TokenResponseDto,
} from './dto/auth.dto.js';
import { RefreshDto } from './dto/refresh.dto.js';
import { ForgotPasswordDto, ResetPasswordDto } from './dto/password-reset.dto.js';
import { REFRESH_COOKIE, REFRESH_COOKIE_PATH } from './auth.types.js';
import { CurrentUser, Public } from '../../common/decorators/auth.decorators.js';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator.js';
import { AppError } from '../../common/errors/app-error.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { ProblemDto } from '../../common/dto/problem.dto.js';
import type { AuthenticatedUser } from './auth.types.js';
import type { IssuedTokens } from './services/token.service.js';
import type { TokenAudience } from '../../generated/prisma/enums.js';
import type { Env } from '../../config/env.schema.js';

@ApiTags('auth')
// Spelled out instead of `type: ProblemDto`, which Swagger renders as plain
// application/json — a 429 that claims an empty body makes generated clients type
// `error` as undefined, and the UI then reports a throttle as a wrong password.
@ApiTooManyRequestsResponse({
  description: 'Rate limit exceeded. The Retry-After header says how long to wait.',
  content: { 'application/problem+json': { schema: { $ref: getSchemaPath(ProblemDto) } } },
})
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly passwordReset: PasswordResetService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Post('register')
  @Public()
  @RateLimit({ name: 'register-ip', limitKey: 'RATE_LIMIT_AUTH_PER_IP', windowSeconds: 300, by: 'ip' })
  @ApiOperation({ summary: 'Create an account and start a session' })
  @ApiOkResponse({ type: AuthResponseDto })
  async register(
    @Body() dto: RegisterDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponseDto> {
    const result = await this.auth.register(dto, dto.audience, clientInfo(request));
    this.setRefreshCookie(response, dto.audience, result);
    return { accessToken: result.accessToken, expiresIn: this.accessTtlSeconds(), user: result.user };
  }

  @Post('login')
  @Public()
  // Both scopes: per account stops a slow brute force across many IPs, per IP stops
  // one host spraying many accounts.
  @RateLimit(
    { name: 'login-email', limitKey: 'RATE_LIMIT_LOGIN_PER_EMAIL', windowSeconds: 300, by: 'email' },
    { name: 'login-ip', limitKey: 'RATE_LIMIT_AUTH_PER_IP', windowSeconds: 300, by: 'ip' },
  )
  @HttpCode(200)
  @ApiOperation({ summary: 'Exchange credentials for a session' })
  @ApiOkResponse({ type: AuthResponseDto })
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponseDto> {
    const result = await this.auth.login(dto, dto.audience, clientInfo(request));
    this.setRefreshCookie(response, dto.audience, result);
    return { accessToken: result.accessToken, expiresIn: this.accessTtlSeconds(), user: result.user };
  }

  @Post('forgot-password')
  @Public()
  // Same two scopes as login: per email stops someone hammering one victim's inbox,
  // per IP stops a script harvesting which addresses are registered.
  @RateLimit(
    { name: 'forgot-email', limitKey: 'RATE_LIMIT_LOGIN_PER_EMAIL', windowSeconds: 900, by: 'email' },
    { name: 'forgot-ip', limitKey: 'RATE_LIMIT_AUTH_PER_IP', windowSeconds: 900, by: 'ip' },
  )
  @HttpCode(202)
  @ApiOperation({
    summary: 'Send a password-reset link',
    description:
      'Always accepted, whether or not the address has an account. Answering differently would turn this into a way to discover which emails are registered.',
  })
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<void> {
    await this.passwordReset.request(dto.email, dto.audience);
  }

  @Post('reset-password')
  @Public()
  @RateLimit({ name: 'reset-ip', limitKey: 'RATE_LIMIT_AUTH_PER_IP', windowSeconds: 900, by: 'ip' })
  @HttpCode(204)
  @ApiOperation({
    summary: 'Set a new password using an emailed token',
    description: 'Revokes every session of the account, in both apps.',
  })
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    await this.passwordReset.reset(dto.token, dto.password);
  }

  @Post('refresh')
  @Public() // authenticated by the refresh cookie, not by an access token
  @RateLimit({ name: 'refresh-ip', limitKey: 'RATE_LIMIT_AUTH_PER_IP', windowSeconds: 300, by: 'ip' })
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate the refresh token and issue a new access token' })
  @ApiBody({ type: RefreshDto })
  @ApiOkResponse({ type: TokenResponseDto })
  async refresh(
    @Body() dto: RefreshDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<TokenResponseDto> {
    const cookieName = REFRESH_COOKIE[dto.audience];
    const presented = request.cookies?.[cookieName] as string | undefined;
    if (!presented) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 401, 'Missing refresh token');
    }

    try {
      const tokens = await this.auth.refresh(presented, clientInfo(request));
      this.setRefreshCookie(response, dto.audience, tokens);
      return { accessToken: tokens.accessToken, expiresIn: this.accessTtlSeconds() };
    } catch (error) {
      // The cookie is worthless now (revoked or invalid). Clearing it stops the
      // client from retrying forever with a token that can never work again.
      this.clearRefreshCookie(response, dto.audience);
      throw error;
    }
  }

  @Post('logout')
  @Public() // must work even after the access token has expired
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke the session family and clear the cookie' })
  async logout(
    @Body() dto: RefreshDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const presented = request.cookies?.[REFRESH_COOKIE[dto.audience]] as string | undefined;
    await this.auth.logout(presented);
    this.clearRefreshCookie(response, dto.audience);
  }

  @Get('me')
  @ApiOperation({ summary: 'The authenticated user' })
  @ApiOkResponse({ type: AuthUserDto })
  me(@CurrentUser() user: AuthenticatedUser): Promise<AuthUserDto> {
    return this.auth.me(user.id);
  }

  private setRefreshCookie(
    response: Response,
    audience: TokenAudience,
    tokens: Pick<IssuedTokens, 'refreshToken' | 'refreshExpiresAt'>,
  ): void {
    response.cookie(REFRESH_COOKIE[audience], tokens.refreshToken, {
      httpOnly: true, // unreachable from JavaScript, so XSS cannot steal it
      secure: this.config.get('COOKIE_SECURE', { infer: true }),
      sameSite: 'lax',
      // Scoped to the refresh endpoint: it is never attached to ordinary API calls,
      // so it is not exposed on every request.
      path: REFRESH_COOKIE_PATH,
      expires: tokens.refreshExpiresAt,
    });
  }

  private clearRefreshCookie(response: Response, audience: TokenAudience): void {
    response.clearCookie(REFRESH_COOKIE[audience], { path: REFRESH_COOKIE_PATH });
  }

  private accessTtlSeconds(): number {
    return parseDuration(this.config.get('ACCESS_TOKEN_TTL', { infer: true }));
  }
}

function clientInfo(request: Request): { userAgent?: string; ip?: string } {
  return { userAgent: request.headers['user-agent'], ip: request.ip };
}

/** Converts "15m" / "24h" / "3600" into seconds, for the `expiresIn` field clients
 *  use to schedule a silent refresh. */
export function parseDuration(value: string): number {
  const match = /^(\d+)([smhd])?$/.exec(value.trim());
  if (!match) return 900;
  const amount = Number(match[1]);
  switch (match[2]) {
    case 'm':
      return amount * 60;
    case 'h':
      return amount * 3600;
    case 'd':
      return amount * 86_400;
    default:
      return amount;
  }
}
