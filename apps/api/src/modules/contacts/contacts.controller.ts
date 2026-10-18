// src/modules/contacts/contacts.controller.ts
// ===== متحكم جهات الاتصال: إدارة العملاء والموردين ودفتر الذمم الفرعية =====

import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { CoreContainer, SubledgerType } from '@platform/core-accounting';
import { CORE_CONTAINER } from '../../core/core.module';
import { containerFromRequest } from '../../common/request-context';
import { OptionalJwtAuthGuard } from '../../auth/optional-jwt-auth.guard';
import { User, type AuthenticatedUser } from '../../auth/jwt-auth.guard';
import { toApiError } from '../../common/api-errors';
import { ContactsService } from './contacts.service';
import { CreateContactDtoSchema } from './contacts.dto';
import { z } from 'zod';

const CreditHoldDtoSchema = z.object({
  is_hold: z.boolean(),
  credit_limit: z.union([z.string(), z.number()]).optional(),
});

function resolveTenantId(user?: AuthenticatedUser, req?: Request): string {
  return user?.tid ?? (req as any)?.tenantId ?? process.env.TENANT_ID ?? 'tenant_demo';
}

@Controller('api/v1/contacts')
@UseGuards(OptionalJwtAuthGuard)
export class ContactsController {
  constructor(
    private readonly contactsService: ContactsService,
    @Inject(CORE_CONTAINER) private readonly defaultContainer: CoreContainer,
  ) {}

  /** POST /api/v1/contacts — إنشاء عميل / مورد / موظف جديد */
  @Post()
  async create(@Body() body: unknown, @Req() req: Request, @User() user?: AuthenticatedUser) {
    const parsed = CreateContactDtoSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.errors[0];
      throw toApiError(
        Object.assign(new Error(`الحقل "${first?.path.join('.')}" غير صالح: ${first?.message}`), {
          name: 'ValidationError',
        }),
      );
    }

    try {
      const container = containerFromRequest(req, this.defaultContainer);
      const tenantId = resolveTenantId(user, req);
      const contact = this.contactsService.createContact(container, tenantId, parsed.data);
      return { data: contact };
    } catch (err) {
      throw toApiError(err);
    }
  }

  /** GET /api/v1/contacts — استعلام قائمة جهات الاتصال مع الأرصدة الحالية */
  @Get()
  async list(
    @Req() req: Request,
    @User() user?: AuthenticatedUser,
    @Query('type') type?: string,
    @Query('search') search?: string,
  ) {
    try {
      const container = containerFromRequest(req, this.defaultContainer);
      const tenantId = resolveTenantId(user, req);
      const contacts = this.contactsService.listContacts(container, tenantId, {
        contact_type: type,
        search,
      });
      return { data: contacts };
    } catch (err) {
      throw toApiError(err);
    }
  }

  /** GET /api/v1/contacts/:id — تفاصيل جهة الاتصال مع حالة الائتمان */
  @Get(':id')
  async getOne(@Param('id') id: string, @Req() req: Request, @User() user?: AuthenticatedUser) {
    try {
      const container = containerFromRequest(req, this.defaultContainer);
      const tenantId = resolveTenantId(user, req);
      const contact = this.contactsService.getContact(container, tenantId, id);
      return { data: contact };
    } catch (err) {
      throw toApiError(err);
    }
  }

  /** GET /api/v1/contacts/:id/balance — الرصيد الفوري من دفتر الذمم الفرعية */
  @Get(':id/balance')
  async getBalance(@Param('id') id: string, @Req() req: Request, @User() user?: AuthenticatedUser) {
    try {
      const container = containerFromRequest(req, this.defaultContainer);
      const tenantId = resolveTenantId(user, req);
      const contact = this.contactsService.getContact(container, tenantId, id);
      return { data: contact.balance };
    } catch (err) {
      throw toApiError(err);
    }
  }

  /** GET /api/v1/contacts/:id/statement — كشف حساب مفصل بالأحداث */
  @Get(':id/statement')
  async getStatement(@Param('id') id: string, @Req() req: Request, @User() user?: AuthenticatedUser) {
    try {
      const container = containerFromRequest(req, this.defaultContainer);
      const tenantId = resolveTenantId(user, req);
      const statement = this.contactsService.getStatement(container, tenantId, id);
      return { data: statement };
    } catch (err) {
      throw toApiError(err);
    }
  }

  /** GET /api/v1/contacts/:id/open-items — البنود المفتوحة المعلقة للطرف */
  @Get(':id/open-items')
  async getOpenItems(
    @Param('id') id: string,
    @Req() req: Request,
    @User() user?: AuthenticatedUser,
    @Query('category') category?: SubledgerType,
  ) {
    try {
      const container = containerFromRequest(req, this.defaultContainer);
      const tenantId = resolveTenantId(user, req);
      const openItems = this.contactsService.getOpenItems(container, tenantId, id, category);
      return { data: openItems };
    } catch (err) {
      throw toApiError(err);
    }
  }

  /** PATCH /api/v1/contacts/:id/credit-hold — تجميد أو رفع تجميد الائتمان وتحديث السقف */
  @Patch(':id/credit-hold')
  async updateCreditHold(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request,
    @User() user?: AuthenticatedUser,
  ) {
    const parsed = CreditHoldDtoSchema.safeParse(body);
    if (!parsed.success) {
      throw toApiError(
        Object.assign(new Error('بيانات سقف الائتمان غير صالحة'), { name: 'ValidationError' }),
      );
    }

    try {
      const container = containerFromRequest(req, this.defaultContainer);
      const tenantId = resolveTenantId(user, req);
      const updated = this.contactsService.updateCreditHold(
        container,
        tenantId,
        id,
        parsed.data.is_hold,
        parsed.data.credit_limit ? String(parsed.data.credit_limit) : undefined,
      );
      return { data: updated };
    } catch (err) {
      throw toApiError(err);
    }
  }
}
