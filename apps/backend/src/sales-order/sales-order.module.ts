import { Module } from '@nestjs/common';
import { LocationModule } from '../location/location.module';
import { PickTaskController } from './pick-task.controller';
import { PickTaskService } from './pick-task.service';
import { SalesOrderController } from './sales-order.controller';
import { SalesOrderService } from './sales-order.service';

@Module({
    imports: [LocationModule],
    controllers: [SalesOrderController, PickTaskController],
    providers: [PickTaskService, SalesOrderService],
    exports: [PickTaskService, SalesOrderService],
})
export class SalesOrderModule {}
