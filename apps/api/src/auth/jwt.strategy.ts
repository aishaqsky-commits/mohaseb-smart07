// src/auth/jwt.strategy.ts
// ===== استراتيجية passport-jwt: التحقق من التوقيع + رفض أنواع التوكن الخاطئة =====

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { getAuthSettings } from './auth-config';
import type { AccessPayload } from './token.service';
import type { AuthenticatedUser } from './jwt-auth.guard';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    const settings = getAuthSettings();
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false, // لا استثناء أبدًا — صلاحية 15 دقيقة جزء من التصميم الأمني
      secretOrKey: settings.jwtSecret,
      algorithms: ['HS256'], // تثبيت الخوارزمية: منع attack vector عبر typ=none أو تبديل HS/RS
    });
  }

  validate(payload: AccessPayload): AuthenticatedUser {
    if (payload.typ !== 'access' || !payload.sub || !payload.tid || !payload.dev) {
      // refresh token لا يُقبل هنا إطلاقًا، وclaims ناقصة = توكن غير سليم
      throw new UnauthorizedException({ error: 'UNAUTHORIZED', message: 'نوع توكن غير صالح لهذا المسار' });
    }
    // ip يُملأ من الحارس (handleRequest) — هنا تركه فارغًا لأن الاستراتيجية لا ترى الطلب
    return { ...payload, ip: '' };
  }
}
