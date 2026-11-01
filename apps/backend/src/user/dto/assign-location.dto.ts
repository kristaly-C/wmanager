import { IsString, IsUUID } from "class-validator";



export class AssignLocationDto {

    @IsString()
    @IsUUID()
    locationId!: string;
}