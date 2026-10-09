"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransactionsModule = exports.TransactionsController = void 0;
const common_1 = require("@nestjs/common");
const zod_1 = require("zod");
const core_accounting_1 = require("@platform/core-accounting");
const core_module_1 = require("../../core/core.module");
const api_errors_1 = require("../../common/api-errors");
const RecordTransactionDto = zod_1.z.object({
    templateCode: zod_1.z.string().min(1).max(64),
    payload: zod_1.z.record(zod_1.z.union([zod_1.z.string(), zod_1.z.number(), zod_1.z.boolean(), zod_1.z.null()])),
    warehouseId: zod_1.z.string().max(64).optional(),
});
const MONEY_FIELD_PATTERN = /(amount|total|price|qty|quantity|rate)/i;
function findNegativeMoneyField(payload) {
    for (const [key, value] of Object.entries(payload)) {
        if (!MONEY_FIELD_PATTERN.test(key))
            continue;
        const asString = String(value).replace(/,/g, '');
        const num = Number(asString);
        if (Number.isFinite(num) && num < 0)
            return key;
    }
    return null;
}
let TransactionsController = class TransactionsController {
    recordTransaction;
    constructor(recordTransaction) {
        this.recordTransaction = recordTransaction;
    }
    async record(body) {
        const parsed = RecordTransactionDto.safeParse(body);
        if (!parsed.success) {
            throw (0, api_errors_1.toApiError)(Object.assign(new Error(this.describeZod(parsed.error)), { name: 'InvalidTemplatePayloadError' }));
        }
        const negativeField = findNegativeMoneyField(parsed.data.payload);
        if (negativeField) {
            throw (0, api_errors_1.toApiError)(Object.assign(new Error(`الحقل "${negativeField}" لا يقبل قيمة سالبة`), { name: 'ValidationError' }));
        }
        try {
            const result = await this.recordTransaction.execute(parsed.data);
            return {
                transactionId: result.transactionId,
                summary: result.simpleSummary,
                primaryEntry: this.mapEntry(result.primaryEntry),
                secondaryEntry: result.secondaryEntry ? this.mapEntry(result.secondaryEntry) : null,
            };
        }
        catch (err) {
            throw (0, api_errors_1.toApiError)(err);
        }
    }
    mapEntry(entry) {
        return {
            id: entry.id,
            date: entry.entryDate.toISOString(),
            description: entry.descriptionSimple,
            sourceType: entry.sourceType,
            baseCurrencyCode: entry.baseCurrencyCode,
            lines: entry.lines.map((l) => ({
                order: l.lineOrder,
                accountId: l.accountId,
                side: l.side,
                amount: l.amount.toString(),
                baseAmount: l.baseAmount.toString(),
                memoAr: l.memoAr,
            })),
        };
    }
    describeZod(error) {
        const first = error.errors[0];
        if (!first)
            return 'بيانات غير صالحة';
        return `الحقل "${first.path.join('.')}" غير صالح: ${first.message}`;
    }
};
exports.TransactionsController = TransactionsController;
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], TransactionsController.prototype, "record", null);
exports.TransactionsController = TransactionsController = __decorate([
    (0, common_1.Controller)('api/v1/transactions'),
    __param(0, (0, common_1.Inject)(core_module_1.SERVICES.RECORD_TX)),
    __metadata("design:paramtypes", [core_accounting_1.RecordTransactionService])
], TransactionsController);
let TransactionsModule = class TransactionsModule {
};
exports.TransactionsModule = TransactionsModule;
exports.TransactionsModule = TransactionsModule = __decorate([
    (0, common_1.Module)({
        controllers: [TransactionsController],
    })
], TransactionsModule);
//# sourceMappingURL=transactions.module.js.map