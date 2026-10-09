import { createCoreContainer } from "../src/infrastructure/bootstrap/createCoreContainer";
import { TemplateDefinition } from "../src/templates/types/TemplateDefinition";
import saleCredit from "../templates-fixtures/sale_credit.json";
import customerCollection from "../templates-fixtures/customer_collection.json";

const T = "t-dbg7";
it("dbg fifo exact test", async () => {
  const c = createCoreContainer({ tenantId: T, baseCurrencyCode: "YER", scope: "core" as any, templates: [saleCredit as unknown as TemplateDefinition, customerCollection as unknown as TemplateDefinition] });
  const ins = c.db.prepare("INSERT INTO accounts (id, tenant_id, code, name_ar_simple, account_type, normal_balance, is_header, is_postable) VALUES (?,?,?,?,?,?,?,?)");
  ins.run("a1", T, "1101", "الصندوق الرئيسي", "asset", "debit", 0, 1);
  ins.run("a2", T, "1210", "العملاء", "asset", "debit", 0, 1);
  ins.run("a3", T, "4150", "إيرادات المبيعات", "revenue", "credit", 0, 1);
  ins.run("a4", T, "4900", "أرباح فروق العملة", "revenue", "credit", 0, 1);
  ins.run("a5", T, "5900", "خسائر فروق العملة", "expense", "debit", 0, 1);
  for (const [amt, d] of [["100", "2026-01-01"], ["200", "2026-01-02"], ["300", "2026-01-03"]] as Array<[string, string]>) {
    await c.recordTransactionService.execute({ templateCode: "sale_credit", payload: { total_amount: amt, transaction_date: d, customer_id: "cust-1", currency_code: "YER" } });
  }
  console.log("BEFORE:", JSON.stringify(c.subledgerService.repo.findAllItemsForContact(T, "cust-1").map((i) => ({ d: i.invoiceDate, o: i.originalAmount, r: i.remainingAmount, st: i.status }))));
  await c.recordTransactionService.execute({ templateCode: "customer_collection", payload: { amount: "250", transaction_date: "2026-01-15", customer_id: "cust-1", currency_code: "YER", received_to_account: "1101" } });
  console.log("AFTER:", JSON.stringify(c.subledgerService.repo.findAllItemsForContact(T, "cust-1").map((i) => ({ d: i.invoiceDate, o: i.originalAmount, r: i.remainingAmount, st: i.status }))));
});
