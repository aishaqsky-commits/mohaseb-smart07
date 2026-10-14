// src/auth/auth.controller.ts
// ===== نقاط نهاية المصادقة والأجهزة (§4.3 §4.4 من مواصفات API) =====

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard, RolesGuard, Roles, User, AuthenticatedUser } from './jwt-auth.guard';

@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** POST /auth/register — حساب مالك + منشأة جديدة (يتطلب اتصالًا، لا يعمل دون نت) */
  @Post('register')
  async register(@Body() body: unknown) {
    const data = await this.auth.register(body);
    return { data };
  }

  /** POST /auth/login */
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Ip() ip: string) {
    const data = await this.auth.login(body, ip ?? '');
    return { data };
  }

  /** POST /auth/refresh — تدوير Rotation */
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() body: { refresh_token?: string }) {
    const data = await this.auth.refresh(body?.refresh_token ?? '');
    return { data };
  }

  /** POST /auth/logout — إنهاء العائلة الحالية (idempotent، لا يتطلب توكن صالح) */
  @Post('logout')
  @HttpCode(200)
  async logout(@Body() body: { refresh_token?: string }) {
    const data = await this.auth.logout(body?.refresh_token ?? '');
    return { data };
  }

  /** GET /auth/me — هوية الجلسة (محمي) */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@User() user: AuthenticatedUser) {
    return { data: this.auth.me(user) };
  }
}

@Controller('api/v1/devices')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DevicesController {
  constructor(private readonly auth: AuthService) {}

  /** GET /devices — أجهزة المنشأة النشطة + الحد */
  @Get()
  list(@User() user: AuthenticatedUser) {
    return this.auth.listDevices(user.tid);
  }

  /** PATCH /devices/:id/revoke — المالك فقط (§4.4) */
  @Roles('owner')
  @Post(':id/revoke')
  revoke(@User() user: AuthenticatedUser, @Param('id') deviceId: string) {
    return this.auth.revokeDevice(user.tid, deviceId, user.role);
  }
}
