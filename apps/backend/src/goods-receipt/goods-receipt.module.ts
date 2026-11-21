import { Module } from '@nestjs/common';
import { LocationModule } from '../location/location.module';
import { GoodsReceiptController } from './goods-receipt.controller';
import { GoodsReceiptService } from './goods-receipt.service';

@Module({
    imports: [LocationModule],
    controllers: [GoodsReceiptController],
    providers: [GoodsReceiptService],
    exports: [GoodsReceiptService],
})
export class GoodsReceiptModule {}
