import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { PrismaExceptionFilter } from './prisma/prisma-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.useGlobalPipes(new ValidationPipe({whitelist: true, forbidNonWhitelisted: true}));
  app.useGlobalFilters(new PrismaExceptionFilter());
  const port = Number(process.env.PORT) || 4001;
  await app.listen(port);
}
bootstrap();
