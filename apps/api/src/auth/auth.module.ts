// src/auth/auth.module.ts
// ===== وحدة المصادقة والهوية — تُغلّق JwtModule + Passport + الخدمات =====
// ملاحظة معمارية: الهوية تعيش على نفس قاعدة SQLite التي تبنيها CoreModule
// (MVP أحادي العقدة)؛ عند الانتقال لـ Postgres يُستبدل المستودع فقط.

import { Global, Module } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController, DevicesController } from './auth.controller';
import { AuthService } from './auth.service';
import { IdentityRepository } from './identity.repository';
import { JwtStrategy } from './jwt.strategy';
import { PasswordService } from './password.service';
import { ThrottleService } from './throttle.service';
import { TokenService } from './token.service';
import { getAuthSettings } from './auth-config';

/** رمز مزوّد التحقق من التوكن — يستهلكه Middleware سياق المنشأة بدون اعتماد دائري */
export const JWT_VERIFIER = Symbol('JWT_VERIFIER');

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
    { provide: JWT_VERIFIER, useExisting: JwtService },
  ],
  exports: [AuthService, IdentityRepository, TokenService, PasswordService, ThrottleService, JWT_VERIFIER],
})
@Global()
export class AuthModule {}
