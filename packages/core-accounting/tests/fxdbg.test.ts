import { createCoreContainer } from "../src/infrastructure/bootstrap/createCoreContainer";
import { TemplateDefinition } from "../src/templates/types/TemplateDefinition";
import saleCredit from "../templates-fixtures/sale_credit.json";
const T = "t-fxdbg";
class Dyn { rates: Record<string,string> = {}; current = "500"; async getRate(){ return this.current; } }
it("fx debug", async () => {
  const rates = new Dyn();
  const c = createCoreContainer({ tenantId: T, baseCurrencyCode: "YER", scope: "core" as any, templates: [saleCredit as unknown as TemplateDefinition], exchangeRateProvider: rates });
  const ins = c.db.prepare("INSERT INTO accounts (id, tenant_id, code, name_ar_simple, account_type, normal_balance, is_header, is_postable) VALUES (?,?,?,?,?,?,?,?)");
  ins.run("a1", T, "1101", "الصندوق", "asset", "debit", 0, 1);
  ins.run("a2", T, "1210", "العملاء", "asset", "debit", 0, 1);
  ins.run("a3", T, "4150", "إيراد", "revenue", "credit", 0, 1);
  await c.recordTransactionService.execute({ templateCode: "sale_credit", payload: { total_amount: "1000", transaction_date: "2026-01-10", customer_id: "cust-1", currency_code: "USD" } });
  console.log("LINES:", JSON.stringify(c.db.prepare(`SELECT ac.code, jl.side, jl.amount, jl.base_amount, jl.currency_code, jl.exchange_rate_used FROM journal_lines jl JOIN accounts ac ON ac.id=jl.account_id JOIN journal_entries je ON je.id=jl.journal_entry_id WHERE je.tenant_id=?`).all(T)));
  console.log("ITEM:", JSON.stringify(c.subledgerService.repo.findAllItemsForContact(T, "cust-1")));
  c.db.close();
});
