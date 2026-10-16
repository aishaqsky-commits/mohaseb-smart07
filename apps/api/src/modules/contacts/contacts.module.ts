// src/modules/contacts/contacts.module.ts
// ===== وحدة جهات الاتصال: العملاء / الموردون / الموظفون =====

import { Module } from '@nestjs/common';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';

@Module({
  controllers: [ContactsController],
  providers: [ContactsService],
  exports: [ContactsService],
})
export class ContactsModule {}
