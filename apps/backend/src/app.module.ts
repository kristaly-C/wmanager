import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { CategoryModule } from './category/category.module';
import { SupplierModule } from './supplier/supplier.module';
import { ProductModule } from './product/product.module';
import { UserModule } from './user/user.module';
import { AuthModule } from './auth/auth.module';
import { VariantModule } from './variant/variant.module';
import { BrandModule } from './brand/brand.module';
import { LocationModule } from './location/location.module';
import { StockModule } from './stock/stock.module';

function validateEnv(config: Record<string, unknown>) {
    const databaseUrl = config.DATABASE_URL;
    if (typeof databaseUrl !== 'string' || !databaseUrl.trim()) {
        throw new Error('[Config] Hiányzó vagy üres DATABASE_URL környezeti változó!');
    }

    const jwtSecret = config.JWT_SECRET;
    if (
        typeof jwtSecret !== 'string' ||
        jwtSecret.trim().length < 32 ||
        jwtSecret.trim() === 'cserelj_le_egy_hosszu_titkos_kulcsra'
    ) {
        throw new Error(
            '[Config] A JWT_SECRET környezeti változó kötelező, legalább 32 karakter hosszúnak kell lennie, és nem lehet az alapértelmezett példaérték!',
        );
    }

    return config;
}

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            validate: validateEnv,
        }),
        ThrottlerModule.forRoot([
            {
                ttl: 60000,
                limit: 100,
            },
        ]),
        PrismaModule,
        CategoryModule,
        SupplierModule,
        ProductModule,
        UserModule,
        AuthModule,
        VariantModule,
        BrandModule,
        LocationModule,
        StockModule,
    ],
    controllers: [],
    providers: [
        {
            provide: APP_GUARD,
            useClass: ThrottlerGuard,
        },
    ],
})
export class AppModule {}
