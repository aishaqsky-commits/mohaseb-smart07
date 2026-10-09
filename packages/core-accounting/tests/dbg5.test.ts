import { createCoreContainer } from "../src/infrastructure/bootstrap/createCoreContainer";
import { TemplateDefinition } from "../src/templates/types/TemplateDefinition";
import saleCredit from "../templates-fixtures/sale_credit.json";
import customerCollection from "../templates-fixtures/customer_collection.json";

const T = "t-dbg5";
it("dbg fifo via service", async () => {
  const c = createCoreContainer({ tenantId: T, baseCurrencyCode: "YER", scope: "core" as any, templates: [saleCredit as unknown as TemplateDefinition, customerCollection as unknown as TemplateDefinition] });
  const ins = c.db.prepare("INSERT INTO accounts (id, tenant_id, code, name_ar_simple, account_type, normal_balance, is_header, is_postable) VALUES (?,?,?,?,?,?,?,?)");
  ins.run("a1", T, "1101", "صندوق", "asset", "debit", 0, 1);
  ins.run("a2", T, "1210", "عملاء", "asset", "debit", 0, 1);
  ins.run("a3", T, "4150", "ايراد", "revenue", "credit", 0, 1);
  for (const [amt, d] of [["100", "2026-01-01"], ["200", "2026-01-02"], ["300", "2026-01-03"]] as Array<[string, string]>) {
    await c.recordTransactionService.execute({ templateCode: "sale_credit", payload: { total_amount: amt, transaction_date: d, customer_id: "cust-1", currency_code: "YER" } });
  }
  // now call settleFromEntry directly? No - run collection and log inside. Patch: log entry lines by querying journal_lines
  await c.recordTransactionService.execute({ templateCode: "customer_collection", payload: { amount: "250", transaction_date: "2026-01-15", customer_id: "cust-1", currency_code: "YER", received_to_account: "1101" } });
  const rows = c.db.prepare("SELECT jl.amount, jl.base_amount, jl.currency_code, jl.exchange_rate_used, ac.code FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_entry_id JOIN accounts ac ON ac.id=jl.account_id WHERE je.tenant_id=? AND je.source_type='settlement'").all(T);
  console.log("SETTLE LINES:", JSON.stringify(rows));
  console.log("AFTER:", JSON.stringify(c.subledgerService.repo.findAllItemsForContact(T, "cust-1").map((i) => ({ d: i.invoiceDate, o: i.originalAmount, r: i.remainingAmount, br: i.baseRemainingAmount, st: i.status }))));
});
