import { IsEmail, IsEnum, IsString, MinLength } from "class-validator";
import { Role } from '../../generated/prisma/enums';


export class CreateUserDto {
    @IsEmail()
    email!: string;

    @IsString()
    name!: string;

    @IsEnum(Role)
    role!: Role;

    @IsString()
    @MinLength(8)
    password!: string;
}