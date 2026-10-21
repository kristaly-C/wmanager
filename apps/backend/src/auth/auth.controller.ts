import { Controller, Post, Body, Get, UseGuards } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { CurrentUser } from "./decorators/current-user.decorator";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";

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
}