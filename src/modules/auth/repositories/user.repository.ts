import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service.js';
import type { UserStatus } from '../../../generated/prisma/enums.js';

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  fullName: string | null;
  status: UserStatus;
}

@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<UserRecord | null> {
    return this.prisma.user.findUnique({
      where: { email: normaliseEmail(email) },
      select: { id: true, email: true, passwordHash: true, fullName: true, status: true },
    });
  }

  findById(id: string): Promise<UserRecord | null> {
    return this.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, passwordHash: true, fullName: true, status: true },
    });
  }

  async updatePassword(id: string, passwordHash: string): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { passwordHash } });
  }

  create(input: {
    id: string;
    email: string;
    passwordHash: string;
    fullName?: string;
    phone?: string;
  }): Promise<UserRecord> {
    return this.prisma.user.create({
      data: { ...input, email: normaliseEmail(input.email) },
      select: { id: true, email: true, passwordHash: true, fullName: true, status: true },
    });
  }
}

/** Emails are compared case-insensitively, so they are stored in one canonical form.
 *  Without this, Tai@x.com and tai@x.com become two accounts. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}
