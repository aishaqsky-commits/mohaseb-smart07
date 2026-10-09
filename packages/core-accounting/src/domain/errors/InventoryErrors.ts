// src/domain/errors/InventoryErrors.ts

/**
 * أخطاء وحدة المخزون — كلها أخطاء صلاحية إدخال (400) لا أعطال نظام:
 * السبب الجذري دائمًا في بيانات الطلب أو الرصيد الدفتري، والمستخدم قادر على تصحيحه.
 */
export class InsufficientStockError extends Error {
  readonly statusCode = 400;
  readonly errorCode = "INSUFFICIENT_STOCK";

  constructor(itemName: string, availableQty: number, requestedQty: number) {
    super(
      `الكمية المتوفرة من «${itemName}» هي ${availableQty} فقط — لا يمكن صرف ${requestedQty}`
    );
    this.name = "InsufficientStockError";
  }
}

export class UnknownItemError extends Error {
  readonly statusCode = 400;
  readonly errorCode = "UNKNOWN_ITEM";

  constructor(itemId: string) {
    super(`لم يتم العثور على الصنف المطلوب (المعرّف: ${itemId}) ضمن أصناف هذه المنشأة`);
    this.name = "UnknownItemError";
  }
}

export class UnknownWarehouseError extends Error {
  readonly statusCode = 400;
  readonly errorCode = "UNKNOWN_WAREHOUSE";

  constructor(warehouseId: string) {
    super(`لم يتم العثور على المخزن المطلوب (المعرّف: ${warehouseId}) ضمن مخازن هذه المنشأة`);
    this.name = "UnknownWarehouseError";
  }
}

export class InvalidStockQuantityError extends Error {
  readonly statusCode = 400;
  readonly errorCode = "INVALID_STOCK_QUANTITY";

  constructor(raw: unknown) {
    super(`كمية غير صالحة: «${String(raw)}» — يجب أن تكون رقمًا موجبًا أكبر من صفر`);
    this.name = "InvalidStockQuantityError";
  }
}
