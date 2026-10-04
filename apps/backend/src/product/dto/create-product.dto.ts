import { IsArray, IsBoolean, IsNumber, IsObject, IsOptional, IsString, IsUUID } from "class-validator";


export class CreateProductDto {
    @IsString()
    name!: string;

    @IsUUID()
    brandId!: string;

    @IsString()
    gender!: string;

    @IsOptional()
    @IsString()
    usageArea?: string;

    @IsOptional()
    @IsString()
    material?: string;

    @IsString()
    model!: string;

    @IsString()
    manufacturerCode!: string;

    @IsString()
    @IsOptional()
    functionality?: string;

    @IsNumber()
    vatRate!: number;

    @IsUUID()
    primarySupplierId!: string;


    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @IsArray()
    @IsString({each: true})
    imageUrls!: string[];

    @IsOptional()
    @IsObject()
    attributes?: Record<string, string>;

    @IsUUID()
    categoryId!: string;

}