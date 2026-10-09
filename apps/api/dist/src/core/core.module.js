"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var CoreModule_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CoreModule = exports.SERVICES = exports.CORE_CONTAINER = void 0;
const common_1 = require("@nestjs/common");
const core_accounting_1 = require("@platform/core-accounting");
const load_templates_1 = require("../common/load-templates");
const load_accounts_seed_1 = require("../common/load-accounts-seed");
exports.CORE_CONTAINER = Symbol('CORE_CONTAINER');
exports.SERVICES = {
    RECORD_TX: 'RECORD_TX_SERVICE',
    LIST_ACCOUNTS: 'LIST_ACCOUNTS_SERVICE',
    LIST_TEMPLATES: 'LIST_TEMPLATES_SERVICE',
};
let CoreModule = CoreModule_1 = class CoreModule {
    static forRoot(options = {}) {
        const containerProvider = {
            provide: exports.CORE_CONTAINER,
            useFactory: () => {
                const tenantId = options.tenantId ?? process.env.TENANT_ID ?? 'tenant_demo';
                const scope = options.scope ?? process.env.BUSINESS_SCOPE ?? 'retail';
                const container = (0, core_accounting_1.createCoreContainer)({
                    tenantId,
                    baseCurrencyCode: options.baseCurrencyCode ?? process.env.BASE_CURRENCY ?? 'YER',
                    dbPath: options.dbPath ?? process.env.DB_PATH ?? ':memory:',
                    scope,
                    templates: (0, load_templates_1.loadBundledTemplates)(),
                });
                (0, load_accounts_seed_1.seedAccountsIntoSqlite)(container.db, tenantId, scope);
                return container;
            },
        };
        const serviceProviders = [
            {
                provide: exports.SERVICES.RECORD_TX,
                useFactory: (c) => c.recordTransactionService,
                inject: [exports.CORE_CONTAINER],
            },
            {
                provide: exports.SERVICES.LIST_ACCOUNTS,
                useFactory: (c) => c.listAccountsService,
                inject: [exports.CORE_CONTAINER],
            },
            {
                provide: exports.SERVICES.LIST_TEMPLATES,
                useFactory: (c) => c.listTemplatesService,
                inject: [exports.CORE_CONTAINER],
            },
        ];
        return {
            module: CoreModule_1,
            providers: [containerProvider, ...serviceProviders],
            exports: [exports.CORE_CONTAINER, ...serviceProviders.map((p) => p.provide)],
        };
    }
};
exports.CoreModule = CoreModule;
exports.CoreModule = CoreModule = CoreModule_1 = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({})
], CoreModule);
//# sourceMappingURL=core.module.js.map