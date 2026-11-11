import { IsBoolean, IsOptional, IsString, IsUUID } from "class-validator";

export class CreateStocktakeDto {
    @IsUUID()
    locationId!: string;

    @IsOptional()
    @IsString()
    note?: string;

    @IsOptional()
    @IsBoolean()
    isTask?: boolean;

    @IsOptional()
    @IsBoolean()
    splitByChildren?: boolean;
}
