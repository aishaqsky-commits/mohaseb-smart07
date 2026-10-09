import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

it('probe sale_credit', async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app: INestApplication = moduleRef.createNestApplication({ logger: ['error'] });
  await app.init();
  const res = await request.default(app.getHttpServer())
    .post('/api/v1/transactions')
    .send({ templateCode: 'sale_credit', payload: { total_amount: '50000', currency_code: 'YER' } });
  console.log('STATUS=', res.statusCode, 'BODY=', JSON.stringify(res.body).slice(0, 400));
  await app.close();
}, 30000);
