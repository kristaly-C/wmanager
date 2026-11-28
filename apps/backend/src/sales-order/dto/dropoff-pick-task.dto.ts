import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class DropoffPickTaskDto {
    @IsOptional()
    @IsUUID()
    dropoffLocationId?: string;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    dropoffCode?: string;

    @IsOptional()
    @IsBoolean()
    handoverAtCounter?: boolean;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    note?: string;
}
