// src/health.controller.ts
// ===== فحص الصحة — يثبت أن النواة والقوالب والحسابات مُحمّلة فعلياً =====

import { Controller, Get, Inject } from '@nestjs/common';
import type { CoreContainer } from '@platform/core-accounting';
import { CORE_CONTAINER } from './core/core.module';

@Controller('health')
export class HealthController {
  constructor(@Inject(CORE_CONTAINER) private readonly container: CoreContainer) {}

  @Get()
  status() {
    return {
      status: 'ok',
      service: 'mohaseb-api',
      version: process.env.npm_package_version ?? '0.1.0',
      core: 'loaded',
    };
  }

  /** نقطة تحقق إضافية للتشخيص: عدد القوالب والحسابات المزروعة */
  @Get('bootstrap')
  bootstrapInfo() {
    const row = this.container.db
      .prepare('SELECT COUNT(*) AS c FROM accounts')
      .get() as { c: number };
    return {
      accountsSeeded: row.c,
      templatesLoaded: this.container.templateRegistry.listByScope('core').length,
    };
  }
}
