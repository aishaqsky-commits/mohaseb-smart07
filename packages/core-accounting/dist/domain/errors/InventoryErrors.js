"use strict";
// src/domain/errors/InventoryErrors.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.InvalidStockQuantityError = exports.UnknownWarehouseError = exports.UnknownItemError = exports.InsufficientStockError = void 0;
/**
 * أخطاء وحدة المخزون — كلها أخطاء صلاحية إدخال (400) لا أعطال نظام:
 * السبب الجذري دائمًا في بيانات الطلب أو الرصيد الدفتري، والمستخدم قادر على تصحيحه.
 */
class InsufficientStockError extends Error {
    statusCode = 400;
    errorCode = "INSUFFICIENT_STOCK";
    constructor(itemName, availableQty, requestedQty) {
        super(`الكمية المتوفرة من «${itemName}» هي ${availableQty} فقط — لا يمكن صرف ${requestedQty}`);
        this.name = "InsufficientStockError";
    }
}
exports.InsufficientStockError = InsufficientStockError;
class UnknownItemError extends Error {
    statusCode = 400;
    errorCode = "UNKNOWN_ITEM";
    constructor(itemId) {
        super(`لم يتم العثور على الصنف المطلوب (المعرّف: ${itemId}) ضمن أصناف هذه المنشأة`);
        this.name = "UnknownItemError";
    }
}
exports.UnknownItemError = UnknownItemError;
class UnknownWarehouseError extends Error {
    statusCode = 400;
    errorCode = "UNKNOWN_WAREHOUSE";
    constructor(warehouseId) {
        super(`لم يتم العثور على المخزن المطلوب (المعرّف: ${warehouseId}) ضمن مخازن هذه المنشأة`);
        this.name = "UnknownWarehouseError";
    }
}
exports.UnknownWarehouseError = UnknownWarehouseError;
class InvalidStockQuantityError extends Error {
    statusCode = 400;
    errorCode = "INVALID_STOCK_QUANTITY";
    constructor(raw) {
        super(`كمية غير صالحة: «${String(raw)}» — يجب أن تكون رقمًا موجبًا أكبر من صفر`);
        this.name = "InvalidStockQuantityError";
    }
}
exports.InvalidStockQuantityError = InvalidStockQuantityError;
//# sourceMappingURL=InventoryErrors.js.map