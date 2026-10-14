// src/auth/auth.service.ts
// ===== خدمة المصادقة: تسجيل مالك+منشأة، دخول، تدوير جلسة، خروج، أجهزة =====
// مواصفات: docs/02-architecture/api-specifications.md §4.3 §4.4

import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { IdentityRepository } from './identity.repository';
import { PasswordService } from './password.service';
import { TokenService, IssuedTokens } from './token.service';
import { ThrottleService } from './throttle.service';
import { getAuthSettings } from './auth-config';

/** نمط هاتف يمني: 7xxxxxxxx (موبايلي) أو 01xxxxxxxx (أرضي) — توسّع لاحقًا عند الحاجة */
const PHONE_RE = /^(7\d{8}|01\d{7,8})$/;

export const RegisterDtoSchema = z.object({
  full_name: z.string().trim().min(3).max(120),
  phone: z.string().regex(PHONE_RE, 'رقم الهاتف يجب أن يكون يمنيًا صحيحًا (7xxxxxxxx)'),
  password: z
    .string()
    .min(8, 'كلمة المرور قصيرة جدًا')
    .max(128)
    .refine((p) => /[A-Za-z\u0600-\u06FF]/.test(p) && /\d/.test(p), 'كلمة المرور يجب أن تحتوي أحرفًا وأرقامًا'),
  business_name: z.string().trim().min(2).max(120),
  business_type_code: z.enum(['retail', 'clinic', 'workshop', 'law_office', 'service_office']),
  base_currency_code: z.enum(['YER', 'SAR', 'USD']).optional().default('YER'),
  device: z.object({
    device_key: z.string().min(8).max(64),
    device_name: z.string().trim().max(80).optional(),
    platform: z.enum(['android', 'ios', 'web', 'desktop']),
    app_version: z.string().max(20).optional(),
  }),
});
export type RegisterDto = z.infer<typeof RegisterDtoSchema>;

export const LoginDtoSchema = z.object({
  phone: z.string(),
  password: z.string(),
  device: z.object({
    device_key: z.string().min(8).max(64),
    device_name: z.string().max(80).optional(),
    platform: z.enum(['android', 'ios', 'web', 'desktop']).default('android'),
    app_version: z.string().max(20).optional(),
  }),
});
export type LoginDto = z.infer<typeof LoginDtoSchema>;

@Injectable()
export class AuthService {
  constructor(
    private readonly identity: IdentityRepository,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly throttle: ThrottleService,
  ) {}

  /** POST /auth/register — إنشاء مالك + منشأة + جهاز أول + زوج توكنات (نقطة بداية متعددة المنشآت) */
  async register(dtoRaw: unknown) {
    const dto = this.parseDto(RegisterDtoSchema, dtoRaw);

    if (this.identity.isPhoneTaken(dto.phone)) {
      throw new ConflictException({ error: 'PHONE_TAKEN', message: 'رقم الهاتف مسجّل مسبقًا — سجّل الدخول بدلًا من ذلك' });
    }

    const nowIso = new Date().toISOString();
    const userId = randomUUID();
    const tenantId = randomUUID();
    const deviceId = randomUUID();
    const settings = getAuthSettings();

    // المعاملة: إما الهوية كاملة أو لا شيء (لا مستخدم يتيم بلا منشأة)
    await this.createUserWithTenant({
      userId,
      tenantId,
      deviceId,
      nowIso,
      dto,
      maxDevices: settings.maxDevices,
    });

    const tokens = await this.tokens.issueTokenPair({
      userId,
      tenantId,
      deviceId,
      role: 'owner',
    });

    return {
      tenant: {
        id: tenantId,
        business_name: dto.business_name,
        business_type_code: dto.business_type_code,
        base_currency_code: dto.base_currency_code,
        onboarding_status: 'pending',
      },
      user: { id: userId, full_name: dto.full_name, phone: dto.phone },
      device: { id: deviceId, is_active: true },
      tokens,
    };
  }

