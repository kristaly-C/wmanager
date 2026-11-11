import { Module } from "@nestjs/common";    
import {VariantController} from "./variant.controller";
import { VariantService} from './variant.service';
import { VariantBarcodeController } from "./variant-barcode.controller";
import { VariantBarcodeService } from "./variant-barcode.service";


@Module({
    controllers: [ VariantController, VariantBarcodeController],
    providers: [ VariantService, VariantBarcodeService],
})
export class VariantModule {}