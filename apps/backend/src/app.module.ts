import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { CategoryModule} from './category/category.module';
import { SupplierModule } from './supplier/supplier.module';
import { ProductModule } from './product/product.module';
import { UserModule } from './user/user.module';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { VariantModule } from './variant/variant.module';

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
    ],
    controllers: [],
    providers: [],
})
export class AppModule {}