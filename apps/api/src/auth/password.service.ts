// src/auth/password.service.ts
// ===== تشفير كلمات المرور: Argon2id مع تدرّج bcrypt للتوافق =====

import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

let argon2: typeof import('argon2') | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  argon2 = require('argon2');
} catch {
  argon2 = null;
}

/**
 * المعلمات وفق توصيات OWASP لـ Argon2id (memory ≥ 19 MiB أو CPU-time مكافئ):
 * memoryCost 19456 KiB ≈ 19 MiB، timeCost 2، parallelism 1 — توازن معقول لخادم MVP.
 */
const ARGON2_OPTIONS = argon2
  ? ({
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    } as const)
  : null;

@Injectable()
export class PasswordService {
  /** توليد هاش Argon2id لكلمة مرور جديدة (مع تراجع آمن لـ scrypt عند غياب المترجم المحلي) */
  async hash(plain: string): Promise<string> {
    if (argon2 && ARGON2_OPTIONS) {
      return argon2.hash(plain, ARGON2_OPTIONS);
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const derivedKey = crypto.scryptSync(plain, salt, 64).toString('hex');
    return `$scrypt$${salt}$${derivedKey}`;
  }

  /**
   * تحقق آمن: يدعم هاشات Argon2 وscrypt.
   * لا يسرّب أي تفاصيل عن نوع الهاش في حالة الفشل.
   */
  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      if (hash.startsWith('$scrypt$')) {
        const parts = hash.split('$');
        const salt = parts[2];
        const key = parts[3];
        if (!salt || !key) return false;
        const derived = crypto.scryptSync(plain, salt, 64).toString('hex');
        return crypto.timingSafeEqual(Buffer.from(derived, 'utf-8'), Buffer.from(key, 'utf-8'));
      }
      if (argon2) {
        return await argon2.verify(hash, plain);
      }
      return false;
    } catch {
      return false;
    }
  }

  /** هل يستحق الهاش إعادة التوليد (ترقية بارامترات مستقبلًا)؟ */
  async needsRehash(hash: string): Promise<boolean> {
    try {
      if (argon2 && ARGON2_OPTIONS) {
        return argon2.needsRehash(hash, ARGON2_OPTIONS);
      }
      return false;
    } catch {
      return true;
    }
  }
}
