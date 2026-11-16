import { IsBoolean } from 'class-validator';

export class UpdateStockSettingsDto {
    @IsBoolean()
    initialStockEnabled!: boolean;
}
