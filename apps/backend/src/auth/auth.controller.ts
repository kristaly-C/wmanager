import { Controller, Post, Body, Get, UseGuards, Patch } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { AuthUser, CurrentUser } from "./decorators/current-user.decorator";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { ChangePasswordDto } from "./dto/change-password.dto";

@Controller('auth')
export class AuthController {
    constructor(private authService: AuthService){}

    @UseGuards(JwtAuthGuard)
    @Get('me')
    getMe(@CurrentUser() user: any){
        return user;
    }

    @Post('login')
    login(@Body() logindDto: LoginDto){
        return this.authService.login(logindDto);
    }

    @UseGuards(JwtAuthGuard)
    @Patch('password')
    changePassword(@CurrentUser() actor: AuthUser, @Body() dto: ChangePasswordDto) {
        return this.authService.changePassword(actor.userId, dto);
    }
}