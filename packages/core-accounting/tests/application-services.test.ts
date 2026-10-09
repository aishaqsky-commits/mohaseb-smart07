// tests/application-services.test.ts

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

import { createCoreContainer, CoreContainer } from "../src/infrastructure/bootstrap/createCoreContainer";
import { MissingTenantContextError } from "../src/application/errors/ApplicationErrors";
import { ListAccountsService } from "../src/application/services/ListAccountsService";
import { ListTemplatesService } from "../src/application/services/ListTemplatesService";
import { RecordTransactionService } from "../src/application/services/RecordTransactionService";
import { SqliteAccountRepository } from "../src/infrastructure/sqlite/SqliteAccountRepository";
import { TenantContextProvider } from "../src/application/ports/TenantContextProvider";
import { TemplateRegistry } from "../src/templates/registry/TemplateRegistry";
import { JournalEngine } from "../src/application/JournalEngine";
import { SqliteJournalRepository } from "../src/infrastructure/sqlite/SqliteJournalRepository";
import { TemplateExecutionEngine } from "../src/templates/TemplateExecutionEngine";
import { PostActionRegistry } from "../src/templates/ports/PostActionPort";
import saleCashTemplate from "../src/templates/fixtures/sale_cash.json";
import { TemplateDefinition } from "../src/templates/types/TemplateDefinition";

const TENANT_ID = "tenant-app-001";

function seedAccounts(db: Database.Database): void {
  const insert = db.prepare(`
    INSERT INTO accounts (id, tenant_id, code, name_ar_simple, account_type, normal_balance, is_header, is_postable)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run("a1", TENANT_ID, "1000", "الأصول", "asset", "debit", 1, 0);
  insert.run("a2", TENANT_ID, "1101", "الصندوق الرئيسي", "asset", "debit", 0, 1);
  insert.run("a3", TENANT_ID, "1210", "العملاء", "asset", "debit", 0, 1);
  insert.run("a4", TENANT_ID, "4150", "إيرادات المبيعات", "revenue", "credit", 0, 1);
}

describe("طبقة التطبيق - حالات الاستخدام عبر createCoreContainer", () => {
  let container: CoreContainer;

  beforeEach(() => {
    container = createCoreContainer({
      tenantId: TENANT_ID,
      baseCurrencyCode: "YER",
      templates: [saleCashTemplate as unknown as TemplateDefinition],
    });
    seedAccounts(container.db);
  });

  afterEach(() => container.db.close());

  it("ListAccountsService يعيد الحسابات مع صحيح/خطأ لصلاحية الترحيل", async () => {
    const list = await container.listAccountsService.execute();
    expect(list).toHaveLength(4);
    const header = list.find((a) => a.code === "1000");
    const cash = list.find((a) => a.code === "1101");
    expect(header?.isPostable).toBe(false); // حساب تجميعي — غير قابل للترحيل
    expect(cash?.isPostable).toBe(true);
  });

  it("ListTemplatesService يعيد القوالب حسب النطاق", async () => {
    const list = await container.listTemplatesService.execute();
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]?.templateCode).toBe("sale_cash");
  });

  it("RecordTransactionService ينفذ قالب بيع نقدًا ويوازن القيد", async () => {
    const result = await container.recordTransactionService.execute({
      templateCode: "sale_cash",
      payload: { transaction_date: "2026-10-01", total_amount: "25000", inventory_mode: false },
    });
    expect(result.transactionId).toBeTruthy();
    // التوازن مضمون بحكم الكيان (لا يمكن إنشاء قيد غير متوازن) — نتحقق من إجمالي المدين فقط
    const debit = result.primaryEntry.totalDebitBase().toNumber();
    expect(debit).toBe(25000);
  });

  it("بدون سياق مستأجر -> MissingTenantContextError", async () => {
    const emptyProvider: TenantContextProvider = {
      getCurrentContext: async () => ({ tenantId: "", baseCurrencyCode: "YER" }),
    };
    const svc = new ListAccountsService(
      new SqliteAccountRepository(container.db),
      emptyProvider
    );
    await expect(svc.execute()).rejects.toBeInstanceOf(MissingTenantContextError);
  });

  it("قالب غير مسجل -> خطأ واضح", async () => {
    await expect(
      container.recordTransactionService.execute({
        templateCode: "no_such_template",
        payload: {},
      })
    ).rejects.toThrow(/غير مسجَّل|لم يتم العثور/);
  });
});
