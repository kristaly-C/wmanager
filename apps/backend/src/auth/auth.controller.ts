import { Controller, Post, Body, Get, UseGuards, Patch } from "@nestjs/common";
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

    @Throttle({ default: { limit: 5, ttl: 60000 } })
    @Post('login')
    login(@Body() logindDto: LoginDto){
        return this.authService.login(logindDto);
    }

    @Throttle({ default: { limit: 5, ttl: 60000 } })
    @UseGuards(JwtAuthGuard)
    @Patch('password')
    changePassword(@CurrentUser() actor: AuthUser, @Body() dto: ChangePasswordDto) {
        return this.authService.changePassword(actor.userId, dto);
    }

    @Throttle({ default: {limit: 15, ttl: 60000}})
    @Post('qr-login')
    loginWithQr(@Body() dto: QrLoginDto) {
        return this.authService.loginWithQr(dto);
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
