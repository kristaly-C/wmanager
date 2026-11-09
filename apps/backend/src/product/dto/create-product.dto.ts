import { ArrayMaxSize, IsArray, IsBoolean, IsNumber, IsObject, IsOptional, IsString, IsUrl, IsUUID, Max, MaxLength, Min, MinLength } from "class-validator";


export class CreateProductDto {
    @IsString()
    @MinLength(1)
    @MaxLength(255)
    name!: string;

    @IsUUID()
    brandId!: string;

    @IsString()
    @MinLength(1)
    @MaxLength(100)
    gender!: string;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    usageArea?: string;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    material?: string;

    @IsString()
    @MinLength(1)
    @MaxLength(150)
    model!: string;

    @IsString()
    @MinLength(1)
    @MaxLength(150)
    manufacturerCode!: string;

    @IsString()
    @IsOptional()
    @MaxLength(500)
    functionality?: string;

    @IsNumber()
    @Min(0)
    @Max(100)
    vatRate!: number;

    @IsUUID()
    primarySupplierId!: string;


    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @IsArray()
    @ArrayMaxSize(20)
    @IsUrl({ protocols: ['http', 'https'], require_protocol: true }, { each: true })
    @MaxLength(2048, { each: true })
    imageUrls!: string[];

    @IsOptional()
    @IsObject()
    attributes?: Record<string, string>;

    @IsUUID()
    categoryId!: string;

}
