import { IsEmail, IsEnum, IsString, MaxLength, MinLength } from "class-validator";
import { Role } from '../../generated/prisma/enums';


export class CreateUserDto {
    @IsEmail()
    @MaxLength(255)
    email!: string;

    @IsString()
    @MinLength(1)
    @MaxLength(150)
    name!: string;

    @IsEnum(Role)
    role!: Role;

    @IsString()
    @MinLength(8)
    @MaxLength(72)
    password!: string;
}
