import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { CategoryModule} from './category/category.module';
import { SupplierModule } from './supplier/supplier.module';
import { ProductModule } from './product/product.module';
import { UserModule } from './user/user.module';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { VariantModule } from './variant/variant.module';
import { BrandModule } from './brand/brand.module';
import { LOcationModule } from './location/location.module';

@Module({
    imports: [
        ConfigModule.forRoot({isGlobal: true}),
        PrismaModule,
        CategoryModule, 
        SupplierModule, 
        ProductModule, 
        UserModule,
        AuthModule,
        VariantModule,
        BrandModule,
        LOcationModule
    ],
    controllers: [],
    providers: [],
})
export class AppModule {}