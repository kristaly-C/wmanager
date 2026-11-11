import { Type } from "class-transformer";
import { IsArray, IsOptional, ValidateNested } from "class-validator";
import { RecordStocktakeItemDto } from "./record-stocktake-item.dto";

export class SubmitStocktakeDto {
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => RecordStocktakeItemDto)
    items?: RecordStocktakeItemDto[];
}
