import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class CompleteSalesOrderDto {
    @IsOptional()
    @IsBoolean()
    instantFromShelf?: boolean;

    @IsOptional()
    @IsString()
    @MaxLength(2000)
    note?: string;
}
