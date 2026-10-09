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
exports.HealthController = void 0;
const common_1 = require("@nestjs/common");
const core_module_1 = require("./core/core.module");
let HealthController = class HealthController {
    container;
    constructor(container) {
        this.container = container;
    }
    status() {
        return {
            status: 'ok',
            service: 'mohaseb-api',
            version: process.env.npm_package_version ?? '0.1.0',
            core: 'loaded',
        };
    }
    bootstrapInfo() {
        const row = this.container.db
            .prepare('SELECT COUNT(*) AS c FROM accounts')
            .get();
        return {
            accountsSeeded: row.c,
            templatesLoaded: this.container.templateRegistry.listByScope('core').length,
        };
    }
};
exports.HealthController = HealthController;
__decorate([
    (0, common_1.Get)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], HealthController.prototype, "status", null);
__decorate([
    (0, common_1.Get)('bootstrap'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], HealthController.prototype, "bootstrapInfo", null);
exports.HealthController = HealthController = __decorate([
    (0, common_1.Controller)('health'),
    __param(0, (0, common_1.Inject)(core_module_1.CORE_CONTAINER)),
    __metadata("design:paramtypes", [Object])
], HealthController);
//# sourceMappingURL=health.controller.js.map