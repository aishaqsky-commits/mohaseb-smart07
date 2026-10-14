// src/auth/token.service.ts
// ===== إصدار/تحقق JWT + إدارة Refresh Token دوّار مع كشف إعادة الاستخدام =====

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomUUID } from 'node:crypto';
import { IdentityRepository } from './identity.repository';
import { getAuthSettings } from './auth-config';

export interface AccessPayload {
  sub: string; // userId
  tid: string; // tenantId (multi-tenant scoping — المصدر الوحيد لهوية المنشأة)
  dev: string; // deviceId
  role: string;
  /**
   * نشاط المنشأة (business_type_code) — يُستخدم لزرع شجرة الحسابات الصحيحة في
   * TenantContainerResolver. حقل اختياري للتوافق مع توكنات أُصدرت قبل إضافته؛
   * القارئ (middleware السياق) يعالجه بـ `scope ?? 'retail'`.
   */
  scope?: string;
  typ: 'access';
}

export interface RefreshPayload {
  sub: string;
  tid: string;
  dev: string;
  jti: string;
  fam: string; // family id لكشف إعادة الاستخدام
  typ: 'refresh';
}

/** معايير إصدار زوج توكنات — هوية الجلسة كاملة في مكان واحد */
export interface IssueTokenParams {
  userId: string;
  tenantId: string;
  deviceId: string;
  role: string;
  /** نشاط المنشأة وقت الإصدار (يُثبَّت claim `scope` في access و refresh معًا) */
  scope?: string;
  familyId?: string; // عند التدوير نُبقي نفس العائلة
}

export interface IssuedTokens {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
}

export function hashJti(jti: string): string {
  return createHash('sha256').update(jti).digest('hex');
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly identity: IdentityRepository,
  ) {}

  /** إصدار زوج توكنات وجلسة refresh مخزّنة بالبصمة */
  async issueTokenPair(params: IssueTokenParams): Promise<IssuedTokens> {
    const settings = getAuthSettings();
    const now = new Date();
    const jti = randomUUID();
    const familyId = params.familyId ?? randomUUID();
    // scope يُثبَّت في access و refresh معًا — مصدر شجرة الحسابات عند حل الحاوية.
    // حقل اختياري للتوافق؛ القارئ يعالجه بـ `scope ?? 'retail'`.
    const scopeClaim = params.scope ? { scope: params.scope } : {};

    const accessToken = await this.jwt.signAsync(
      { sub: params.userId, tid: params.tenantId, dev: params.deviceId, role: params.role, ...scopeClaim, typ: 'access' },
      { expiresIn: settings.accessTtlSeconds },
    );
    const refreshToken = await this.jwt.signAsync(
      { sub: params.userId, tid: params.tenantId, dev: params.deviceId, ...scopeClaim, jti, fam: familyId, typ: 'refresh' },
      { expiresIn: settings.refreshTtlDays * 24 * 3600 },
    );

    this.identity.insertRefreshToken({
      jti_hash: hashJti(jti),
      user_id: params.userId,
      tenant_id: params.tenantId,
      device_id: params.deviceId,
      family_id: familyId,
      expires_at: new Date(now.getTime() + settings.refreshTtlDays * 24 * 3600_000).toISOString(),
      revoked_at: null,
      replaced_by: null,
      reuse_detected: 0,
      created_at: now.toISOString(),
    });

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'Bearer',
      expires_in: settings.accessTtlSeconds,
    };
  }

  /**
   * تدوير refresh token (Rotation):
   * - توكن غير معروف/منتهي → 401.
   * - توكن مسحوب سابقًا أعيد استخدامه → إلغاء العائلة كاملة (اشتباه سرقة) + 401.
   * - سليم → مسح القديم، إصدار جديد ضمن نفس العائلة.
   */
  async rotateRefreshToken(refreshTokenRaw: string): Promise<IssuedTokens> {
    let payload: RefreshPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshPayload>(refreshTokenRaw);
    } catch {
      throw new UnauthorizedException('توكن التحديث غير صالح أو منتهي الصلاحية');
    }
    if (payload.typ !== 'refresh') {
      throw new UnauthorizedException('نوع التوكن غير صحيح');
    }

    const record = this.identity.findRefreshToken(hashJti(payload.jti));
    const nowIso = new Date().toISOString();

    if (!record) {
      throw new UnauthorizedException('جلسة غير معروفة');
    }
    if (record.revoked_at) {
      // إعادة استخدام توكن مسحوب → أمان قصوى: إسقاط العائلة كلها
      this.identity.markRefreshReuse(record.jti_hash);
      this.identity.revokeFamily(record.family_id, null, nowIso);
      throw new UnauthorizedException('تم اكتشاف إعادة استخدام توكن قديم — أُنهيت جميع جلسات هذا الجهاز');
    }
    if (record.expires_at < nowIso) {
      throw new UnauthorizedException('انتهت صلاحية جلسة التحديث، سجّل الدخول مجددًا');
    }
    // صدق الربط: التوكن يجب أن ينطبق على نفس المستخدم/المنشأة/الجهاز المخزن
    if (record.user_id !== payload.sub || record.tenant_id !== payload.tid || record.device_id !== payload.dev) {
      throw new UnauthorizedException('جلسة غير متسقة');
    }

    // الدور يُقرأ لحظة التدوير (قد يتغير بعد إصدار الجلسة الأصلية)
    const membership = this.identity.findMembership(record.tenant_id, record.user_id);
    if (!membership) {
      throw new UnauthorizedException('لم يعد لديك عضوية نشطة في هذه المنشأة');
    }
    // نشاط المنشأة يُعاد قراءته من القاعدة لحظة التدوير — لا اعتماد على claim قديم
    // قد يكون غائبًا (توكنات أُصدرت قبل إضافة scope) أو بائتًا (تغيّر النشاط).
    const tenant = this.identity.findTenantById(record.tenant_id);
    if (!tenant) {
      // findTenantById يشترط is_active=1 — منشأة موقوفة/محذوفة تسقط جلستها فورًا
      throw new UnauthorizedException('المنشأة لم تعد نشطة — تواصل مع المالك');
    }

    const nextJti = randomUUID();
    const tokens = await this.issueTokenPair({
      userId: record.user_id,
      tenantId: record.tenant_id,
      deviceId: record.device_id,
      role: membership.role,
      scope: tenant.business_type_code,
      familyId: record.family_id,
    });

    // مسح الجذر القديم وربطه بالخلف (إن فشل ما بين الإصدار والمسح فإعادة استخدام القديم تكشفه الحماية تلقائيًا)
    this.identity.markRefreshTokenRotated(record.jti_hash, hashJti(nextJti), nowIso);

    return tokens;
  }

  /**
   * إلغاء جلسة (Logout): مسح التوكن الحالي وإلغاء عائلته كاملة.
   * idempotent — التوكن غير الصالح يعيد false بدون خطأ (العميل يمحو توكناته المحلية بغض النظر).
   */
  async revokeRefreshToken(refreshTokenRaw: string): Promise<boolean> {
    let payload: RefreshPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshPayload>(refreshTokenRaw);
    } catch {
      return false;
    }
    if (payload.typ !== 'refresh') return false;
    const record = this.identity.findRefreshToken(hashJti(payload.jti));
    if (!record) return false;
    this.identity.revokeFamily(record.family_id, null, new Date().toISOString());
    return true;
  }

  verifyAccessToken(raw: string): Promise<AccessPayload> {
    return this.jwt.verifyAsync<AccessPayload>(raw).then((p) => {
      if (p.typ !== 'access') throw new Error('not an access token');
      return p;
    });
  }
}
