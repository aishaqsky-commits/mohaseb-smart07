import Database from "better-sqlite3";
import { JournalEngine } from "../../application/JournalEngine";
import { ListAccountsService } from "../../application/services/ListAccountsService";
import { ListTemplatesService } from "../../application/services/ListTemplatesService";
import { RecordTransactionService } from "../../application/services/RecordTransactionService";
import { TenantContextProvider } from "../../application/ports/TenantContextProvider";
import { TemplateRegistry } from "../../templates/registry/TemplateRegistry";
import { InventoryCostingPort } from "../../templates/ports/InventoryCostingPort";
import { ExchangeRateProviderPort } from "../../templates/ports/ExchangeRateProviderPort";
import { TemplateDefinition } from "../../templates/types/TemplateDefinition";
export interface CoreContainerConfig {
    tenantId: string;
    baseCurrencyCode: string;
    dbPath?: string;
    templates: TemplateDefinition[];
    /** نطاق نشاط المنشأة (core/retail/clinic/workshop...) لتحديد القوالب الظاهرة في شاشة العمليات */
    scope?: string;
    inventoryPort?: InventoryCostingPort;
    exchangeRateProvider?: ExchangeRateProviderPort;
}
export interface CoreContainer {
    db: Database.Database;
    journalEngine: JournalEngine;
    templateRegistry: TemplateRegistry;
    recordTransactionService: RecordTransactionService;
    listAccountsService: ListAccountsService;
    listTemplatesService: ListTemplatesService;
    tenantContextProvider: TenantContextProvider;
}
/**
 * مركّب الاعتماديات (Composition Root) للنواة.
 * يبني قاعدة SQLite المحلية + يهيّئ المخطط + يسجّل القوالب + يربط حالات الاستخدام.
 * هذا الملف هو المكان الوحيد الذي تُوصَل فيه الطبقات ببعضها — باقي الكود يعتمد على المنافذ فقط.
 */
export declare function createCoreContainer(config: CoreContainerConfig): CoreContainer;
