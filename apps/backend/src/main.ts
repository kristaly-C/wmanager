import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { PrismaExceptionFilter } from './prisma/prisma-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Nginx reverse proxy mögött a valódi kliens IP használata (X-Forwarded-For)
  app.set('trust proxy', 1);

  // Biztonsági HTTP fejlécek
  app.use(helmet());

  // CORS szigorítása: CORS_ORIGIN környezeti változó alapján, vagy fejlesztői környezetben a Vite dev szerverre
  const corsOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
    : process.env.NODE_ENV === 'production'
      ? false
      : ['http://localhost:5173', 'http://127.0.0.1:5173'];

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
  app.useGlobalFilters(new PrismaExceptionFilter());

  const port = Number(process.env.PORT) || 4001;
  await app.listen(port);
}
bootstrap();
