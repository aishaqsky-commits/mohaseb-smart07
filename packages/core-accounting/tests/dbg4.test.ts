import { createCoreContainer } from "../src/infrastructure/bootstrap/createCoreContainer";
import { TemplateDefinition } from "../src/templates/types/TemplateDefinition";
import saleCredit from "../templates-fixtures/sale_credit.json";

const T = "t-dbg4";
it("dbg fifo direct repo", async () => {
  const c = createCoreContainer({ tenantId: T, baseCurrencyCode: "YER", scope: "core" as any, templates: [saleCredit as unknown as TemplateDefinition] });
  const repo = c.subledgerService.repo;
  // seed items directly
  for (const [amt, d] of [["100", "2026-01-01"], ["200", "2026-01-02"], ["300", "2026-01-03"]] as Array<[string, string]>) {
    repo.createOpenItem({ tenantId: T, contactId: "cust-1", subledgerType: "AR", sourceTransactionId: "tx-" + d, journalEntryId: "je-" + d, invoiceDate: d, originalAmount: amt + ".0000", currencyCode: "YER", exchangeRate: "1", baseOriginalAmount: amt + ".0000" });
  }
  const out = repo.settlePayment({ tenantId: T, contactId: "cust-1", subledgerType: "AR", settlementTransactionId: "s1", settlementEntryId: "je-s1", settlementDate: "2026-01-15", amountInItemCurrency: new (require("decimal.js"))("250"), amountInBase: new (require("decimal.js"))("250"), itemCurrencyCode: "YER", currentRate: "1" });
  console.log("OUT:", JSON.stringify(out.allocations.map(a => ({ item: a.openItemId.slice(0,8), alloc: a.allocatedAmount.toString(), base: a.allocatedBase.toString() }))));
  console.log("AFTER:", JSON.stringify(repo.findAllItemsForContact(T, "cust-1").map((i) => ({ d: i.invoiceDate, r: i.remainingAmount, st: i.status }))));
});
