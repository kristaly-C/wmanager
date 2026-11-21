import { Type } from 'class-transformer';
import {
    IsBoolean,
    IsNumber,
    IsOptional,
    IsString,
    IsUUID,
    Length,
    Matches,
    Max,
    MaxLength,
    Min,
} from 'class-validator';

export class CreateVariantSupplierDto {
    @IsUUID()
    supplierId!: string;

    @IsOptional()
    @IsString()
    @MaxLength(100)
    supplierSku?: string;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    supplierProductName?: string;

    @Type(() => Number)
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0)
    purchasePrice!: number;

    @IsOptional()
    @IsString()
    @Length(3, 3)
    @Matches(/^[A-Za-z]{3}$/, {
        message: 'A pénznemnek 3 betűs ISO kódnak kell lennie (pl. HUF, EUR, USD)',
    })
    currency?: string;

    @IsOptional()
    @Type(() => Number)
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0)
    @Max(100)
    discountPercent?: number;

    @IsOptional()
    @IsString()
    @MaxLength(50)
    orderUnit?: string;

    @IsOptional()
    @IsBoolean()
    isPrimary?: boolean;

    @IsOptional()
    @IsString()
    @MaxLength(1000)
    note?: string;
}
