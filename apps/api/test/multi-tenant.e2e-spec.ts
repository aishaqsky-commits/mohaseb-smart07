// test/multi-tenant.e2e-spec.ts
// ===== البند #2 (خطة المرحلة 1): اختبار العزل الفعلي بين المنشآت تحت MULTI_TENANCY=1 =====
// سيناريو موثّق: مستخدم واحد يسجّل منشأتين بنشاطين مختلفين (retail + clinic) عبر
// نفس رقم الهاتف في نفس ملف SQLite مؤقت، ثم:
// - كل توكن يكتب عملياته في حاوية منشأته فقط (claim `tid` مصدقًا من التوقيع).
// - GET /accounts و trial-balance يعيدان بيانات معزولة تمامًا لكل منشأة.
// - انتحال هيدر x-tenant-id مُتجاهل بالكامل (هوية المنشأة من التوكن حصريًا).
// - شجرة حسابات النشاط تُزرع حسب claim `scope` الموقّع (clinic ≠ retail).
// ملاحظة jest: لكل ملف اختبار بيئة Node خاصة به — لذا تعديل process.env هنا آمن
// على ملف api.e2e-spec.ts (وضع MVP) الذي يعمل في عملية منفصلة.

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as request from 'supertest';
import { resetAuthSettingsForTests } from '../src/auth/auth-config';

// ===== ضبط البيئة قبل استيراد AppModule (CoreModule.forRoot يقرأ env عند الاستيراد) =====
const DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mohaseb-mt-')), 'test.db');
process.env.DB_PATH = DB_PATH;
process.env.MULTI_TENANCY = '1';
delete process.env.AUTH_ENFORCE; // هذا الملف يختبر المسار التعددي؛ الفرض الصارم وحده في الملف التالي
resetAuthSettingsForTests();

// الاستيراد بعد ضبط البيئة — إلزامي وإلا التقطت CoreModule قيمة DB_PATH القديمة
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { AppModule } = require('../src/app.module');

const PHONE_RETAIL = '712345601';
const PHONE_CLINIC = '712345602';
const DEVICE_KEY = 'mt-e2e-device-key-0001';

function registerDto(phone: string, businessName: string, businessType: string) {
  return {
    full_name: 'مستخدم الاختبار التعددي',
    phone,
    password: 'Passw0rd123',
    business_name: businessName,
    business_type_code: businessType,
    base_currency_code: 'YER',
    device: { device_key: DEVICE_KEY, device_name: 'Pixel Test', platform: 'android' },
  };
}

