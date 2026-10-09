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
exports.TenantContextMiddleware = void 0;
const common_1 = require("@nestjs/common");
const core_module_1 = require("../core/core.module");
const CASH_TARGET_FIELDS = ['received_to_account', 'deposit_to_account', 'paid_from_account'];
let TenantContextMiddleware = class TenantContextMiddleware {
    container;
    cashAccountCode = null;
    constructor(container) {
        this.container = container;
    }
    async onApplicationBootstrap() {
        const ctx = await this.container.tenantContextProvider.getCurrentContext();
        const accounts = await this.container.listAccountsService.execute();
        const postableCash = accounts
            .filter((a) => a.isPostable && /^110/.test(a.code))
            .sort((a, b) => a.code.localeCompare(b.code));
        if (postableCash.length === 0) {
            throw new common_1.NotFoundException(`لا توجد حسابات نقدية قابلة للترحيل للمنشأة ${ctx.tenantId} — تحقق من زرع شجرة الحسابات`);
        }
        this.cashAccountCode = postableCash[0].code;
    }
    use(req, _res, next) {
        const body = req.body;
        if (body && typeof body === 'object' && body.payload && typeof body.payload === 'object') {
            const payload = body.payload;
            const hasAnyTarget = CASH_TARGET_FIELDS.some((f) => payload[f] !== undefined);
            if (!hasAnyTarget && this.cashAccountCode) {
                payload.received_to_account = this.cashAccountCode;
                payload.deposit_to_account = this.cashAccountCode;
                payload.paid_from_account = this.cashAccountCode;
            }
        }
        next();
    }
};
exports.TenantContextMiddleware = TenantContextMiddleware;
exports.TenantContextMiddleware = TenantContextMiddleware = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(core_module_1.CORE_CONTAINER)),
    __metadata("design:paramtypes", [Object])
], TenantContextMiddleware);
//# sourceMappingURL=tenant-context.middleware.js.map