/**
 * أخطاء وحدة المخزون — كلها أخطاء صلاحية إدخال (400) لا أعطال نظام:
 * السبب الجذري دائمًا في بيانات الطلب أو الرصيد الدفتري، والمستخدم قادر على تصحيحه.
 */
export declare class InsufficientStockError extends Error {
    readonly statusCode = 400;
    readonly errorCode = "INSUFFICIENT_STOCK";
    constructor(itemName: string, availableQty: number, requestedQty: number);
}
export declare class UnknownItemError extends Error {
    readonly statusCode = 400;
    readonly errorCode = "UNKNOWN_ITEM";
    constructor(itemId: string);
}
export declare class UnknownWarehouseError extends Error {
    readonly statusCode = 400;
    readonly errorCode = "UNKNOWN_WAREHOUSE";
    constructor(warehouseId: string);
}
export declare class InvalidStockQuantityError extends Error {
    readonly statusCode = 400;
    readonly errorCode = "INVALID_STOCK_QUANTITY";
    constructor(raw: unknown);
}
