// src/auth/auth.module.ts
// ===== وحدة المصادقة والهوية — تُغلّق JwtModule + Passport + الخدمات =====
// ملاحظة معمارية: الهوية تعيش على نفس قاعدة SQLite التي تبنيها CoreModule
// (MVP أحادي العقدة)؛ عند الانتقال لـ Postgres يُستبدل المستودع فقط.
// JWT_VERIFIER: قناة حقن نظيفة للـ middleware متعدد المستأجرين للتحقق من التوكن
// بدون استيراد TokenService مباشرة (يمنع أي اعتماد دائري middleware↔auth).

import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController, DevicesController } from './auth.controller';
import { AuthService } from './auth.service';
import { IdentityRepository } from './identity.repository';
import { JwtStrategy } from './jwt.strategy';
import { PasswordService } from './password.service';
import { ThrottleService } from './throttle.service';
import { TokenService } from './token.service';
import { getAuthSettings } from './auth-config';
import type { AccessPayload } from './token.service';

export const JWT_VERIFIER = Symbol('JWT_VERIFIER');
export type JwtVerifier = (raw: string) => Promise<AccessPayload>;

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: getAuthSettings().jwtSecret,
        // لا expiresIn عام هنا — كل نوع توكن يحدد مدته عند التوقيع صراحةً
      }),
    }),
  ],
  controllers: [AuthController, DevicesController],
  providers: [
    AuthService,
    IdentityRepository,
    JwtStrategy,
    PasswordService,
    ThrottleService,
    TokenService,
    {
      // واجهة ضيقة: التحقق من access token فقط — لا توقيع/تجديد داخل الـ middleware
      provide: JWT_VERIFIER,
      useFactory: (tokens: TokenService): JwtVerifier => (raw) => tokens.verifyAccessToken(raw),
      inject: [TokenService],
    },
  ],
  exports: [AuthService, IdentityRepository, TokenService, PasswordService, ThrottleService, JWT_VERIFIER],
})
@Global()
export class AuthModule {}
