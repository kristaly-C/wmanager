import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { randomBytes } from 'node:crypto';
import { Role } from '../generated/prisma/enums';
import { QrLoginDto } from './dto/qr-login.dto';

const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 60_000;
const LOGIN_WINDOW_MS = 5 * 60_000;
const MAX_FAILED_QR_ATTEMPTS = 10;
const QR_LOCKOUT_MS = 60_000;

interface FailedAttemptEntry {
    count: number;
    lockedUntil: number;
    lastAttemptAt: number;
}

@Injectable()
export class AuthService {
    private readonly failedAttempts = new Map<string, FailedAttemptEntry>();

    constructor(
        private prisma: PrismaService,
        private jwtService: JwtService,
    ) {}

    private pruneExpiredAttempts(now: number) {
        if (this.failedAttempts.size <= 1000) return;
        for (const [key, entry] of this.failedAttempts.entries()) {
            if (entry.lockedUntil <= now && now - entry.lastAttemptAt > LOGIN_WINDOW_MS) {
                this.failedAttempts.delete(key);
            }
        }
    }

    private assertNotLocked(key: string, message: string) {
        const entry = this.failedAttempts.get(key);
        if (!entry) return;
        const now = Date.now();
        if (entry.lockedUntil > now) {
            throw new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);
        }
        if (entry.lockedUntil > 0 && entry.lockedUntil <= now) {
            this.failedAttempts.delete(key);
        }
    }

    private recordFailure(key: string, maxAttempts: number, lockoutMs: number) {
        const now = Date.now();
        this.pruneExpiredAttempts(now);
        const existing = this.failedAttempts.get(key);
        const nextCount =
            !existing || now - existing.lastAttemptAt > LOGIN_WINDOW_MS ? 1 : existing.count + 1;
        const lockedUntil = nextCount >= maxAttempts ? now + lockoutMs : 0;
        this.failedAttempts.set(key, { count: nextCount, lockedUntil, lastAttemptAt: now });
    }

    private clearFailures(key: string) {
        this.failedAttempts.delete(key);
    }

    async login(data: LoginDto, clientIp = 'unknown') {
        const attemptKey = `login:${clientIp}:${data.email.trim().toLowerCase()}`;
        this.assertNotLocked(
            attemptKey,
            'Túl sok sikertelen bejelentkezési kísérlet ehhez a fiókhoz. Kérlek, várj 1 percet, majd próbáld újra!',
        );

        const user = await this.prisma.user.findUnique({
            where: { email: data.email}
        });

        if (!user || !user.isActive) {
            this.recordFailure(attemptKey, MAX_FAILED_LOGIN_ATTEMPTS, LOGIN_LOCKOUT_MS);
            throw new UnauthorizedException('Invalid credentials');
        }

        const passwordMatch = await bcrypt.compare(data.password, user.passwordHash);

        if(!passwordMatch) {
            this.recordFailure(attemptKey, MAX_FAILED_LOGIN_ATTEMPTS, LOGIN_LOCKOUT_MS);
            throw new UnauthorizedException('Invalid credentials');
        }

        this.clearFailures(attemptKey);

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

    async loginWithQr(dto: QrLoginDto, clientIp = 'unknown') {
        const attemptKey = `qr:${clientIp}`;
        this.assertNotLocked(
            attemptKey,
            'Túl sok hibás QR-kódos próbálkozás. Kérlek, várj 1 percet, majd próbáld újra!',
        );

        const user = await this.prisma.user.findUnique({
            where: { qrToken: dto.qrToken},
        });

        if(!user || !user.isActive) {
            this.recordFailure(attemptKey, MAX_FAILED_QR_ATTEMPTS, QR_LOCKOUT_MS);
            throw new UnauthorizedException('Érvénytelen vagy visszavont QR-kód');
        }

        try {
            this.assertQrAllowedForRole(user.role);
        } catch (err) {
            this.recordFailure(attemptKey, MAX_FAILED_QR_ATTEMPTS, QR_LOCKOUT_MS);
            throw err;
        }

        this.clearFailures(attemptKey);

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
