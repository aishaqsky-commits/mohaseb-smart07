// src/modules/templates/templates.module.ts
// ===== وحدة القوالب: تغذية شاشة "ايش صاير؟" في تطبيق Flutter =====

import { Module, Controller, Get, Inject, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ListTemplatesService, type CoreContainer } from '@platform/core-accounting';
import { SERVICES, CORE_CONTAINER } from '../../core/core.module';
import { containerFromRequest } from '../../common/request-context';

@Controller('api/v1/templates')
export class TemplatesController {
  constructor(
    @Inject(SERVICES.LIST_TEMPLATES)
    private readonly listTemplates: ListTemplatesService,
    @Inject(CORE_CONTAINER)
    private readonly defaultContainer: CoreContainer,
  ) {}

  /** قائمة العمليات السريعة المتاحة لنشاط المنشأة، مرتبة حسب أولوية العرض */
  @Get()
  async list(@Req() req: Request) {
    // تعدد المستأجرين: حاوية سياق الطلب إن حقنها الـ middleware، وإلا الافتراضية (MVP)
    return await containerFromRequest(req, this.defaultContainer).listTemplatesService.execute();
  }
}

@Module({
  controllers: [TemplatesController],
})
export class TemplatesModule {}
