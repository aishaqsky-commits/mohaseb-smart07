import { createCoreContainer } from "../src/infrastructure/bootstrap/createCoreContainer";

const TENANT_ID = "tenant-dbg8";

it("dbg8: trigger presence + rows", () => {
  const c = createCoreContainer({ tenantId: TENANT_ID, baseCurrencyCode: "YER", scope: "core", templates: [] });
  try {
    const trg = c.db.prepare("SELECT name, sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_open_items%'").all() as any[];
    console.log("TRIGGERS:", trg.map(t => t.name));
    const items = c.db.prepare("SELECT id, original_amount, remaining_amount FROM ar_ap_open_items").all();
    console.log("ITEMS:", JSON.stringify(items));
    let err: unknown = null;
    try {
      c.db.prepare(`UPDATE ar_ap_open_items SET remaining_amount = '999999'`).run();
    } catch (e) { err = e; }
    console.log("UPDATE ERROR:", err ? String(err) : "NONE");
  } finally { c.db.close(); }
});
