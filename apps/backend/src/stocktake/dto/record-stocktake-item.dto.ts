import { IsInt, IsOptional, IsString, IsUUID, Min } from "class-validator";




export class RecordStocktakeItemDto {

    @IsUUID()
    variantId!: string;

    @IsInt()
    @Min(0, {message: 'A számolt mennyiség nem lehet negativ'})
    countedQuantity!: number;

    @IsOptional()
    @IsString()
    note?: string;
}