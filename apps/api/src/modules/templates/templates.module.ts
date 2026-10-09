// src/modules/templates/templates.module.ts
// ===== وحدة القوالب: تغذية شاشة "ايش صاير؟" في تطبيق Flutter =====

import { Module, Controller, Get, Inject } from '@nestjs/common';
import { ListTemplatesService } from '@platform/core-accounting';
import { SERVICES } from '../../core/core.module';

@Controller('api/v1/templates')
export class TemplatesController {
  constructor(
    @Inject(SERVICES.LIST_TEMPLATES)
    private readonly listTemplates: ListTemplatesService,
  ) {}

  /** قائمة العمليات السريعة المتاحة لنشاط المنشأة، مرتبة حسب أولوية العرض */
  @Get()
  async list() {
    return this.listTemplates.execute();
  }
}

@Module({
  controllers: [TemplatesController],
})
export class TemplatesModule {}