  /** معاملة كتابة الهوية — مفصولة ليسهل اختبارها وتوسيعها لاحقًا لـ Postgres */
  private async createUserWithTenant(params: {
    userId: string;
    tenantId: string;
    deviceId: string;
    nowIso: string;
    dto: RegisterDto;
    maxDevices: number;
  }): Promise<void> {
    const { userId, tenantId, deviceId, nowIso, dto } = params;
    const passwordHash = await this.passwords.hash(dto.password);
    const db = (this.identity as unknown as { db?: Database.Database }).db;
    const writeAll = () => {
      this.identity.insertUser({
        id: userId,
        full_name: dto.full_name,
        phone: dto.phone,
        password_hash: passwordHash,
        is_platform_admin: 0,
        two_fa_enabled: 0,
        locale: 'ar-YE',
        is_active: 1,
        last_login_at: nowIso,
        created_at: nowIso,
        updated_at: nowIso,
      });
      this.identity.insertTenant({
        id: tenantId,
        business_name: dto.business_name,
        business_type_code: dto.business_type_code,
        base_currency_code: dto.base_currency_code,
        owner_user_id: userId,
        phone: dto.phone,
        onboarding_status: 'pending',
        max_devices: params.maxDevices,
        is_active: 1,
        created_at: nowIso,
      });
      this.identity.insertMembership({ tenant_id: tenantId, user_id: userId, role: 'owner', is_active: 1 });
      this.identity.upsertDevice({
        id: deviceId,
        tenant_id: tenantId,
        device_key: dto.device.device_key,
        device_name: dto.device.device_name ?? null,
        platform: dto.device.platform,
        app_version: dto.device.app_version ?? null,
        is_primary: 1,
        is_revoked: 0,
        last_seen_at: nowIso,
        registered_at: nowIso,
      });
    };
    // المعاملة الذرية: كل كتابة أو لا شيء — الفشل الجزئي يترك مستخدمًا بلا منشأة (خطر حقيقي)
    if (db) db.transaction(writeAll)();
    else writeAll(); // اختبارات بوحدة مزيفة بدون قاعدة
  }

  /** POST /auth/login — تحقق كلمة مرور + قفل brute-force + حد الأجهزة + إصدار جلسة */
  async login(dtoRaw: unknown, ipHint: string) {
    const dto = this.parseDto(LoginDtoSchema, dtoRaw);
    const throttleKey = `${dto.phone}|${ipHint}`;
    this.throttle.assertNotLocked(throttleKey);

    const user = this.identity.findUserByPhone(dto.phone);
    const fail = (): never => {
      this.throttle.recordFailure(throttleKey);
      // رسالة موحّدة: لا تكشف هل الهاتف موجود (منع enumeration)
      throw new UnauthorizedException({ error: 'INVALID_CREDENTIALS', message: 'بيانات الدخول غير صحيحة' });
    };
    if (!user) fail();

    const ok = await this.passwords.verify(user!.password_hash, dto.password);
    if (!ok) fail();

    this.throttle.reset(throttleKey);

    // ترقية شفافة للهاش إن تغيرت البارامترات (OWASP Password Storage Cheat Sheet)
    if (await this.passwords.needsRehash(user!.password_hash)) {
      const fresh = await this.passwords.hash(dto.password);
      this.identity.updatePasswordHash(user!.id, fresh, new Date().toISOString());
    }

    // اختيار منشأة المستخدم (MVP: أول منشأة نشطة — تعدد المنشآت عبر X-Tenant-Id لاحقًا)
    const tenants = this.identity.listTenantsForUser(user!.id);
    if (tenants.length === 0) {
      throw new ForbiddenException({ error: 'NO_TENANT', message: 'لا توجد منشأة نشطة لهذا الحساب' });
    }
    const tenant = tenants[0]!;
    const role = tenant.role;

    // الجهاز: موجود؟ ملغى؟ جديد مع فحص الحد
    let device = this.findByDeviceKey(tenant.id, dto.device.device_key);
    const nowIso = new Date().toISOString();
    if (device) {
      if (device.is_revoked === 1) {
        throw new ForbiddenException({
          error: 'DEVICE_REVOKED',
          message: 'تم إلغاء هذا الجهاز من قبل مالك المنشأة — تواصل معه لإعادة تسجيله',
        });
      }
      this.identity.touchDevice(device.id, nowIso);
    } else {
      const activeCount = this.identity.countActiveDevices(tenant.id);
      const limit = tenant.max_devices || getAuthSettings().maxDevices;
      if (activeCount >= limit) {
        throw new ForbiddenException({
          error: 'DEVICE_LIMIT_EXCEEDED',
          message: `تم الوصول لحد الأجهزة (${limit}) — ألغِ جهازًا أو رقِّ الباقة`,
        });
      }
      const newId = randomUUID();
      this.identity.upsertDevice({
        id: newId,
        tenant_id: tenant.id,
        device_key: dto.device.device_key,
        device_name: dto.device.device_name ?? null,
        platform: typeof dto.device.platform === 'string' ? dto.device.platform : 'android',
        app_version: dto.device.app_version ?? null,
        is_primary: 0,
        is_revoked: 0,
        last_seen_at: nowIso,
        registered_at: nowIso,
      });
      device = this.identity.findDevice(tenant.id, newId);
    }
    if (!device) {
      throw new UnauthorizedException({ error: 'INVALID_CREDENTIALS', message: 'تعذّر ربط الجهاز بالجلسة' });
    }

    this.identity.touchUserLogin(user!.id, nowIso);
    const tokens = await this.tokens.issueTokenPair({
      userId: user!.id,
      tenantId: tenant.id,
      deviceId: device.id,
      role,
    });

    return {
      user: { id: user!.id, full_name: user!.full_name },
      tenant: { id: tenant.id, business_name: tenant.business_name, role },
      device: { id: device.id, is_active: true },
      tokens,
    };
  }

