import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class ReassignSalesOrderLocationDto {
    @IsUUID()
    sourceLocationId!: string;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    note?: string;
}
