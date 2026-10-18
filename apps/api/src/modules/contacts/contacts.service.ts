// src/modules/contacts/contacts.service.ts
// ===== خدمة جهات الاتصال: التنسيق مع دفتر الذمم الفرعية (AR/AP Subledger) =====

import { Injectable, NotFoundException } from '@nestjs/common';
import type { CoreContainer, SubledgerType } from '@platform/core-accounting';
import { ContactsRepository } from './contacts.repository';
import type { ContactRow, CreateContactDto } from './contacts.dto';

@Injectable()
export class ContactsService {
  private getRepo(container: CoreContainer): ContactsRepository {
    return new ContactsRepository(container.db);
  }

  createContact(container: CoreContainer, tenantId: string, dto: CreateContactDto): ContactRow {
    const repo = this.getRepo(container);
    return repo.create(tenantId, dto);
  }

  listContacts(
    container: CoreContainer,
    tenantId: string,
    filter?: { contact_type?: string; search?: string }
  ): ContactRow[] {
    const repo = this.getRepo(container);
    const contacts = repo.list(tenantId, filter);

    return contacts.map((c) => {
      const bal = container.subledgerService.getBalance(tenantId, c.id);
      const balanceStr = c.contact_type === 'supplier' ? bal.ap : bal.ar;
      return {
        ...c,
        current_balance: balanceStr,
      };
    });
  }

  getContact(
    container: CoreContainer,
    tenantId: string,
    id: string
  ): ContactRow & { balance: { ar: string; ap: string }; credit_status: { allowed: boolean; remaining: string } } {
    const repo = this.getRepo(container);
    const contact = repo.findById(tenantId, id);
    if (!contact) {
      throw new NotFoundException({ error: 'CONTACT_NOT_FOUND', message: `جهة الاتصال "${id}" غير موجودة` });
    }

    const balance = container.subledgerService.getBalance(tenantId, id);
    const creditLimitNum = Number(contact.credit_limit || '0');
    const arBalanceNum = Number(balance.ar || '0');
    const remainingLimit = Math.max(0, creditLimitNum - arBalanceNum);

    return {
      ...contact,
      current_balance: contact.contact_type === 'supplier' ? balance.ap : balance.ar,
      balance,
      credit_status: {
        allowed: !contact.is_credit_hold && (creditLimitNum === 0 || arBalanceNum < creditLimitNum),
        remaining: String(remainingLimit),
      },
    };
  }

  getStatement(container: CoreContainer, tenantId: string, id: string) {
    // التأكد من وجود جهة الاتصال
    const contact = this.getContact(container, tenantId, id);
    const statement = container.subledgerService.buildStatement(tenantId, id);

    return {
      contact: {
        id: contact.id,
        name: contact.full_name,
        phone: contact.phone,
        contact_type: contact.contact_type,
      },
      lines: statement.lines,
      closing_balance: statement.closingBalance,
    };
  }

  getOpenItems(container: CoreContainer, tenantId: string, id: string, category?: SubledgerType) {
    this.getContact(container, tenantId, id);
    const cat = category ?? 'AR';
    return container.subledgerService.repo.findUnsettledItems(tenantId, id, cat);
  }

  updateCreditHold(
    container: CoreContainer,
    tenantId: string,
    id: string,
    isHold: boolean,
    creditLimit?: string
  ): ContactRow {
    const repo = this.getRepo(container);
    const updated = repo.setCreditHold(tenantId, id, isHold, creditLimit);
    if (!updated) {
      throw new NotFoundException({ error: 'CONTACT_NOT_FOUND', message: `جهة الاتصال "${id}" غير موجودة` });
    }
    const bal = container.subledgerService.getBalance(tenantId, id);
    return {
      ...updated,
      current_balance: updated.contact_type === 'supplier' ? bal.ap : bal.ar,
    };
  }
}
