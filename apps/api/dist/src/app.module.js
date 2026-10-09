"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const core_module_1 = require("./core/core.module");
const templates_module_1 = require("./modules/templates/templates.module");
const accounts_module_1 = require("./modules/accounts/accounts.module");
const transactions_module_1 = require("./modules/transactions/transactions.module");
const health_controller_1 = require("./health.controller");
const tenant_context_middleware_1 = require("./middleware/tenant-context.middleware");
let AppModule = class AppModule {
    configure(consumer) {
        consumer.apply(tenant_context_middleware_1.TenantContextMiddleware).forRoutes('api/v1/transactions');
    }
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [core_module_1.CoreModule.forRoot(), templates_module_1.TemplatesModule, accounts_module_1.AccountsModule, transactions_module_1.TransactionsModule],
        controllers: [health_controller_1.HealthController],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map