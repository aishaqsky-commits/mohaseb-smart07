// test/items.e2e-spec.ts
// ===== اختبار E2E شامل لوحدة الأصناف والمخزون وحركات الدفعات (FEFO) =====

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Items & Inventory Module (e2e)', () => {
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

  let stockItemId: string;
  let serviceItemId: string;
  let warehouseId: string;

  it('POST /api/v1/items — إنشاء صنف مخزني وصنف خدمي بنجاح', async () => {
    const resStock = await base()
      .post('/api/v1/items')
      .send({
        name_ar: 'حليب ممتاز 1 لتر',
        sku: 'MILK-001',
        item_type: 'stock',
        has_expiry_date: true,
      })
      .expect(201);

    expect(resStock.body.data).toBeDefined();
    expect(resStock.body.data.id).toBeTruthy();
    expect(resStock.body.data.name_ar).toBe('حليب ممتاز 1 لتر');
    expect(resStock.body.data.item_type).toBe('stock');
    expect(resStock.body.data.has_expiry_date).toBe(1);
    stockItemId = resStock.body.data.id;

    const resService = await base()
      .post('/api/v1/items')
      .send({
        name_ar: 'أجرة نقل وتوصيل',
        item_type: 'service',
      })
      .expect(201);

    expect(resService.body.data.item_type).toBe('service');
    serviceItemId = resService.body.data.id;
  });

  it('POST /api/v1/items — التحقق من صحة المدخلات ورفض الاسم الفارغ (400)', async () => {
    const res = await base()
      .post('/api/v1/items')
      .send({
        name_ar: '',
      })
      .expect(400);

    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('GET /api/v1/items — استعلام الأصناف والفلترة بالنوع والبحث', async () => {
    const resAll = await base().get('/api/v1/items').expect(200);
    expect(resAll.body.data.length).toBeGreaterThanOrEqual(2);

    const resStock = await base().get('/api/v1/items?type=stock').expect(200);
    expect(resStock.body.data.every((i: any) => i.item_type === 'stock')).toBe(true);

    const resSearch = await base().get('/api/v1/items?search=حليب').expect(200);
    expect(resSearch.body.data.length).toBe(1);
    expect(resSearch.body.data[0].id).toBe(stockItemId);
  });

  it('GET /api/v1/items/:id — جلب تفاصيل صنف والمستودع الافتراضي', async () => {
    const res = await base().get(`/api/v1/items/${stockItemId}`).expect(200);
    expect(res.body.data.id).toBe(stockItemId);
    expect(res.body.data.total_quantity_on_hand).toBe('0.0000');
  });

  it('POST /api/v1/items/:id/receive — استلام مخزني بدفعتين وفحص ترتيب FEFO', async () => {
    // جلب المستودع الافتراضي من قاعدة البيانات عبر الصنف
    // إنشاء مستودع تجريبي أو استخدام MAIN
    const itemDetails = await base().get(`/api/v1/items/${stockItemId}`).expect(200);
    warehouseId = 'wh-main-tenant_demo';

    // 1) استلام دفعة أولى تنتهي بتاريخ لاحق (2026-12-01)
    const rec1 = await base()
      .post(`/api/v1/items/${stockItemId}/receive`)
      .send({
        warehouse_id: warehouseId,
        quantity: '50',
        unit_cost: '1200',
        batch_number: 'BATCH-DEC',
        expiry_date: '2026-12-01',
        movement_type: 'purchase_in',
      })
      .expect(201);

    expect(rec1.body.data.movementId).toBeTruthy();

    // 2) استلام دفعة ثانية تنتهي بتاريخ أقرب (2026-11-15) — يجب أن تسبق في FEFO
    const rec2 = await base()
      .post(`/api/v1/items/${stockItemId}/receive`)
      .send({
        warehouse_id: warehouseId,
        quantity: '30',
        unit_cost: '1250',
        batch_number: 'BATCH-NOV',
        expiry_date: '2026-11-15',
        movement_type: 'purchase_in',
      })
      .expect(201);

    expect(rec2.body.data.movementId).toBeTruthy();

    // 3) فحص الرصيد الكلي المجمّع بعد الاستلام (50 + 30 = 80)
    const afterRec = await base().get(`/api/v1/items/${stockItemId}`).expect(200);
    expect(Number(afterRec.body.data.total_quantity_on_hand)).toBe(80);

    // 4) فحص ترتيب الدفعات وفق قاعدة FEFO (الأقرب انتهاءً أولاً)
    const batchesRes = await base().get(`/api/v1/items/${stockItemId}/batches`).expect(200);
    expect(batchesRes.body.data.length).toBe(2);
    expect(batchesRes.body.data[0].batch_number).toBe('BATCH-NOV');
    expect(batchesRes.body.data[1].batch_number).toBe('BATCH-DEC');

    // 5) فحص كشف حركة الصنف (Stock Card)
    const cardRes = await base().get(`/api/v1/items/${stockItemId}/stock-card`).expect(200);
    expect(cardRes.body.data.length).toBe(2);
    expect(cardRes.body.data[0].movement_type).toBe('purchase_in');
  });
});
