import { Module } from "@nestjs/common";    
import { VariantController } from "./variant.controller";
import { VariantService } from './variant.service';
import { VariantBarcodeController } from "./variant-barcode.controller";
import { VariantBarcodeService } from "./variant-barcode.service";
import { VariantSupplierController } from "./variant-supplier.controller";
import { VariantSupplierService } from "./variant-supplier.service";
import { LocationModule } from "../location/location.module";


@Module({
    imports: [LocationModule],
    controllers: [VariantController, VariantBarcodeController, VariantSupplierController],
    providers: [VariantService, VariantBarcodeService, VariantSupplierService],
})
export class VariantModule {}