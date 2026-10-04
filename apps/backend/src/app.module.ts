import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { CategoryModule} from './category/category.module';

@Module({
    imports: [PrismaModule, CategoryModule],
    controllers: [],
    providers: [],
})
export class AppModule {}