import { PartialType } from "@nestjs/mapped-types";
import { CreateVariantBarcodeDto } from "./create-variant-barcode.dto";



export class UpdateVariantBarcodeDto extends PartialType(CreateVariantBarcodeDto) {}