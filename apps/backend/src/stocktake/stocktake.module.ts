import { Module } from "@nestjs/common";
import { LocationModule } from "../location/location.module";
import { StocktakeController } from "./stocktake.controller";
import { StocktakeService } from "./stocktake.service";



@Module({
    imports: [LocationModule],
    controllers: [ StocktakeController],
    providers: [ StocktakeService]
})
export class StocktakeModule {}