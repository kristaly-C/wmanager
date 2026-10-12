import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../generated/prisma/enums';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';


@Controller('users')
export class UserController {
    constructor(private readonly userService: UserService) {}

    @UseGuards(JwtAuthGuard)
    @Get()
    findAll() {
        return this.userService.findAll();
    }

    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(Role.ADMIN, Role.BOSS, Role.STORE_MANAGER, Role.WAREHOUSE_MANAGER)
    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.userService.findOne(id);
    }

    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(Role.ADMIN, Role.BOSS)
    @Post()
    create(@Body() data: CreateUserDto, @CurrentUser() actor: AuthUser) {
        return this.userService.createUser(data, actor);
    }
    @UseGuards(JwtAuthGuard,RolesGuard)
    @Roles(Role.ADMIN, Role.BOSS)
    @Patch(':id')
    update(@Param('id') id: string, @Body() data: UpdateUserDto) {
        return this.userService.updateUser(id, data);
    }


    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(Role.ADMIN, Role.BOSS)
    @Delete(':id')
    remove(@Param('id') id: string, @CurrentUser() actor: AuthUser){
        return this.userService.removeUser(id, actor);
    }
}