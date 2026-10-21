import { IsArray, IsBoolean, IsNumber, IsObject, IsOptional, IsString, IsUUID } from "class-validator";


export class CreateVariantDto{
    
    @IsUUID()
    productId!: string;

    @IsUUID()
    sku!: string;

    @IsArray()
    @IsString({each: true})
    colors!: string[];

    @IsString()
    size!: string;

    @IsOptional()
    @IsNumber()
    weight?: number;

    @IsNumber()
    price!: number;

    @IsNumber()
    costPrice!: number;

    @IsBoolean()
    isActive!: boolean;

    @IsString()
    createdAt!: string;

    @IsString()
    updatedAt!: string;
}