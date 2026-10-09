// src/infrastructure/bootstrap/createCoreContainer.ts

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

import { JournalEngine } from "../../application/JournalEngine";
import { ListAccountsService } from "../../application/services/ListAccountsService";
import { ListTemplatesService } from "../../application/services/ListTemplatesService";
import { RecordTransactionService } from "../../application/services/RecordTransactionService";
import {
  TenantContextProvider,
  TenantContext,
} from "../../application/ports/TenantContextProvider";
import { SqliteAccountRepository } from "../sqlite/SqliteAccountRepository";
import { SqliteJournalRepository } from "../sqlite/SqliteJournalRepository";
import { TemplateRegistry } from "../../templates/registry/TemplateRegistry";
import { TemplateExecutionEngine } from "../../templates/TemplateExecutionEngine";
import { PostActionRegistry } from "../../templates/ports/PostActionPort";
import { InventoryCostingPort } from "../../templates/ports/InventoryCostingPort";
import { ExchangeRateProviderPort } from "../../templates/ports/ExchangeRateProviderPort";
import { TemplateDefinition } from "../../templates/types/TemplateDefinition";
import Decimal from "decimal.js";

export interface CoreContainerConfig {
  tenantId: string;
  baseCurrencyCode: string;
  dbPath?: string; // ":memory:" افتراضيًا (اختبارات/تطوير)
  templates: TemplateDefinition[];
  inventoryPort?: InventoryCostingPort;
  exchangeRateProvider?: ExchangeRateProviderPort;
}

/** بديل محايد للمخزون قبل اكتمال وحدة الجرد — تكلفة صفر مع تحذير صريح */
class NoOpInventoryCostingPort implements InventoryCostingPort {
  async calculateCogs(): Promise<Decimal> {
    return new Decimal(0);
  }
  calculateItemsRevenueSum(): Decimal {
    return new Decimal(0);
  }
}

/** سعر صرف ثابت 1: مناسب لعملة أساس واحدة، يُستبدل بمزوّد الأسعار الحقيقي لاحقًا */
class StaticExchangeRateProvider implements ExchangeRateProviderPort {
  async getRate(): Promise<string> {
    return "1";
  }
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
export function createCoreContainer(config: CoreContainerConfig): CoreContainer {
  const db = new Database(config.dbPath ?? ":memory:");
  db.pragma("journal_mode = WAL"); // أداء ومتانة أعلى للكتابة
  db.pragma("foreign_keys = ON");

  const schemaPath = path.join(__dirname, "../sqlite/schema.sql");
  db.exec(fs.readFileSync(schemaPath, "utf-8"));

  const accountRepo = new SqliteAccountRepository(db);
  const journalRepo = new SqliteJournalRepository(db);
  const journalEngine = new JournalEngine(accountRepo, journalRepo);

  const registry = new TemplateRegistry();
  registry.registerMany(config.templates);

  const tenantContextProvider: TenantContextProvider = {
    async getCurrentContext(): Promise<TenantContext> {
      return {
        tenantId: config.tenantId,
        baseCurrencyCode: config.baseCurrencyCode,
      };
    },
  };

  const templateEngine = new TemplateExecutionEngine(
    registry,
    journalEngine,
    config.inventoryPort ?? new NoOpInventoryCostingPort(),
    config.exchangeRateProvider ?? new StaticExchangeRateProvider(),
    new PostActionRegistry()
  );

  return {
    db,
    journalEngine,
    templateRegistry: registry,
    recordTransactionService: new RecordTransactionService(templateEngine, tenantContextProvider),
    listAccountsService: new ListAccountsService(accountRepo, tenantContextProvider),
    listTemplatesService: new ListTemplatesService(registry, tenantContextProvider),
    tenantContextProvider,
  };
}
