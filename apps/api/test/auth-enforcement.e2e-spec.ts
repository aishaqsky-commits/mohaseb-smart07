// test/auth-enforcement.e2e-spec.ts
// ===== اختبار الحماية الصارمة بـ JWT تحت AUTH_ENFORCE=1 =====

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as request from 'supertest';
import { resetAuthSettingsForTests } from '../src/auth/auth-config';

// ضبط البيئة لفرض الحماية الصارمة
const DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mohaseb-auth-enforce-')), 'test.db');
process.env.DB_PATH = DB_PATH;
process.env.AUTH_ENFORCE = '1';
resetAuthSettingsForTests();

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { AppModule } = require('../src/app.module');

describe('Strict JWT Auth Enforcement (AUTH_ENFORCE=1)', () => {
  let app: INestApplication;
  const base = () => request.default(app.getHttpServer());
  let validToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();

    // تسجيل منشأة للحصول على توكن صالح
    const regRes = await base()
      .post('/api/v1/auth/register')
      .send({
        full_name: 'مالك الاختبار الأمني',
        phone: '770000001',
        password: 'Passw0rdStrict123',
        business_name: 'منشأة الأمان الصارم',
        business_type_code: 'retail',
        base_currency_code: 'YER',
        device: { device_key: 'strict-device-001', device_name: 'Security Test Phone', platform: 'android' },
      })
      .expect(201);

    validToken = regRes.body.data.tokens.access_token;
  });

  afterAll(async () => {
    delete process.env.AUTH_ENFORCE;
    resetAuthSettingsForTests();
    await app.close();
  });

  it('GET /health — مسار عام متاح بدون توكن', async () => {
    const res = await base().get('/health').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /api/v1/accounts — رفض الوصول بدون توكن (401 UNAUTHORIZED)', async () => {
    const res = await base().get('/api/v1/accounts').expect(401);
    expect(res.body.error).toBe('UNAUTHORIZED');
  });

  it('GET /api/v1/accounts — رفض توكن مزور أو فاسد (401 UNAUTHORIZED)', async () => {
    const res = await base()
      .get('/api/v1/accounts')
      .set('Authorization', 'Bearer invalid.token.payload')
      .expect(401);
    expect(res.body.error).toBe('UNAUTHORIZED');
  });

  it('GET /api/v1/accounts — قبول الطلب عند وجود توكن صالح', async () => {
    const res = await base()
      .get('/api/v1/accounts')
      .set('Authorization', `Bearer ${validToken}`)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('POST /api/v1/transactions — رفض العمليات بدون توكن (401 UNAUTHORIZED)', async () => {
    const res = await base()
      .post('/api/v1/transactions')
      .send({ templateCode: 'sale_cash', payload: { total_amount: '1000' } })
      .expect(401);
    expect(res.body.error).toBe('UNAUTHORIZED');
  });

  it('POST /api/v1/transactions — تنفيذ العملية بنجاح عند تقديم توكن موقّع', async () => {
    const res = await base()
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${validToken}`)
      .send({ templateCode: 'sale_cash', payload: { total_amount: '5000', currency_code: 'YER' } })
      .expect(201);
    expect(res.body.transactionId).toBeTruthy();
  });

  it('GET /api/v1/contacts — محمي بـ JWT (401 بدون توكن)', async () => {
    await base().get('/api/v1/contacts').expect(401);
    const res = await base()
      .get('/api/v1/contacts')
      .set('Authorization', `Bearer ${validToken}`)
      .expect(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('GET /api/v1/items — محمي بـ JWT (401 بدون توكن)', async () => {
    await base().get('/api/v1/items').expect(401);
    const res = await base()
      .get('/api/v1/items')
      .set('Authorization', `Bearer ${validToken}`)
      .expect(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
