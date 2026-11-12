import { BadRequestException,ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { randomBytes } from 'node:crypto';
import { Role } from '../generated/prisma/enums';
import { QrLoginDto } from './dto/qr-login.dto';

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
        if(!user || !user.isActive){
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
                passwordChangedAt: new Date(Date.now() - 1000),
            }
        });

        const payload = { sub: user.id, email: user.email, role: user.role };
        return {
            message: 'Jelszo módositva',
            accessToken: this.jwtService.sign(payload),
        };
    }


    private assertQrAllowedForRole(role: Role){
        if( role === Role.ADMIN || role === Role.BOSS) {
            throw new ForbiddenException('Adminisztrátor és tulajdonos fiókhoz nem használható QR-kódos belépés');
        }
    }

    private generateQrTokenString(): string {
        return `WM-AUTH-${randomBytes(16).toString('hex')}`;
    }

    async loginWithQr(dto: QrLoginDto) {
        const user = await this.prisma.user.findUnique({
            where: { qrToken: dto.qrToken},
        });

        if(!user || !user.isActive) {
            throw new UnauthorizedException('Érvénytelen vagy visszavont QR-kód');
        }

        this.assertQrAllowedForRole(user.role);

        const payload = {sub: user.id, email: user.email, role: user.role};
        return {
            accessToken: this.jwtService.sign(payload),
            user: {
                userId: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
            },
        };
    }


    async getMyQrToken(userId: string) {
        const user = await this.prisma.user.findUnique({ where: {id: userId}});
        if(!user || !user.isActive){
            throw new UnauthorizedException();
        }

        this.assertQrAllowedForRole(user.role);

        if(user.qrToken) {
            return {qrToken: user.qrToken};
        }

        const qrToken = this.generateQrTokenString();
        await this.prisma.user.update({
            where: {id: userId},
            data: {qrToken},
        });

        return {qrToken};
    }

    async regenerateQrToken(userId: string) {
        const user = await this.prisma.user.findUnique({where: { id: userId}});
        if (!user || !user.isActive) {
            throw new UnauthorizedException();
        }
        this.assertQrAllowedForRole(user.role);

        const qrToken = this.generateQrTokenString();
        await this.prisma.user.update({
            where: {id: userId},
            data: {qrToken},
        });

        return {qrToken};
    }
}
