import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';


@Injectable()
export class AuthService {
    constructor(
        private prisma: PrismaService,
        private jwtService: JwtService,
    ) {}

    async login(data: LoginDto) {
        const user = await this.prisma.user.findUnique({
            where: { email: data.email}
        });

        if (!user || !user.isActive) {
            throw new UnauthorizedException('Invalid credentials');
        }

        const passwordMatch = await bcrypt.compare(data.password, user.passwordHash);

        if(!passwordMatch) {
            throw new UnauthorizedException('Invalid credentials');
        }

        const payload = {sub: user.id, email: user.email, role: user.role};
        return {
            accessToken: this.jwtService.sign(payload),
        };
    }

    async changePassword(userId: string, dto: ChangePasswordDto){
        const user = await this.prisma.user.findUnique({where: {id: userId}});
        if(!user){
            throw new UnauthorizedException();
        }
        
        if(!await bcrypt.compare(dto.currentPassword, user.passwordHash)){
            throw new BadRequestException('A jelenlegi jelszó hibás')
        }
        if( await bcrypt.compare(dto.newPassword, user.passwordHash)){
            throw new BadRequestException('Az új jelszónak különböznie kell a jelenlegitől')
        }
        await this.prisma.user.update({
            where: {id: userId},
            data: {
                passwordHash: await bcrypt.hash(dto.newPassword, 10),
                passwordChangedAt: new Date(),
            }
        });
        return {message: 'Jelszo módositva'};
    }
}