// test/contacts.e2e-spec.ts
// ===== اختبار E2E شامل لوحدة جهات الاتصال ودفتر الذمم الفرعية (AR/AP) =====

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Contacts & AR/AP Subledger (e2e)', () => {
  let app: INestApplication;
  const base = () => request.default(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  let customerId: string;
  let supplierId: string;

  it('POST /api/v1/contacts — إنشاء عميل جديد بنجاح', async () => {
    const res = await base()
      .post('/api/v1/contacts')
      .send({
        contact_type: 'customer',
        full_name: 'شركة النور للتجارة',
        phone: '777111222',
        address: 'صنعاء - شارع تعز',
        credit_limit: '150000',
        notes: 'عميل جملة موثوق',
      })
      .expect(201);

    expect(res.body.data).toBeDefined();
    expect(res.body.data.id).toBeTruthy();
    expect(res.body.data.full_name).toBe('شركة النور للتجارة');
    expect(res.body.data.contact_type).toBe('customer');
    expect(res.body.data.credit_limit).toBe('150000');
    expect(res.body.data.is_credit_hold).toBe(0);
    customerId = res.body.data.id;
  });

  it('POST /api/v1/contacts — إنشاء مورد جديد بنجاح', async () => {
    const res = await base()
      .post('/api/v1/contacts')
      .send({
        contact_type: 'supplier',
        full_name: 'مؤسسة البركة للأغذية',
        phone: '777333444',
        credit_limit: '500000',
      })
      .expect(201);

    expect(res.body.data).toBeDefined();
    expect(res.body.data.contact_type).toBe('supplier');
    supplierId = res.body.data.id;
  });

  it('POST /api/v1/contacts — رفض إنشاء جهة اتصال بدون اسم (400)', async () => {
    const res = await base()
      .post('/api/v1/contacts')
      .send({
        contact_type: 'customer',
        full_name: '',
      })
      .expect(400);

    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('GET /api/v1/contacts — استعلام القائمة مع الفلترة بالنوع والبحث', async () => {
    const resAll = await base().get('/api/v1/contacts').expect(200);
    expect(Array.isArray(resAll.body.data)).toBe(true);
    expect(resAll.body.data.length).toBeGreaterThanOrEqual(2);

    const resCustomers = await base().get('/api/v1/contacts?type=customer').expect(200);
    expect(resCustomers.body.data.every((c: any) => c.contact_type === 'customer')).toBe(true);

    const resSearch = await base().get('/api/v1/contacts?search=النور').expect(200);
    expect(resSearch.body.data.length).toBe(1);
    expect(resSearch.body.data[0].id).toBe(customerId);
  });

  it('GET /api/v1/contacts/:id — جلب تفاصيل جهة الاتصال وسقف الائتمان', async () => {
    const res = await base().get(`/api/v1/contacts/${customerId}`).expect(200);
    expect(res.body.data.id).toBe(customerId);
    expect(res.body.data.credit_status).toBeDefined();
    expect(res.body.data.credit_status.allowed).toBe(true);
    expect(res.body.data.credit_status.remaining).toBe('150000');
    expect(res.body.data.balance).toEqual({ ar: '0.0000', ap: '0.0000' });
  });

  it('PATCH /api/v1/contacts/:id/credit-hold — تجميد وتعديل سقف الائتمان', async () => {
    const res = await base()
      .patch(`/api/v1/contacts/${customerId}/credit-hold`)
      .send({ is_hold: true, credit_limit: '200000' })
      .expect(200);

    expect(res.body.data.is_credit_hold).toBe(1);
    expect(res.body.data.credit_limit).toBe('200000');

    // فحص التأثير في تفاصيل الطرف
    const check = await base().get(`/api/v1/contacts/${customerId}`).expect(200);
    expect(check.body.data.credit_status.allowed).toBe(false);

    // إعادة فتح الائتمان
    await base()
      .patch(`/api/v1/contacts/${customerId}/credit-hold`)
      .send({ is_hold: false })
      .expect(200);
  });

  it('حركة مالية متكاملة: بيع آجل للعميل ينعكس في الرصيد وكشف الحساب والبنود المفتوحة', async () => {
    // 1) تسجيل عملية بيع آجل مربوطة بالعميل عبر محرك القوالب
    const tx = await base()
      .post('/api/v1/transactions')
      .send({
        templateCode: 'sale_credit',
        payload: {
          customer_id: customerId,
          total_amount: '45000',
          currency_code: 'YER',
        },
      })
      .expect(201);

    expect(tx.body.transactionId).toBeTruthy();

    // 2) فحص رصيد العميل الفوري
    const balRes = await base().get(`/api/v1/contacts/${customerId}/balance`).expect(200);
    expect(balRes.body.data.ar).toBe('45000.0000');

    // 3) فحص كشف الحساب
    const stRes = await base().get(`/api/v1/contacts/${customerId}/statement`).expect(200);
    expect(stRes.body.data.contact.id).toBe(customerId);
    expect(stRes.body.data.lines.length).toBeGreaterThanOrEqual(1);
    expect(stRes.body.data.closing_balance).toBe('45000.0000');

    // 4) فحص البنود المفتوحة المعلقة (Open Items)
    const openRes = await base().get(`/api/v1/contacts/${customerId}/open-items`).expect(200);
    expect(openRes.body.data.length).toBeGreaterThanOrEqual(1);
    expect(openRes.body.data[0].contactId).toBe(customerId);
    expect(openRes.body.data[0].status).toBe('open');
  });
});
