// src/auth/throttle.service.ts
// ===== الحد من محاولات الدخول الفاشلة (Brute-force protection) =====
// نافذة منزلقة في الذاكرة لكل بصمة (هاتف + IP). كافي لـ MVP أحادي العقدة؛
// مع تعدد العقد يُستبدل بـ Redis-backed دون تغيير الواجهة.

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { getAuthSettings } from './auth-config';

interface Bucket {
  count: number;
  firstAttemptAt: number;
  lockedUntil?: number;
}

@Injectable()
export class ThrottleService {
  private buckets = new Map<string, Bucket>();

  /** يفحص إن كان المفتاح مقفولًا الآن — يرمي 401 برسالة المهلة المتبقية */
  assertNotLocked(key: string): void {
    const b = this.buckets.get(key);
    if (b?.lockedUntil && b.lockedUntil > Date.now()) {
      const remainSec = Math.ceil((b.lockedUntil - Date.now()) / 1000);
      throw new UnauthorizedException(
        `تم إيقاف المحاولات مؤقتًا بسبب فشل متكرر — أعد المحاولة بعد ${remainSec} ثانية`
      );
    }
  }

  recordFailure(key: string): void {
    const settings = getAuthSettings();
    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b || now - b.firstAttemptAt > settings.failedAttemptWindowSeconds * 1000) {
      b = { count: 0, firstAttemptAt: now };
      this.buckets.set(key, b);
    }
    b.count += 1;
    if (b.count >= settings.maxFailedAttempts) {
      b.lockedUntil = now + settings.lockoutSeconds * 1000;
      b.count = 0;
      b.firstAttemptAt = b.lockedUntil; // النافذة التالية تبدأ بعد القفل
    }
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  /** تنظيف دوري لتجنب تضخم الذاكرة (يستدعيه Cron كل دقائق) */
  sweep(): void {
    const now = Date.now();
    for (const [k, b] of this.buckets) {
      const stale =
        (!b.lockedUntil && now - b.firstAttemptAt > 3600_000) ||
        (b.lockedUntil !== undefined && b.lockedUntil < now);
      if (stale) this.buckets.delete(k);
    }
  }
}
