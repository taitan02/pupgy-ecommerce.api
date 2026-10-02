import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller.js';
import { AuthService } from './services/auth.service.js';
import { TokenService } from './services/token.service.js';
import { PasswordService } from './services/password.service.js';
import { UserRepository } from './repositories/user.repository.js';
import { PasswordResetRepository } from './repositories/password-reset.repository.js';
import { PasswordResetService } from './services/password-reset.service.js';
import { SessionRepository } from './repositories/session.repository.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import type { Env } from '../../config/env.schema.js';

@Module({
  imports: [
    NotificationsModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: { issuer: 'ecommerce-api' },
        // Audience is verified by JwtAuthGuard per route, not here: one shared
        // verification cannot express "storefront tokens on storefront routes only".
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordResetService,
    TokenService,
    PasswordService,
    UserRepository,
    PasswordResetRepository,
    SessionRepository,
  ],
  exports: [AuthService, UserRepository, JwtModule],
})
export class AuthModule {}
