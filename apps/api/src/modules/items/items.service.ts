// src/modules/items/items.service.ts
// ===== خدمة الأصناف والمخزون: الربط مع محرك المخزون (SqliteInventoryStore) =====

import { Injectable, NotFoundException } from '@nestjs/common';
import {
  type CoreContainer,
  SqliteInventoryStore,
} from '@platform/core-accounting';
import { ItemsRepository } from './items.repository';
import type { CreateItemDto, ItemBatchRow, ItemRow, ReceiveStockDto, StockBalanceRow } from './items.dto';

@Injectable()
export class ItemsService {
  private getRepo(container: CoreContainer): ItemsRepository {
    return new ItemsRepository(container.db);
  }

  private getInventoryStore(container: CoreContainer): SqliteInventoryStore {
    return new SqliteInventoryStore(container.db);
  }

  createItem(container: CoreContainer, tenantId: string, dto: CreateItemDto): ItemRow {
    const repo = this.getRepo(container);
    // ضمان وجود مستودع افتراضي للمنشأة
    repo.ensureDefaultWarehouse(tenantId);
    return repo.create(tenantId, dto);
  }

  listItems(
    container: CoreContainer,
    tenantId: string,
    filter?: { item_type?: string; search?: string }
  ): ItemRow[] {
    const repo = this.getRepo(container);
    return repo.list(tenantId, filter);
  }

  getItem(
    container: CoreContainer,
    tenantId: string,
    id: string
  ): ItemRow & { balances: StockBalanceRow[]; batches: ItemBatchRow[] } {
    const repo = this.getRepo(container);
    const item = repo.findById(tenantId, id);
    if (!item) {
      throw new NotFoundException({ error: 'ITEM_NOT_FOUND', message: `الصنف "${id}" غير موجود` });
    }

    const balances = repo.getStockBalances(tenantId, id);
    const batches = repo.getBatches(tenantId, id);

    return {
      ...item,
      balances,
      batches,
    };
  }

  listBatches(
    container: CoreContainer,
    tenantId: string,
    itemId: string,
    warehouseId?: string
  ): ItemBatchRow[] {
    const repo = this.getRepo(container);
    return repo.getBatches(tenantId, itemId, warehouseId);
  }

  receiveStock(
    container: CoreContainer,
    tenantId: string,
    itemId: string,
    dto: ReceiveStockDto
  ): { movementId: string; item: ItemRow } {
    // التأكد من وجود الصنف
    const item = this.getItem(container, tenantId, itemId);
    const store = this.getInventoryStore(container);

    const movementDate = dto.movement_date ?? new Date().toISOString().slice(0, 10);
    const movementId = store.receive({
      itemId,
      warehouseId: dto.warehouse_id,
      quantity: String(dto.quantity),
      unitCost: String(dto.unit_cost),
      batchNumber: dto.batch_number,
      expiryDate: dto.expiry_date,
      movementType: dto.movement_type,
      movementDate,
      sourceReference: dto.source_reference,
    });

    const updated = this.getItem(container, tenantId, itemId);
    return {
      movementId,
      item: updated,
    };
  }

  getStockCard(container: CoreContainer, tenantId: string, itemId: string) {
    this.getItem(container, tenantId, itemId);
    const store = this.getInventoryStore(container);
    return store.movementsForItem(tenantId, itemId);
  }
}
