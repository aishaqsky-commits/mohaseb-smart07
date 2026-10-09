"use strict";
// src/index.ts
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCoreContainer = exports.PostActionRegistry = exports.FunctionRegistry = exports.ExpressionEngine = exports.TemplateValidator = exports.TemplateNotFoundError = exports.TemplateRegistry = exports.TemplateExecutionEngine = exports.RecordTransactionService = exports.ListTemplatesService = exports.ListAccountsService = exports.InvalidTemplatePayloadError = exports.AppTemplateNotFoundError = exports.MissingTenantContextError = exports.ApplicationError = exports.TENANT_CONTEXT_PROVIDER = exports.SqliteJournalRepository = exports.SqliteAccountRepository = exports.JournalEngine = exports.JournalLine = exports.JournalEntry = exports.Account = exports.InvalidMoneyOperationError = exports.Money = void 0;
var Money_1 = require("./domain/value-objects/Money");
Object.defineProperty(exports, "Money", { enumerable: true, get: function () { return Money_1.Money; } });
Object.defineProperty(exports, "InvalidMoneyOperationError", { enumerable: true, get: function () { return Money_1.InvalidMoneyOperationError; } });
var Account_1 = require("./domain/entities/Account");
Object.defineProperty(exports, "Account", { enumerable: true, get: function () { return Account_1.Account; } });
var JournalEntry_1 = require("./domain/entities/JournalEntry");
Object.defineProperty(exports, "JournalEntry", { enumerable: true, get: function () { return JournalEntry_1.JournalEntry; } });
var JournalLine_1 = require("./domain/entities/JournalLine");
Object.defineProperty(exports, "JournalLine", { enumerable: true, get: function () { return JournalLine_1.JournalLine; } });
__exportStar(require("./domain/errors/AccountingErrors"), exports);
var JournalEngine_1 = require("./application/JournalEngine");
Object.defineProperty(exports, "JournalEngine", { enumerable: true, get: function () { return JournalEngine_1.JournalEngine; } });
var SqliteAccountRepository_1 = require("./infrastructure/sqlite/SqliteAccountRepository");
Object.defineProperty(exports, "SqliteAccountRepository", { enumerable: true, get: function () { return SqliteAccountRepository_1.SqliteAccountRepository; } });
var SqliteJournalRepository_1 = require("./infrastructure/sqlite/SqliteJournalRepository");
Object.defineProperty(exports, "SqliteJournalRepository", { enumerable: true, get: function () { return SqliteJournalRepository_1.SqliteJournalRepository; } });
var TenantContextProvider_1 = require("./application/ports/TenantContextProvider");
Object.defineProperty(exports, "TENANT_CONTEXT_PROVIDER", { enumerable: true, get: function () { return TenantContextProvider_1.TENANT_CONTEXT_PROVIDER; } });
var ApplicationErrors_1 = require("./application/errors/ApplicationErrors");
Object.defineProperty(exports, "ApplicationError", { enumerable: true, get: function () { return ApplicationErrors_1.ApplicationError; } });
Object.defineProperty(exports, "MissingTenantContextError", { enumerable: true, get: function () { return ApplicationErrors_1.MissingTenantContextError; } });
Object.defineProperty(exports, "AppTemplateNotFoundError", { enumerable: true, get: function () { return ApplicationErrors_1.TemplateNotFoundError; } });
Object.defineProperty(exports, "InvalidTemplatePayloadError", { enumerable: true, get: function () { return ApplicationErrors_1.InvalidTemplatePayloadError; } });
var ListAccountsService_1 = require("./application/services/ListAccountsService");
Object.defineProperty(exports, "ListAccountsService", { enumerable: true, get: function () { return ListAccountsService_1.ListAccountsService; } });
var ListTemplatesService_1 = require("./application/services/ListTemplatesService");
Object.defineProperty(exports, "ListTemplatesService", { enumerable: true, get: function () { return ListTemplatesService_1.ListTemplatesService; } });
var RecordTransactionService_1 = require("./application/services/RecordTransactionService");
Object.defineProperty(exports, "RecordTransactionService", { enumerable: true, get: function () { return RecordTransactionService_1.RecordTransactionService; } });
// ===== محرك القوالب =====
var TemplateExecutionEngine_1 = require("./templates/TemplateExecutionEngine");
Object.defineProperty(exports, "TemplateExecutionEngine", { enumerable: true, get: function () { return TemplateExecutionEngine_1.TemplateExecutionEngine; } });
var TemplateRegistry_1 = require("./templates/registry/TemplateRegistry");
Object.defineProperty(exports, "TemplateRegistry", { enumerable: true, get: function () { return TemplateRegistry_1.TemplateRegistry; } });
Object.defineProperty(exports, "TemplateNotFoundError", { enumerable: true, get: function () { return TemplateRegistry_1.TemplateNotFoundError; } });
var TemplateValidator_1 = require("./templates/validation/TemplateValidator");
Object.defineProperty(exports, "TemplateValidator", { enumerable: true, get: function () { return TemplateValidator_1.TemplateValidator; } });
var ExpressionEngine_1 = require("./templates/engine/ExpressionEngine");
Object.defineProperty(exports, "ExpressionEngine", { enumerable: true, get: function () { return ExpressionEngine_1.ExpressionEngine; } });
var FunctionRegistry_1 = require("./templates/engine/FunctionRegistry");
Object.defineProperty(exports, "FunctionRegistry", { enumerable: true, get: function () { return FunctionRegistry_1.FunctionRegistry; } });
var PostActionPort_1 = require("./templates/ports/PostActionPort");
Object.defineProperty(exports, "PostActionRegistry", { enumerable: true, get: function () { return PostActionPort_1.PostActionRegistry; } });
// ===== التهيئة (Composition Root) =====
var createCoreContainer_1 = require("./infrastructure/bootstrap/createCoreContainer");
Object.defineProperty(exports, "createCoreContainer", { enumerable: true, get: function () { return createCoreContainer_1.createCoreContainer; } });
//# sourceMappingURL=index.js.map