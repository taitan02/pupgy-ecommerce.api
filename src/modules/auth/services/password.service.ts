import { Injectable } from '@nestjs/common';
import { hash, verify, type Algorithm } from '@node-rs/argon2';

// The library exports Algorithm as an ambient `const enum`, which cannot be read
// under `isolatedModules`. Argon2id is 2 in its NAPI binding (0=d, 1=i, 2=id).
const ARGON2ID = 2 as Algorithm;

/**
 * Argon2id: resistant to both GPU cracking and side-channel attacks, and the current
 * default recommendation for password storage. Parameters follow OWASP's baseline
 * (19 MiB memory, 2 iterations); memory cost is what makes parallel cracking expensive.
 */
const OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordService {
  hash(plaintext: string): Promise<string> {
    return hash(plaintext, OPTIONS);
  }

  async verify(storedHash: string, plaintext: string): Promise<boolean> {
    try {
      return await verify(storedHash, plaintext, OPTIONS);
    } catch {
      // A malformed hash in the database must read as "wrong password", never as a
      // 500 that tells an attacker something unusual happened to this account.
      return false;
    }
  }
}
