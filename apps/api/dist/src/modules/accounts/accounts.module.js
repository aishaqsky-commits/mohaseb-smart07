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
exports.AccountsModule = exports.AccountsController = void 0;
const common_1 = require("@nestjs/common");
const core_accounting_1 = require("@platform/core-accounting");
const core_module_1 = require("../../core/core.module");
let AccountsController = class AccountsController {
    listAccounts;
    constructor(listAccounts) {
        this.listAccounts = listAccounts;
    }
    async list() {
        return this.listAccounts.execute();
    }
};
exports.AccountsController = AccountsController;
__decorate([
    (0, common_1.Get)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AccountsController.prototype, "list", null);
exports.AccountsController = AccountsController = __decorate([
    (0, common_1.Controller)('api/v1/accounts'),
    __param(0, (0, common_1.Inject)(core_module_1.SERVICES.LIST_ACCOUNTS)),
    __metadata("design:paramtypes", [core_accounting_1.ListAccountsService])
], AccountsController);
let AccountsModule = class AccountsModule {
};
exports.AccountsModule = AccountsModule;
exports.AccountsModule = AccountsModule = __decorate([
    (0, common_1.Module)({
        controllers: [AccountsController],
    })
], AccountsModule);
//# sourceMappingURL=accounts.module.js.map