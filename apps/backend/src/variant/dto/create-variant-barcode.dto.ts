import { IsBoolean, IsOptional, IsString, MinLength } from "class-validator";


export class CreateVariantBarcodeDto {

    @MinLength(1)
    @IsString()
    barcode!: string;

    @IsOptional()
    @IsBoolean()
    isPrimary?: boolean;

    @IsOptional()
    @IsString()
    note?: string;
}