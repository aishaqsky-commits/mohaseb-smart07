// src/auth/identity.repository.ts
// ===== مستودع الهوية: وصول SQLite لمستخدم/منشأة/عضوية/جهاز/refresh token =====
// كل الاستعلامات مُعامَلة (prepared) مرة واحدة — نمط بقية المستودعات في المشروع.

import { Injectable, OnApplicationBootstrap, Inject } from '@nestjs/common';
import type Database from 'better-sqlite3';
import { CORE_CONTAINER } from '../core/core.module';
import { IDENTITY_SCHEMA_SQL } from './identity.schema';

export interface UserRow {
  id: string;
  full_name: string;
  phone: string;
  password_hash: string;
  is_platform_admin: number;
  two_fa_enabled: number;
  locale: string;
  is_active: number;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TenantRow {
  id: string;
  business_name: string;
  business_type_code: string;
  base_currency_code: string;
  owner_user_id: string;
  phone: string | null;
  onboarding_status: string;
  max_devices: number;
  is_active: number;
  created_at: string;
}

export interface MembershipRow {
  tenant_id: string;
  user_id: string;
  role: string;
  is_active: number;
}

export interface DeviceRow {
  id: string;
  tenant_id: string;
  device_key: string;
  device_name: string | null;
  platform: string;
  app_version: string | null;
  is_primary: number;
  is_revoked: number;
  last_seen_at: string | null;
  registered_at: string;
}

export interface RefreshTokenRow {
  jti_hash: string;
  user_id: string;
  tenant_id: string;
  device_id: string;
  family_id: string;
  expires_at: string;
  revoked_at: string | null;
  replaced_by: string | null;
  reuse_detected: number;
  created_at: string;
}

@Injectable()
export class IdentityRepository implements OnApplicationBootstrap {
  private db!: Database.Database;

  constructor(@Inject(CORE_CONTAINER) private readonly containerRef: { db: Database.Database }) {}

  onApplicationBootstrap(): void {
    this.db = this.containerRef.db;
    // تنفيذ المخطط idempotent عند الإقلاع (ذريًا عبر معاملة واحدة)
    this.db.transaction(() => this.db.exec(IDENTITY_SCHEMA_SQL))();
  }

  // ===== users =====
  insertUser(u: UserRow): void {
    this.db
      .prepare(
        `INSERT INTO auth_users (id, full_name, phone, password_hash, is_platform_admin, two_fa_enabled, locale, is_active, last_login_at, created_at, updated_at)
         VALUES (@id, @full_name, @phone, @password_hash, @is_platform_admin, @two_fa_enabled, @locale, @is_active, @last_login_at, @created_at, @updated_at)`
      )
      .run(u);
  }

  findUserByPhone(phone: string): UserRow | undefined {
    return this.db.prepare('SELECT * FROM auth_users WHERE phone = ? AND is_active = 1').get(phone) as
      | UserRow
      | undefined;
  }

  findUserById(id: string): UserRow | undefined {
    return this.db.prepare('SELECT * FROM auth_users WHERE id = ? AND is_active = 1').get(id) as
      | UserRow
      | undefined;
  }

