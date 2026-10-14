// src/auth/auth-config.ts
// ===== إعدادات المصادقة — قراءة صارمة من البيئة مع فشل صريح في الإنتاج =====

/**
 * مبادئ:
 * - لا أسرار افتراضية في الإنتاج: إن غاب JWT_SECRET أو كانت قيمة ضعيفة → خطأ إقلاع.
 * - في التطوير/الاختبار يُسمح بسر افتراضي محذّر، لأنه لا يحمي بيانات حقيقية.
 */

const WEAK_SECRETS = new Set([
  'change-me',
  'changeme',
  'secret',
  'jwt-secret',
  'replace-with-long-random-string',
]);

export interface AuthSettings {
  jwtSecret: string;
  /** صلاحية access token بالثواني (المواصفة: 900 ثانية = 15 دقيقة) */
  accessTtlSeconds: number;
  /** صلاحية refresh token بالأيام (المواصفة: 30 يومًا) */
  refreshTtlDays: number;
  /** حد الأجهزة النشطة لكل منشأة (المواصفة: باقة أساسية = 3) */
  maxDevices: number;
  /** أقصى محاولات دخول فاشلة قبل القفل المؤقت */
  maxFailedAttempts: number;
  /** نافذة عدّ المحاولات الفاشلة بالثواني */
  failedAttemptWindowSeconds: number;
  /** مدة قفل الحساب بعد تجاوز المحاولات بالثواني */
  lockoutSeconds: number;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function loadJwtSecret(): string {
  const secret = process.env.JWT_SECRET ?? '';
  if (isProduction()) {
    if (!secret || WEAK_SECRETS.has(secret) || secret.length < 32) {
      throw new Error(
        'SECURITY_CONFIG_ERROR: في الإنتاج يجب ضبط JWT_SECRET بقيمة عشوائية طويلة (≥32 حرفًا). ' +
          "ولّد واحدة بـ: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\""
      );
    }
  }
  return secret || 'dev-only-insecure-secret-do-not-use-in-production-0123456789';
}

function num(envName: string, fallback: number): number {
  const raw = process.env[envName];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`CONFIG_ERROR: ${envName} يجب أن يكون رقمًا موجبًا، والوارد: "${raw}"`);
  }
  return parsed;
}

let cached: AuthSettings | null = null;

export function getAuthSettings(): AuthSettings {
  if (!cached) {
    cached = {
      jwtSecret: loadJwtSecret(),
      accessTtlSeconds: num('ACCESS_TOKEN_TTL_SECONDS', 900),
      refreshTtlDays: num('REFRESH_TOKEN_TTL_DAYS', 30),
      maxDevices: num('MAX_DEVICES', 3),
      maxFailedAttempts: num('AUTH_MAX_FAILED_ATTEMPTS', 5),
      failedAttemptWindowSeconds: num('AUTH_FAILED_WINDOW_SECONDS', 900),
      lockoutSeconds: num('AUTH_LOCKOUT_SECONDS', 900),
    };
  }
  return cached;
}

/** إعادة تعيين الكاش (تُستخدم في الاختبارات فقط) */
export function resetAuthSettingsForTests(): void {
  cached = null;
}
