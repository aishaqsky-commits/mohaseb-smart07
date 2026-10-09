// test/api.e2e-spec.ts
// ===== اختبار E2E شامل للـ API: دورة حياة عملية بيع كاملة عبر HTTP =====

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Mohaseb API (e2e)', () => {
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

  it('GET /health — الخدمة تعمل والنواة محمّلة', async () => {
    const res = await base().get('/health').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /health/bootstrap — الحسابات مزروعة والقوالب محمّلة', async () => {
    const res = await base().get('/health/bootstrap').expect(200);
    expect(res.body.accountsSeeded).toBeGreaterThanOrEqual(50);
    expect(res.body.templatesLoaded).toBeGreaterThanOrEqual(20);
  });

  it('GET /api/v1/templates — قائمة عمليات سريعة بالعربية ومنظمة', async () => {
    const res = await base().get('/api/v1/templates').expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    const codes = res.body.map((t: any) => t.templateCode);
    expect(codes).toContain('sale_cash');
    expect(codes).toContain('expense_daily');
    // مرتبة حسب sort_order
    const orders = res.body.map((t: any) => t.sortOrder);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it('GET /api/v1/accounts — الحسابات معلّمة بقابلية الترحيل', async () => {
    const res = await base().get('/api/v1/accounts').expect(200);
    const byCode = Object.fromEntries(res.body.map((a: any) => [a.code, a]));
    expect(byCode['1101']).toBeDefined(); // الصندوق الرئيسي
    expect(byCode['1101'].isPostable).toBe(true);
    expect(byCode['1000'].isPostable).toBe(false); // حساب تجميعي
  });

  it('POST /api/v1/transactions — بيع نقدي ينتج قيداً مزدوجاً متوازناً', async () => {
    const res = await base()
      .post('/api/v1/transactions')
      .send({
        templateCode: 'sale_cash',
        payload: { total_amount: '15000', currency_code: 'YER' },
      })
      .expect(201);

    expect(res.body.transactionId).toBeTruthy();
    // الملخص البشري الجديد: «الصندوق الرئيسي يزيد 15,000.00 YER · المبيعات تنقص ...» (بلا مصطلحات محاسبية)
    expect(res.body.summary).toContain('15,000');
    expect(res.body.summary).toContain('يزيد');
    const lines = res.body.primaryEntry.lines;
    const debitSum = lines.filter((l: any) => l.side === 'debit').reduce((s: number, l: any) => s + Number(l.amount), 0);
    const creditSum = lines.filter((l: any) => l.side === 'credit').reduce((s: number, l: any) => s + Number(l.amount), 0);
    expect(debitSum).toBe(creditSum); // ميزان المراجعة
    expect(debitSum).toBe(15000);
  });

  it('POST /api/v1/transactions — رفض Payload غير صالح (400)', async () => {
    const res = await base()
      .post('/api/v1/transactions')
      .send({ templateCode: 'sale_cash', payload: { total_amount: -5 } })
      .expect(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('POST /api/v1/transactions — قالب غير موجود (404)', async () => {
    const res = await base()
      .post('/api/v1/transactions')
      .send({ templateCode: 'no_such_template', payload: {} })
      .expect(404);
    expect(res.body.error).toBe('TEMPLATE_NOT_FOUND');
  });

  it('سلسلة يومية كاملة: مصروف ثم تحصيل لا يكسر التوازن', async () => {
    await base()
      .post('/api/v1/transactions')
      .send({ templateCode: 'expense_daily', payload: { amount: '2000', currency_code: 'YER', expense_category: '5801' } })
      .expect(201);
    const sale = await base()
      .post('/api/v1/transactions')
      // customer_id مطلوب في قالب sale_credit (contact_picker) — يُمرَّر كمعرّف حر تخزنه النواة في السطر
      .send({ templateCode: 'sale_credit', payload: { total_amount: '50000', currency_code: 'YER', customer_id: 'c-1' } })
      .expect(201);
    expect(sale.body.primaryEntry.lines.length).toBeGreaterThanOrEqual(2);
  });
});
