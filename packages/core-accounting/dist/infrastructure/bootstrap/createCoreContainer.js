"use strict";
// src/infrastructure/bootstrap/createCoreContainer.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCoreContainer = createCoreContainer;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const JournalEngine_1 = require("../../application/JournalEngine");
const ListAccountsService_1 = require("../../application/services/ListAccountsService");
const ListTemplatesService_1 = require("../../application/services/ListTemplatesService");
const RecordTransactionService_1 = require("../../application/services/RecordTransactionService");
const SqliteAccountRepository_1 = require("../sqlite/SqliteAccountRepository");
const SqliteJournalRepository_1 = require("../sqlite/SqliteJournalRepository");
const TemplateRegistry_1 = require("../../templates/registry/TemplateRegistry");
const TemplateExecutionEngine_1 = require("../../templates/TemplateExecutionEngine");
const PostActionPort_1 = require("../../templates/ports/PostActionPort");
const decimal_js_1 = __importDefault(require("decimal.js"));
/** بديل محايد للمخزون قبل اكتمال وحدة الجرد — تكلفة صفر مع تحذير صريح */
class NoOpInventoryCostingPort {
    async calculateCogs() {
        return new decimal_js_1.default(0);
    }
    calculateItemsRevenueSum() {
        return new decimal_js_1.default(0);
    }
}
/** سعر صرف ثابت 1: مناسب لعملة أساس واحدة، يُستبدل بمزوّد الأسعار الحقيقي لاحقًا */
class StaticExchangeRateProvider {
    async getRate() {
        return "1";
    }
}
/**
 * مركّب الاعتماديات (Composition Root) للنواة.
 * يبني قاعدة SQLite المحلية + يهيّئ المخطط + يسجّل القوالب + يربط حالات الاستخدام.
 * هذا الملف هو المكان الوحيد الذي تُوصَل فيه الطبقات ببعضها — باقي الكود يعتمد على المنافذ فقط.
 */
function createCoreContainer(config) {
    const db = new better_sqlite3_1.default(config.dbPath ?? ":memory:");
    db.pragma("journal_mode = WAL"); // أداء ومتانة أعلى للكتابة
    db.pragma("foreign_keys = ON");
    const schemaPath = path_1.default.join(__dirname, "../sqlite/schema.sql");
    db.exec(fs_1.default.readFileSync(schemaPath, "utf-8"));
    const accountRepo = new SqliteAccountRepository_1.SqliteAccountRepository(db);
    const journalRepo = new SqliteJournalRepository_1.SqliteJournalRepository(db);
    const journalEngine = new JournalEngine_1.JournalEngine(accountRepo, journalRepo);
    const registry = new TemplateRegistry_1.TemplateRegistry();
    registry.registerMany(config.templates);
    const tenantContextProvider = {
        async getCurrentContext() {
            return {
                tenantId: config.tenantId,
                baseCurrencyCode: config.baseCurrencyCode,
            };
        },
    };
    const templateEngine = new TemplateExecutionEngine_1.TemplateExecutionEngine(registry, journalEngine, config.inventoryPort ?? new NoOpInventoryCostingPort(), config.exchangeRateProvider ?? new StaticExchangeRateProvider(), new PostActionPort_1.PostActionRegistry());
    return {
        db,
        journalEngine,
        templateRegistry: registry,
        recordTransactionService: new RecordTransactionService_1.RecordTransactionService(templateEngine, tenantContextProvider),
        listAccountsService: new ListAccountsService_1.ListAccountsService(accountRepo, tenantContextProvider),
        listTemplatesService: new ListTemplatesService_1.ListTemplatesService(registry, tenantContextProvider, async () => config.scope ?? "core"),
        tenantContextProvider,
    };
}
//# sourceMappingURL=createCoreContainer.js.map