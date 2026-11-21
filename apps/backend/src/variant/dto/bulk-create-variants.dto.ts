import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsBoolean,
    IsNumber,
    IsOptional,
    IsString,
    IsUrl,
    IsUUID,
    MaxLength,
    Min,
    MinLength,
    ValidateNested,
} from 'class-validator';

export class BulkVariantItemDto {
    @IsString()
    @MinLength(1)
    @MaxLength(100)
    sku!: string;

    @IsOptional()
    @IsString()
    @MaxLength(50)
    size?: string;

    @IsOptional()
    @IsArray()
    @ArrayMaxSize(20)
    @IsString({ each: true })
    @MaxLength(50, { each: true })
    colors?: string[];

    @IsOptional()
    @Min(0)
    @IsNumber()
    weight?: number;

    @IsOptional()
    @Min(0)
    @IsNumber()
    netWeight?: number;

    @IsOptional()
    @Min(0)
    @IsNumber()
    volume?: number;

    @Min(0)
    @IsNumber()
    netPrice!: number;

    @Min(0)
    @IsNumber()
    grossPrice!: number;

    @Min(0)
    @IsNumber()
    costPrice!: number;

    @IsOptional()
    @IsArray()
    @ArrayMaxSize(20)
    @IsUrl({ protocols: ['http', 'https'], require_protocol: true }, { each: true })
    @MaxLength(2048, { each: true })
    imageUrls?: string[];

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(100)
    primaryBarcode?: string;
}

export class BulkCreateVariantsDto {
    @IsUUID()
    productId!: string;

    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(100)
    @ValidateNested({ each: true })
    @Type(() => BulkVariantItemDto)
    items!: BulkVariantItemDto[];
}
