import { createCoreContainer } from '@platform/core-accounting';
import { loadBundledTemplates } from '../src/common/load-templates';
import { seedAccountsIntoSqlite } from '../src/common/load-accounts-seed';

it('debug expense_daily direct', async () => {
  const container = createCoreContainer({
    tenantId: 'tenant_demo', baseCurrencyCode: 'YER', dbPath: ':memory:', scope: 'retail',
    templates: loadBundledTemplates(),
  });
  seedAccountsIntoSqlite(container.db, 'tenant_demo', 'retail');
  try {
    const r = await container.recordTransactionService.execute({
      templateCode: 'expense_daily',
      payload: { amount: '2000', currency_code: 'YER', expense_category: '5801' },
    });
    console.log('OK', r.transactionId);
  } catch (e: any) {
    console.log('ERR name=', e?.name, 'msg=', e?.message);
    console.log(e?.stack?.split('\n').slice(0, 12).join('\n'));
    throw e;
  }
});
