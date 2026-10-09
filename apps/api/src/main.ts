// src/main.ts
// ===== نقطة تشغيل الـ API =====

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.enableShutdownHooks(); // إغلاق نظيف لقاعدة SQLite (WAL checkpoint)

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`🚀 Mohaseb API listening on http://localhost:${port} (scope=${process.env.BUSINESS_SCOPE ?? 'retail'})`);
}

void bootstrap();