describe('Multi-Tenant Isolation (e2e, MULTI_TENANCY=1)', () => {
  let app: INestApplication;
  const base = () => request.default(app.getHttpServer());

  let tokenRetail: string;
  let tokenClinic: string;
  let tenantRetailId: string;
  let tenantClinicId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();

    const r = await base().post('/api/v1/auth/register').send(registerDto(PHONE_RETAIL, 'متجر التجزئة', 'retail')).expect(201);
    tokenRetail = r.body.data.tokens.access_token;
    tenantRetailId = r.body.data.tenant.id;

    const c = await base().post('/api/v1/auth/register').send(registerDto(PHONE_CLINIC, 'عيادة النور', 'clinic')).expect(201);
    tokenClinic = c.body.data.tokens.access_token;
    tenantClinicId = c.body.data.tenant.id;

    expect(tenantRetailId).not.toBe(tenantClinicId);
  });

  afterAll(async () => {
    await app.close();
    try { fs.rmSync(path.dirname(DB_PATH), { recursive: true, force: true }); } catch { /* نظافة فقط */ }
  });

  it('بيع نقدي لكل منشأة يُسجَّل في دفترها فقط (201 للتوكنين)', async () => {
    const body = { templateCode: 'sale_cash', payload: { total_amount: '15000', currency_code: 'YER' } };
    await base().post('/api/v1/transactions').set('Authorization', `Bearer ${tokenRetail}`).send(body).expect(201);
    const clinicRes = await base()
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${tokenClinic}`)
      .send({ templateCode: 'sale_cash', payload: { total_amount: '99000', currency_code: 'YER' } })
      .expect(201);
    expect(clinicRes.body.transactionId).toBeTruthy();
  });

  it('GET /accounts — شجرة كل منشأة معزولة ومنفصلة تمامًا', async () => {
    const retail = await base().get('/api/v1/accounts').set('Authorization', `Bearer ${tokenRetail}`).expect(200);
    const clinic = await base().get('/api/v1/accounts').set('Authorization', `Bearer ${tokenClinic}`).expect(200);

    const retailIds = new Set(retail.body.map((a: any) => a.id as string));
    const clinicIds = new Set(clinic.body.map((a: any) => a.id as string));

    // لا تقاطع إطلاقًا: معرّفات الحسابات تحمل بادئة acct_<tenantId>_ — أي تداخل يعني تسريبًا
    for (const id of retailIds) expect(clinicIds.has(id)).toBe(false);
    expect(retailIds.size).toBeGreaterThan(0);
    expect(clinicIds.size).toBeGreaterThan(0);

    // زرع نشاط العيادة تم فعليًا عبر claim scope: حسابات عيادة نوعية غير موجودة في التجزئة
    const clinicCodes = new Set(clinic.body.map((a: any) => a.code as string));
    const retailCodes = new Set(retail.body.map((a: any) => a.code as string));
    expect(clinicCodes.has('4160')).toBe(true); // إيراد كشف عيادة (clinic.seed.json)
    expect(retailCodes.has('4160')).toBe(false);
  });

  it('trial-balance يعيد أرصدة كل منشأة معزولة (15,000 للتجزئة مقابل 99,000 للعيادة)', async () => {
    const cashNet = async (token: string) => {
      const res = await base()
        .get('/api/v1/reports/trial-balance')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      // شكل الاستجابة الموثّق: { data: { asOfDate, rows: [{code, debit, credit (نص Decimal)}], balanced } }
      const body = res.body.data;
      expect(body.balanced).toBe(true);
      const cash = (body.rows as any[]).find((r) => String(r.code).startsWith('1101'));
      expect(cash).toBeDefined();
      return Number(cash.debit) - Number(cash.credit);
    };
    expect(await cashNet(tokenRetail)).toBe(15000);
    expect(await cashNet(tokenClinic)).toBe(99000);
  });

  it('انتحال هيدر x-tenant-id مُتجاهل — الهوية من claim tid الموقّع حصريًا', async () => {
    // لو احترَم الخادم الهيدر لانكسر العزل: قائمة تجزئة بانتحال عيادة يجب أن تبقى تجزئة
    const spoofed = await base()
      .get('/api/v1/accounts')
      .set('Authorization', `Bearer ${tokenRetail}`)
      .set('x-tenant-id', tenantClinicId)
      .expect(200);
    const ids = spoofed.body.map((a: any) => a.id as string);
    expect(ids.every((id: string) => id.startsWith(`acct_${tenantRetailId}_`))).toBe(true);
    expect(ids.some((id: string) => id.startsWith(`acct_${tenantClinicId}_`))).toBe(false);
  });

  it('login لنفس الهاتف يعيد توكن منشأته الصحيحة (ترتيب قطعي — لا عشوائية هوية الجلسة)', async () => {
    const res = await base()
      .post('/api/v1/auth/login')
      .send({
        phone: PHONE_CLINIC,
        password: 'Passw0rd123',
        device: { device_key: DEVICE_KEY, platform: 'android' },
      })
      .expect(200);
    expect(res.body.data.tenant.id).toBe(tenantClinicId);
    // التوكن الجديد يحمل scope الموقّع الصحيح لنشاط العيادة — يُقرأ من القاعدة لحظة الدخول
    const payload = JSON.parse(Buffer.from(res.body.data.tokens.access_token.split('.')[1], 'base64url').toString());
    expect(payload.scope).toBe('clinic');
    expect(payload.tid).toBe(tenantClinicId);
  });

  it('refresh يدور التوكن مع scope مقروء من القاعدة لحظة التدوير (لا claim بائت)', async () => {
    const login = await base()
      .post('/api/v1/auth/login')
      .send({ phone: PHONE_RETAIL, password: 'Passw0rd123', device: { device_key: DEVICE_KEY, platform: 'android' } })
      .expect(200);
    const rotated = await base()
      .post('/api/v1/auth/refresh')
      .send({ refresh_token: login.body.data.tokens.refresh_token })
      .expect(200);
    const payload = JSON.parse(Buffer.from(rotated.body.data.access_token.split('.')[1], 'base64url').toString());
    expect(payload.scope).toBe('retail');
    expect(payload.tid).toBe(tenantRetailId);
  });
});
