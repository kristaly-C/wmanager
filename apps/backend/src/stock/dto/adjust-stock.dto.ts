import { IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, NotEquals } from "class-validator";
import { MovementType } from "../../generated/prisma/enums";



export class AdjustStockDto {

    @IsUUID()
    variantId!: string;

    @IsUUID()
    locationId!: string;

    @IsInt()
    @NotEquals(0, {message: 'A mennyiség változása nem lehet 0'})
    quantityChange!: number;

    @IsEnum(MovementType)
    @IsIn([MovementType.INITIAL_STOCK, MovementType.MANUAL_CORRECTION], {
        message: 'Kézi készletmódosításnál csak INITIAL_STOCK vagy MANUAL_CORRECTION adható meg'
    })
    type!: MovementType;


    @IsOptional()
    @IsString()
    note?: string;
}