  touchUserLogin(userId: string, at: string): void {
    this.db.prepare('UPDATE auth_users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(at, at, userId);
  }

  /** ترقية شفافة لبارامترات التشفير بعد نجاح الدخول */
  updatePasswordHash(userId: string, newHash: string, at: string): void {
    this.db.prepare('UPDATE auth_users SET password_hash = ?, updated_at = ? WHERE id = ?').run(newHash, at, userId);
  }

  // ===== tenants =====
  insertTenant(t: TenantRow): void {
    this.db
      .prepare(
        `INSERT INTO auth_tenants (id, business_name, business_type_code, base_currency_code, owner_user_id, phone, onboarding_status, max_devices, is_active, created_at)
         VALUES (@id, @business_name, @business_type_code, @base_currency_code, @owner_user_id, @phone, @onboarding_status, @max_devices, @is_active, @created_at)`
      )
      .run(t);
  }

  findTenantById(id: string): TenantRow | undefined {
    return this.db.prepare('SELECT * FROM auth_tenants WHERE id = ? AND is_active = 1').get(id) as
      | TenantRow
      | undefined;
  }

  // ===== memberships =====
  insertMembership(m: MembershipRow): void {
    this.db
      .prepare(
        `INSERT INTO auth_tenant_users (tenant_id, user_id, role, is_active, joined_at)
         VALUES (@tenant_id, @user_id, @role, @is_active, @joined_at)`
      )
      .run({ ...m, joined_at: new Date().toISOString() });
  }

  findMembership(tenantId: string, userId: string): MembershipRow | undefined {
    return this.db
      .prepare('SELECT * FROM auth_tenant_users WHERE tenant_id = ? AND user_id = ? AND is_active = 1')
      .get(tenantId, userId) as MembershipRow | undefined;
  }

  /**
   * منشآت المستخدم النشطة — مرتبة قطعيًا (created_at ثم id):
   * قرار معماري موثّق: login يختار أول منشأة (MVP بلا مبدّل منشآت)، لذا الترتيب
   * يجب أن يكون حتميًا وإلا كانت هوية الجلسة عشوائية بين منشأتين لمستخدم واحد.
   */
  listTenantsForUser(userId: string): Array<TenantRow & { role: string }> {
    return this.db
      .prepare(
        `SELECT t.*, m.role FROM auth_tenants t
         JOIN auth_tenant_users m ON m.tenant_id = t.id
         WHERE m.user_id = ? AND m.is_active = 1 AND t.is_active = 1
         ORDER BY t.created_at ASC, t.id ASC`
      )
      .all(userId) as Array<TenantRow & { role: string }>;
  }

  // ===== devices =====
  upsertDevice(d: DeviceRow): void {
    this.db
      .prepare(
        `INSERT INTO auth_devices (id, tenant_id, device_key, device_name, platform, app_version, is_primary, is_revoked, last_seen_at, registered_at)
         VALUES (@id, @tenant_id, @device_key, @device_name, @platform, @app_version, @is_primary, @is_revoked, @last_seen_at, @registered_at)
         ON CONFLICT (tenant_id, device_key) DO UPDATE SET
           device_name = excluded.device_name,
           platform = excluded.platform,
           app_version = excluded.app_version,
           last_seen_at = excluded.last_seen_at`
      )
      .run(d);
  }

  findDevice(tenantId: string, deviceId: string): DeviceRow | undefined {
    return this.db
      .prepare('SELECT * FROM auth_devices WHERE tenant_id = ? AND id = ?')
      .get(tenantId, deviceId) as DeviceRow | undefined;
  }

  countActiveDevices(tenantId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM auth_devices WHERE tenant_id = ? AND is_revoked = 0')
      .get(tenantId) as { n: number };
    return row.n;
  }

  touchDevice(deviceId: string, at: string): void {
    this.db.prepare('UPDATE auth_devices SET last_seen_at = ? WHERE id = ?').run(at, deviceId);
  }

  revokeDevice(tenantId: string, deviceId: string): boolean {
    const info = this.db
      .prepare('UPDATE auth_devices SET is_revoked = 1 WHERE tenant_id = ? AND id = ? AND is_revoked = 0')
      .run(tenantId, deviceId);
    return info.changes > 0;
  }

  // ===== refresh tokens =====
  insertRefreshToken(r: RefreshTokenRow): void {
    this.db
      .prepare(
        `INSERT INTO auth_refresh_tokens (jti_hash, user_id, tenant_id, device_id, family_id, expires_at, revoked_at, replaced_by, reuse_detected, created_at)
         VALUES (@jti_hash, @user_id, @tenant_id, @device_id, @family_id, @expires_at, @revoked_at, @replaced_by, @reuse_detected, @created_at)`
      )
      .run(r);
  }

  findRefreshToken(jtiHash: string): RefreshTokenRow | undefined {
    return this.db.prepare('SELECT * FROM auth_refresh_tokens WHERE jti_hash = ?').get(jtiHash) as
      | RefreshTokenRow
      | undefined;
  }

  markRefreshTokenRotated(jtiHash: string, replacedBy: string, at: string): void {
    this.db
      .prepare('UPDATE auth_refresh_tokens SET revoked_at = ?, replaced_by = ? WHERE jti_hash = ?')
      .run(at, replacedBy, jtiHash);
  }

  markRefreshReuse(jtiHash: string): void {
    this.db.prepare('UPDATE auth_refresh_tokens SET reuse_detected = 1 WHERE jti_hash = ?').run(jtiHash);
  }

  /** إلغاء عائلة refresh tokens كاملة (كشف سرقة/إعادة استخدام أو إلغاء جهاز) */
  revokeFamily(familyId: string, exceptJtiHash: string | null, at: string): number {
    const info = this.db
      .prepare(
        `UPDATE auth_refresh_tokens SET revoked_at = ?
         WHERE family_id = ? AND revoked_at IS NULL AND (? IS NULL OR jti_hash != ?)`
      )
      .run(at, familyId, exceptJtiHash, exceptJtiHash ?? '');
    return info.changes;
  }

  revokeAllTokensForDevice(deviceId: string, at: string): number {
    const info = this.db
      .prepare('UPDATE auth_refresh_tokens SET revoked_at = ? WHERE device_id = ? AND revoked_at IS NULL')
      .run(at, deviceId);
    return info.changes;
  }

  /** تنظيف دوري: التوكنات القديمة المنتهية (يُستدعى من مهمة مجدولة) */
  purgeExpiredRefreshTokens(beforeIso: string): number {
    const info = this.db
      .prepare('DELETE FROM auth_refresh_tokens WHERE expires_at < ?')
      .run(beforeIso);
    return info.changes;
  }

  listDevices(tenantId: string): DeviceRow[] {
    return this.db
      .prepare('SELECT * FROM auth_devices WHERE tenant_id = ? ORDER BY registered_at ASC')
      .all(tenantId) as DeviceRow[];
  }

  /** هل الهاتف محجوز مسبقًا لمنشأة أخرى؟ (حماية استباقية قبل إنشاء الحساب) */
  isPhoneTaken(phone: string): boolean {
    const row = this.db.prepare('SELECT 1 AS x FROM auth_users WHERE phone = ?').get(phone);
    return row !== undefined;
  }
}
