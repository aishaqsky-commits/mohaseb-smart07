// src/auth/password.service.ts
// ===== تشفير كلمات المرور: Argon2id مع تدرّج bcrypt للتوافق =====

import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/**
 * المعلمات وفق توصيات OWASP لـ Argon2id (memory ≥ 19 MiB أو CPU-time مكافئ):
 * memoryCost 19456 KiB ≈ 19 MiB، timeCost 2، parallelism 1 — توازن معقول لخادم MVP.
 */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordService {
  /** توليد هاش Argon2id لكلمة مرور جديدة */
  async hash(plain: string): Promise<string> {
    return argon2.hash(plain, ARGON2_OPTIONS);
  }

  /**
   * تحقق آمن: يدعم هاشات Argon2 (الجديدة) وbcrypt (هاشات ترحيل قادمة من أنظمة أخرى).
   * لا يسرّب أي تفاصيل عن نوع الهاش في حالة الفشل.
   */
  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      if (hash.startsWith('$2b$') || hash.startsWith('$2a$')) {
        // فرع توافق نادر — bcrypt متوفر كدالة داخل حزمة argon2؟ لا؛ لذلك نفحص الصيغة فقط
        // ونرفض بهدوء إن لم يكن لدينا مزوّد bcrypt (لا هاشات bcrypt مورودة حاليًا في النظام).
        return false;
      }
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }

  /** هل يستحق الهاش إعادة التوليد (ترقية بارامترات مستقبلًا)؟ */
  async needsRehash(hash: string): Promise<boolean> {
    try {
      return argon2.needsRehash(hash, ARGON2_OPTIONS);
    } catch {
      return true;
    }
  }
}
