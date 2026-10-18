"use strict";
// src/application/services/RecordTransactionService.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.RecordTransactionService = void 0;
const ApplicationErrors_1 = require("../errors/ApplicationErrors");
/**
 * حالة الاستخدام المركزية في النظام بأكمله: "سجّل عملية".
 * أي زر يضغطه التاجر (بعت، اشتريت، مصروف...) يمر من هنا حصريًا:
 * سياق المستأجر ← محرك القوالب ← محرك القيود ← المستودع الذري.
 * لا يُسمح لأي طبقة عرض أو API بتكوين قيود يدويًا — نقطة تحكم واحدة للتدقيق.
 */
class RecordTransactionService {
    templateEngine;
    tenantContextProvider;
    constructor(templateEngine, tenantContextProvider) {
        this.templateEngine = templateEngine;
        this.tenantContextProvider = tenantContextProvider;
    }
    async execute(command) {
        const ctx = await this.tenantContextProvider.getCurrentContext();
        if (!ctx?.tenantId)
            throw new ApplicationErrors_1.MissingTenantContextError();
        return this.templateEngine.execute({
            templateCode: command.templateCode,
            tenantId: ctx.tenantId,
            baseCurrencyCode: ctx.baseCurrencyCode,
            payload: command.payload,
            ...(command.warehouseId !== undefined ? { warehouseId: command.warehouseId } : {}),
        });
    }
}
exports.RecordTransactionService = RecordTransactionService;
//# sourceMappingURL=RecordTransactionService.js.map