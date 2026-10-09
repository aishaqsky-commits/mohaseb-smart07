// repro.spec.ts — تشخيص خطأ 500 في POST transactions (يُحذف بعد التشخيص)
import { createCoreContainer } from '@platform/core-accounting';
import { loadBundledTemplates } from '../src/common/load-templates';
import { seedAccountsIntoSqlite } from '../src/common/load-accounts-seed';

it('diagnose sale_cash', async () => {
  const container = createCoreContainer({
    tenantId: 'tenant_demo',
    baseCurrencyCode: 'YER',
    dbPath: ':memory:',
    scope: 'retail',
    templates: loadBundledTemplates(),
  });
  seedAccountsIntoSqlite(container.db, 'tenant_demo', 'retail');
  try {
    const r = await container.recordTransactionService.execute({
      templateCode: 'sale_cash',
      payload: { total_amount: '15000', currency_code: 'YER' },
    });
    console.log('OK', r.transactionId);
  } catch (e: any) {
    console.log('ERR name=', e?.name, 'msg=', e?.message);
    console.log(e?.stack?.split('\n').slice(0, 8).join('\n'));
    throw e;
  }
});
