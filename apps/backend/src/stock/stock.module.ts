import { Module } from "@nestjs/common";
import { LocationModule } from "../location/location.module";
import { StockController } from "./stock.controller";
import { StockService } from "./stock.service";



@Module({
    imports: [LocationModule],
    controllers: [ StockController],
    providers: [ StockService],
    exports: [ StockService]
})
export class StockModule {}