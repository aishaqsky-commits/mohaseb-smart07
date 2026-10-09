import Database from "better-sqlite3";
import { createCoreContainer } from "../src/infrastructure/bootstrap/createCoreContainer";
import { TemplateDefinition } from "../src/templates/types/TemplateDefinition";
import saleCredit from "../templates-fixtures/sale_credit.json";

const TENANT_ID = "t-dbg";
it("dbg usd sale", async () => {
  const rates = { current: "500", async getRate() { return this.current; } };
  const c = createCoreContainer({
    tenantId: TENANT_ID, baseCurrencyCode: "YER", scope: "core" as any,
    templates: [saleCredit as unknown as TemplateDefinition],
    exchangeRateProvider: rates,
  });
  const insert = c.db.prepare(`INSERT INTO accounts (id, tenant_id, code, name_ar_simple, account_type, normal_balance, is_header, is_postable) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  insert.run("a1", TENANT_ID, "1101", "الصندوق", "asset", "debit", 0, 1);
  insert.run("a2", TENANT_ID, "1210", "العملاء", "asset", "debit", 0, 1);
  insert.run("a3", TENANT_ID, "4150", "إيراد", "revenue", "credit", 0, 1);
  await c.recordTransactionService.execute({ templateCode: "sale_credit", payload: { total_amount: "1000", transaction_date: "2026-01-10", customer_id: "cust-1", currency_code: "USD" } });
  const rows = c.db.prepare(`SELECT jl.amount, jl.base_amount, jl.currency_code, jl.exchange_rate_used FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_entry_id WHERE je.tenant_id=?`).all(TENANT_ID);
  console.log("JOURNAL LINES:", JSON.stringify(rows));
  const items = c.subledgerService.repo.findUnsettledItems(TENANT_ID, "cust-1", "AR");
  console.log("OPEN ITEMS:", JSON.stringify(items.map(i=>({orig:i.originalAmount, rem:i.remainingAmount, cur:i.currencyCode, rate:i.exchangeRate, baseRem:i.baseRemainingAmount}))));
  c.db.close();
});
