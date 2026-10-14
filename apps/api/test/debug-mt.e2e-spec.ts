import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as request from 'supertest';
import { resetAuthSettingsForTests } from '../src/auth/auth-config';

const DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dbg-mt-')), 'test.db');
process.env.DB_PATH = DB_PATH;
process.env.MULTI_TENANCY = '1';
resetAuthSettingsForTests();
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { AppModule } = require('../src/app.module');

it('debug clinic sale', async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  await app.init();
  const base = () => request.default(app.getHttpServer());
  const dto = (phone: string, t: string) => ({
    full_name: 'DBG', phone, password: 'Passw0rd123', business_name: 'متجر debug', business_type_code: t,
    base_currency_code: 'YER', device: { device_key: 'dbg-key-' + t, device_name: 'X', platform: 'android' },
  });
  const r = await base().post('/api/v1/auth/register').send(dto('719999901', 'retail'));
  console.log('REG RETAIL', r.status, JSON.stringify(r.body).slice(0, 500));
  const c = await base().post('/api/v1/auth/register').send(dto('719999902', 'clinic'));
  console.log('REG CLINIC', c.status, JSON.stringify(c.body).slice(0, 300));
  if (r.status !== 201 || c.status !== 201) { await app.close(); return; }
  const resR = await base().post('/api/v1/transactions').set('Authorization', `Bearer ${r.body.data.tokens.access_token}`)
    .send({ templateCode: 'sale_cash', payload: { total_amount: '15000', currency_code: 'YER' } });
  console.log('TX RETAIL', resR.status, JSON.stringify(resR.body).slice(0, 500));
  const resC = await base().post('/api/v1/transactions').set('Authorization', `Bearer ${c.body.data.tokens.access_token}`)
    .send({ templateCode: 'sale_cash', payload: { total_amount: '99000', currency_code: 'YER' } });
  console.log('TX CLINIC', resC.status, JSON.stringify(resC.body).slice(0, 500));
  const accR = await base().get('/api/v1/accounts').set('Authorization', `Bearer ${r.body.data.tokens.access_token}`);
  console.log('ACC RETAIL', accR.status, JSON.stringify(accR.body).slice(0, 300));
  await app.close();
}, 30000);
