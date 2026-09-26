import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envSchema } from './env.schema.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Tests get their own database and their own secrets; nothing they do can
      // affect the data you have open in development.
      envFilePath: process.env.NODE_ENV === 'test' ? '.env.test' : '.env',
      // Returning the parsed object means ConfigService hands back coerced values
      // (numbers as numbers, CORS_ORIGINS as an array), not raw strings.
      validate: (raw) => envSchema.parse(raw),
    }),
  ],
})
export class AppConfigModule {}
