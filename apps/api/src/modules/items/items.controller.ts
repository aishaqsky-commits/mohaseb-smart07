// src/modules/items/items.controller.ts
// ===== متحكم الأصناف والمخزون والدفعات =====

import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { CoreContainer } from '@platform/core-accounting';
import { CORE_CONTAINER } from '../../core/core.module';
import { containerFromRequest } from '../../common/request-context';
import { OptionalJwtAuthGuard } from '../../auth/optional-jwt-auth.guard';
import { User, type AuthenticatedUser } from '../../auth/jwt-auth.guard';
import { toApiError } from '../../common/api-errors';
import { ItemsService } from './items.service';
import { CreateItemDtoSchema, ReceiveStockDtoSchema } from './items.dto';

function resolveTenantId(user?: AuthenticatedUser, req?: Request): string {
  return user?.tid ?? (req as any)?.tenantId ?? process.env.TENANT_ID ?? 'tenant_demo';
}

@Controller('api/v1/items')
@UseGuards(OptionalJwtAuthGuard)
export class ItemsController {
  constructor(
    private readonly itemsService: ItemsService,
    @Inject(CORE_CONTAINER) private readonly defaultContainer: CoreContainer,
  ) {}

  /** POST /api/v1/items — إنشاء صنف مخزني أو خدمي أو مجمّع */
  @Post()
  async create(@Body() body: unknown, @Req() req: Request, @User() user?: AuthenticatedUser) {
    const parsed = CreateItemDtoSchema.safeParse(body);
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
      const item = this.itemsService.createItem(container, tenantId, parsed.data);
      return { data: item };
    } catch (err) {
      throw toApiError(err);
    }
  }

  /** GET /api/v1/items — استعلام الأصناف مع إجمالي الكميات المتاحة */
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
      const items = this.itemsService.listItems(container, tenantId, {
        item_type: type,
        search,
      });
      return { data: items };
    } catch (err) {
      throw toApiError(err);
    }
  }

  /** GET /api/v1/items/:id — تفاصيل الصنف مع توزيع الأرصدة والدفعات */
  @Get(':id')
  async getOne(@Param('id') id: string, @Req() req: Request, @User() user?: AuthenticatedUser) {
    try {
      const container = containerFromRequest(req, this.defaultContainer);
      const tenantId = resolveTenantId(user, req);
      const item = this.itemsService.getItem(container, tenantId, id);
      return { data: item };
    } catch (err) {
      throw toApiError(err);
    }
  }

  /** GET /api/v1/items/:id/batches — دفعات الصنف مرتبة حسب الصلاحية FEFO */
  @Get(':id/batches')
  async getBatches(
    @Param('id') id: string,
    @Req() req: Request,
    @User() user?: AuthenticatedUser,
    @Query('warehouse_id') warehouseId?: string,
  ) {
    try {
      const container = containerFromRequest(req, this.defaultContainer);
      const tenantId = resolveTenantId(user, req);
      const batches = this.itemsService.listBatches(container, tenantId, id, warehouseId);
      return { data: batches };
    } catch (err) {
      throw toApiError(err);
    }
  }

  /** GET /api/v1/items/:id/stock-card — كشف حركة الصنف (Stock Card) */
  @Get(':id/stock-card')
  async getStockCard(@Param('id') id: string, @Req() req: Request, @User() user?: AuthenticatedUser) {
    try {
      const container = containerFromRequest(req, this.defaultContainer);
      const tenantId = resolveTenantId(user, req);
      const movements = this.itemsService.getStockCard(container, tenantId, id);
      return { data: movements };
    } catch (err) {
      throw toApiError(err);
    }
  }

  /** POST /api/v1/items/:id/receive — استلام مخزني (شراء/افتتاحي/تحويل) مع تحديث الدفعات */
  @Post(':id/receive')
  async receive(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request,
    @User() user?: AuthenticatedUser,
  ) {
    const parsed = ReceiveStockDtoSchema.safeParse(body);
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
      const result = this.itemsService.receiveStock(container, tenantId, id, parsed.data);
      return { data: result };
    } catch (err) {
      throw toApiError(err);
    }
  }
}
