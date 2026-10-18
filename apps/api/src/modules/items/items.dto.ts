// src/modules/items/items.dto.ts
// ===== عقود بيانات الأصناف والمخزون والدفعات =====

import { z } from 'zod';

export const ItemTypeEnum = z.enum(['stock', 'service', 'composite']);
export type ItemType = z.infer<typeof ItemTypeEnum>;

export const CreateItemDtoSchema = z.object({
  name_ar: z.string().min(1, 'اسم الصنف بالعربية مطلوب').max(200),
  sku: z.string().max(64).optional(),
  item_type: ItemTypeEnum.default('stock'),
  has_expiry_date: z.boolean().optional().default(false),
  current_avg_cost: z.union([z.string(), z.number()]).optional().default('0'),
});

export type CreateItemDto = z.infer<typeof CreateItemDtoSchema>;

export const ReceiveStockDtoSchema = z.object({
  warehouse_id: z.string().min(1, 'معرّف المخزن مطلوب').max(64),
  quantity: z.union([z.string(), z.number()]),
  unit_cost: z.union([z.string(), z.number()]),
  batch_number: z.string().max(64).optional(),
  expiry_date: z.string().max(10).optional(), // YYYY-MM-DD
  movement_type: z
    .enum(['purchase_in', 'return_in', 'transfer_in', 'opening_balance', 'inventory_count_adj_in'])
    .default('purchase_in'),
  movement_date: z.string().max(10).optional(),
  source_reference: z.string().optional(),
});

export type ReceiveStockDto = z.infer<typeof ReceiveStockDtoSchema>;

export interface ItemRow {
  id: string;
  tenant_id: string;
  sku: string | null;
  name_ar: string;
  item_type: ItemType;
  has_expiry_date: number;
  current_avg_cost: string;
  is_active: number;
  total_quantity_on_hand?: string;
  total_cost_value?: string;
}

export interface ItemBatchRow {
  id: string;
  tenant_id: string;
  item_id: string;
  warehouse_id: string;
  batch_number: string;
  expiry_date: string | null;
  unit_cost: string;
  quantity_received: string;
  quantity_remaining: string;
  created_at: string;
}

export interface StockBalanceRow {
  tenant_id: string;
  warehouse_id: string;
  item_id: string;
  current_quantity: string;
  total_cost_value: string;
  updated_at: string;
}