  /** POST /auth/refresh — تدوير Rotation مع كشف إعادة الاستخدام */
  async refresh(refreshToken: string): Promise<IssuedTokens> {
    if (!refreshToken || typeof refreshToken !== 'string') {
      throw new UnauthorizedException({ error: 'VALIDATION_ERROR', message: 'refresh_token مطلوب' });
    }
    return this.tokens.rotateRefreshToken(refreshToken);
  }

  /** POST /auth/logout — إنهاء العائلة الحالية (idempotent) */
  async logout(refreshToken: string): Promise<{ revoked: boolean }> {
    const revoked = await this.tokens.revokeRefreshToken(refreshToken ?? '');
    return { revoked };
  }

  /** GET /auth/me — هوية الجلسة الحالية (من JWT بعد الحارس) */
  me(payload: { sub: string; tid: string; dev: string; role: string }) {
    const user = this.identity.findUserById(payload.sub);
    const tenant = this.identity.findTenantById(payload.tid);
    if (!user || !tenant) {
      throw new UnauthorizedException({ error: 'UNAUTHORIZED', message: 'العضوية أو الحساب لم يعودا نشطين' });
    }
    return {
      user: { id: user.id, full_name: user.full_name, phone: user.phone, locale: user.locale },
      tenant: {
        id: tenant.id,
        business_name: tenant.business_name,
        business_type_code: tenant.business_type_code,
        base_currency_code: tenant.base_currency_code,
        onboarding_status: tenant.onboarding_status,
      },
      role: payload.role,
      device_id: payload.dev,
    };
  }

  // ===== الأجهزة (§4.4) =====
  listDevices(tenantId: string) {
    const devices = this.identity.listDevices(tenantId);
    const active = devices.filter((d) => d.is_revoked === 0);
    return {
      data: active.map((d) => ({
        id: d.id,
        device_name: d.device_name,
        platform: d.platform,
        is_primary: d.is_primary === 1,
        last_seen_at: d.last_seen_at,
        is_active: true,
      })),
      meta: { max_devices: getAuthSettings().maxDevices, active_count: active.length },
    };
  }

  revokeDevice(tenantId: string, deviceId: string, requesterRole: string) {
    if (requesterRole !== 'owner') {
      throw new ForbiddenException({ error: 'FORBIDDEN', message: 'إلغاء الأجهزة صلاحية المالك فقط' });
    }
    const device = this.identity.findDevice(tenantId, deviceId);
    if (!device) throw new NotFoundException({ error: 'NOT_FOUND', message: 'الجهاز غير موجود' });
    if (device.is_primary === 1) {
      throw new ForbiddenException({ error: 'CANNOT_REVOKE_PRIMARY', message: 'لا يمكن إلغاء الجهاز الرئيسي للمنشأة' });
    }
    const revoked = this.identity.revokeDevice(tenantId, deviceId);
    // قطع كل جلسات الجهاز الملغى فورًا
    const sessionsKilled = this.identity.revokeAllTokensForDevice(deviceId, new Date().toISOString());
    return { revoked, sessions_killed: sessionsKilled };
  }

  // ===== أدوات =====
  private findByDeviceKey(tenantId: string, deviceKey: string) {
    return this.identity.listDevices(tenantId).find((d) => d.device_key === deviceKey);
  }

  private parseDto<T>(schema: z.ZodType<T>, raw: unknown): T {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const first = parsed.error.errors[0];
      throw new UnauthorizedException({
        error: 'VALIDATION_ERROR',
        message: first ? `الحقل "${first.path.join('.')}" غير صالح: ${first.message}` : 'بيانات غير صالحة',
        status: 422,
      });
    }
    return parsed.data;
  }
}
