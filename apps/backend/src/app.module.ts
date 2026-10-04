import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { CategoryModule} from './category/category.module';
import { SupplierModule } from './supplier/supplier.module';
import { ProductModule } from './product/product.module';

@Module({
    imports: [PrismaModule, CategoryModule, SupplierModule, ProductModule],
    controllers: [],
    providers: [],
})
export class AppModule {}