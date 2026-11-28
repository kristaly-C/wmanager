import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class RequestSalesOrderTransferDto {
    @IsUUID()
    transferRequestedFromLocationId!: string;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    holdReason?: string;

    @IsOptional()
    @IsString()
    @MaxLength(2000)
    note?: string;
}
