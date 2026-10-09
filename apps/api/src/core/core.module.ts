// src/core/core.module.ts
// ===== جسر نواة المحاسبة داخل NestJS (Composition Root للـ API) =====
// يبني CoreContainer واحداً لكل عملية (منشأة واحدة لكل نسخة API)،
// ويوفر حالات الاستخدام عبر DI بدون معرفة أي طبقة بالأخرى.

import { DynamicModule, Global, Module } from '@nestjs/common';
import {
  createCoreContainer,
  CoreContainer,
  ListAccountsService,
  ListTemplatesService,
  RecordTransactionService,
} from '@platform/core-accounting';
import { loadBundledTemplates } from '../common/load-templates';
import { seedAccountsIntoSqlite } from '../common/load-accounts-seed';

export const CORE_CONTAINER = Symbol('CORE_CONTAINER');
export const SERVICES = {
  RECORD_TX: 'RECORD_TX_SERVICE',
  LIST_ACCOUNTS: 'LIST_ACCOUNTS_SERVICE',
  LIST_TEMPLATES: 'LIST_TEMPLATES_SERVICE',
} as const;

export interface CoreModuleOptions {
  tenantId?: string;
  baseCurrencyCode?: string;
  dbPath?: string;
  scope?: string;
}

@Global()
@Module({})
export class CoreModule {
  static forRoot(options: CoreModuleOptions = {}): DynamicModule {
    const containerProvider = {
      provide: CORE_CONTAINER,
      useFactory: (): CoreContainer => {
        const tenantId = options.tenantId ?? process.env.TENANT_ID ?? 'tenant_demo';
        const scope = options.scope ?? process.env.BUSINESS_SCOPE ?? 'retail';
        const container = createCoreContainer({
          tenantId,
          baseCurrencyCode: options.baseCurrencyCode ?? process.env.BASE_CURRENCY ?? 'YER',
          dbPath: options.dbPath ?? process.env.DB_PATH ?? ':memory:',
          scope,
          templates: loadBundledTemplates(),
        });
        // زرع شجرة الحسابات (idempotent) — بدونها لا يمكن ترحيل أي قيد
        seedAccountsIntoSqlite(container.db, tenantId, scope);
        return container;
      },
    };

    const serviceProviders = [
      {
        provide: SERVICES.RECORD_TX,
        useFactory: (c: CoreContainer): RecordTransactionService => c.recordTransactionService,
        inject: [CORE_CONTAINER],
      },
      {
        provide: SERVICES.LIST_ACCOUNTS,
        useFactory: (c: CoreContainer): ListAccountsService => c.listAccountsService,
        inject: [CORE_CONTAINER],
      },
      {
        provide: SERVICES.LIST_TEMPLATES,
        useFactory: (c: CoreContainer): ListTemplatesService => c.listTemplatesService,
        inject: [CORE_CONTAINER],
      },
    ];

    return {
      module: CoreModule,
      providers: [containerProvider, ...serviceProviders],
      exports: [CORE_CONTAINER, ...serviceProviders.map((p) => p.provide)],
    };
  }
}
