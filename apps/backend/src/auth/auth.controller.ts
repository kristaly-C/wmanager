import { Controller, Post, Body, Get, UseGuards, Patch, Req } from "@nestjs/common";
import type { Request } from "express";
import { Throttle } from "@nestjs/throttler";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { AuthUser, CurrentUser } from "./decorators/current-user.decorator";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { QrLoginDto } from "./dto/qr-login.dto";

@Controller('auth')
export class AuthController {
    constructor(private authService: AuthService){}

    @UseGuards(JwtAuthGuard)
    @Get('me')
    getMe(@CurrentUser() user: any){
        return user;
    }

    @Throttle({ default: { limit: 30, ttl: 60000 } })
    @Post('login')
    login(@Body() logindDto: LoginDto, @Req() req: Request){
        return this.authService.login(logindDto, req.ip || 'unknown');
    }

    @Throttle({ default: { limit: 5, ttl: 60000 } })
    @UseGuards(JwtAuthGuard)
    @Patch('password')
    changePassword(@CurrentUser() actor: AuthUser, @Body() dto: ChangePasswordDto) {
        return this.authService.changePassword(actor.userId, dto);
    }

    @Throttle({ default: {limit: 60, ttl: 60000}})
    @Post('qr-login')
    loginWithQr(@Body() dto: QrLoginDto, @Req() req: Request) {
        return this.authService.loginWithQr(dto, req.ip || 'unknown');
    }

    @UseGuards(JwtAuthGuard)
    @Get('my-qr')
    getMyQr(@CurrentUser() actor: AuthUser){
        return this.authService.getMyQrToken(actor.userId);
    }


    @Throttle({ default: { limit: 5, ttl: 60000 } })
    @UseGuards(JwtAuthGuard)
    @Post('my-qr/regenerate')
    regenerateMyQr(@CurrentUser() actor: AuthUser) {
        return this.authService.regenerateQrToken(actor.userId);
    }
}
