import { createCoreContainer } from "../src/infrastructure/bootstrap/createCoreContainer";
import { TemplateDefinition } from "../src/templates/types/TemplateDefinition";
import saleCredit from "../templates-fixtures/sale_credit.json";
import customerCollection from "../templates-fixtures/customer_collection.json";

const T = "t-dbg6";
it("dbg overpayment", async () => {
  const c = createCoreContainer({ tenantId: T, baseCurrencyCode: "YER", scope: "core" as any, templates: [saleCredit as unknown as TemplateDefinition, customerCollection as unknown as TemplateDefinition] });
  const ins = c.db.prepare("INSERT INTO accounts (id, tenant_id, code, name_ar_simple, account_type, normal_balance, is_header, is_postable) VALUES (?,?,?,?,?,?,?,?)");
  ins.run("a1", T, "1101", "صندوق", "asset", "debit", 0, 1);
  ins.run("a2", T, "1210", "عملاء", "asset", "debit", 0, 1);
  ins.run("a3", T, "4150", "ايراد", "revenue", "credit", 0, 1);
  await c.recordTransactionService.execute({ templateCode: "sale_credit", payload: { total_amount: "1000", transaction_date: "2026-03-01", customer_id: "cust-1", currency_code: "YER" } });
  await c.recordTransactionService.execute({ templateCode: "customer_collection", payload: { amount: "1300", transaction_date: "2026-03-05", customer_id: "cust-1", currency_code: "YER", received_to_account: "1101" } });
  console.log("ALL ITEMS:", JSON.stringify(c.subledgerService.repo.findAllItemsForContact(T, "cust-1").map((i) => ({ d: i.invoiceDate, o: i.originalAmount, r: i.remainingAmount, st: i.status }))));
  console.log("UNSETTLED:", JSON.stringify(c.subledgerService.findUnsettledItems(T, "cust-1", "AR").map((i) => ({ d: i.invoiceDate, r: i.remainingAmount }))));
});
