import { ArrayMaxSize, IsArray, IsBoolean, IsNumber, IsObject, IsOptional, IsString, IsUrl, IsUUID, Max, MaxLength, Min, MinLength } from "class-validator";


export class CreateProductDto {
    @IsString()
    @MinLength(1)
    @MaxLength(255)
    name!: string;

    @IsUUID()
    brandId!: string;

    @IsOptional()
    @IsString()
    @MaxLength(100)
    gender?: string;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    usageArea?: string;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    material?: string;

    @IsOptional()
    @IsString()
    @MaxLength(150)
    model?: string;

    @IsOptional()
    @IsString()
    @MaxLength(150)
    manufacturerCode?: string;

    @IsString()
    @IsOptional()
    @MaxLength(500)
    functionality?: string;

    @IsString()
    @IsOptional()
    @MaxLength(5000)
    description?: string;

    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(20)
    unit?: string;

    @IsOptional()
    @IsString()
    @MaxLength(32)
    vtszCode?: string;

    @IsOptional()
    @IsString()
    @MaxLength(10)
    originCountry?: string;

    @IsOptional()
    @IsString()
    @MaxLength(1000)
    importantNote?: string;

    @IsOptional()
    @IsString()
    @MaxLength(50)
    season?: string;

    @IsOptional()
    @IsBoolean()
    isSerialized?: boolean;

    @IsOptional()
    @IsBoolean()
    isPurchasable?: boolean;

    @IsNumber()
    @Min(0)
    @Max(100)
    vatRate!: number;

    @IsUUID()
    primarySupplierId!: string;


    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @IsOptional()
    @IsArray()
    @ArrayMaxSize(20)
    @IsUrl({ protocols: ['http', 'https'], require_protocol: true }, { each: true })
    @MaxLength(2048, { each: true })
    imageUrls?: string[];

    @IsOptional()
    @IsObject()
    attributes?: Record<string, string>;

    @IsUUID()
    categoryId!: string;

}
