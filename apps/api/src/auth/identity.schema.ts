// src/auth/identity.schema.ts
// ===== مخطط الهوية (SQLite): مستخدمون، منشآت، أعضاء، أجهزة، refresh tokens =====
// يعكس أعمدة database/schemas/001_phase0_core.sql (Postgres) بالأنواع المحلية.
// يُنفَّذ idempotent (IF NOT EXISTS) عند إقلاع وحدة المصادقة على نفس قاعدة النواة.

export const IDENTITY_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS auth_users (
    id              TEXT PRIMARY KEY,
    full_name       TEXT NOT NULL,
    phone           TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    is_platform_admin INTEGER NOT NULL DEFAULT 0,
    two_fa_enabled  INTEGER NOT NULL DEFAULT 0,
    locale          TEXT NOT NULL DEFAULT 'ar-YE',
    is_active       INTEGER NOT NULL DEFAULT 1,
    last_login_at   TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_tenants (
    id                  TEXT PRIMARY KEY,
    business_name       TEXT NOT NULL,
    business_type_code  TEXT NOT NULL,
    base_currency_code  TEXT NOT NULL DEFAULT 'YER',
    owner_user_id       TEXT NOT NULL REFERENCES auth_users(id),
    phone               TEXT,
    onboarding_status   TEXT NOT NULL DEFAULT 'completed',
    max_devices         INTEGER NOT NULL DEFAULT 3,
    is_active           INTEGER NOT NULL DEFAULT 1,
    created_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_tenants_owner ON auth_tenants(owner_user_id);

CREATE TABLE IF NOT EXISTS auth_tenant_users (
    tenant_id   TEXT NOT NULL REFERENCES auth_tenants(id),
    user_id     TEXT NOT NULL REFERENCES auth_users(id),
    role        TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner','manager','accountant','cashier')),
    is_active   INTEGER NOT NULL DEFAULT 1,
    joined_at   TEXT NOT NULL,
    PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS auth_devices (
    id            TEXT PRIMARY KEY,
    tenant_id     TEXT NOT NULL REFERENCES auth_tenants(id),
    device_key    TEXT NOT NULL,
    device_name   TEXT,
    platform      TEXT NOT NULL DEFAULT 'android',
    app_version   TEXT,
    is_primary    INTEGER NOT NULL DEFAULT 0,
    is_revoked    INTEGER NOT NULL DEFAULT 0,
    last_seen_at  TEXT,
    registered_at TEXT NOT NULL,
    UNIQUE (tenant_id, device_key)
);

-- Refresh Token دوّار: نخزّن بصمة SHA-256 للـ jti فقط (لا التوكن الخام أبدًا).
-- reuse_detected: كشف إعادة استخدام التوكن المسحوب → إلغاء العائلة كاملة (نمط OWASP).
CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
    jti_hash        TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES auth_users(id),
    tenant_id       TEXT NOT NULL REFERENCES auth_tenants(id),
    device_id       TEXT NOT NULL REFERENCES auth_devices(id),
    family_id       TEXT NOT NULL,
    expires_at      TEXT NOT NULL,
    revoked_at      TEXT,
    replaced_by     TEXT,
    reuse_detected  INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_refresh_family ON auth_refresh_tokens(family_id);
CREATE INDEX IF NOT EXISTS idx_refresh_user ON auth_refresh_tokens(user_id);
`;
