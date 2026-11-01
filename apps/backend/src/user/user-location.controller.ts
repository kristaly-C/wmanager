import { Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { UserLocationService } from "./user-location.service";
import { Roles } from "../auth/decorators/roles.decorator";
import { Role } from "../generated/prisma/enums";
import { AuthUser, CurrentUser } from "../auth/decorators/current-user.decorator";
import { AssignLocationDto } from "./dto/assign-location.dto";



@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users/:userId/locations')
export class UserLocationController{

    constructor(private userLocationService: UserLocationService) {}

    @Roles(Role.ADMIN, Role.BOSS)
    @Get()
    list(@Param('userId') userId: string){
        return this.userLocationService.list(userId);
    }


    @Roles(Role.ADMIN, Role.BOSS)
    @Post()
    assign(@Param('userId') userId: string, @Body() dto: AssignLocationDto, @CurrentUser() actor: AuthUser){
        return this.userLocationService.assign(userId,dto.locationId,actor)
    }

    @Roles(Role.ADMIN, Role.BOSS)
    @Delete(':locationId')
    unassign(
        @Param('userId') userId: string,
        @Param('locationId') locId: string,
        @CurrentUser() actor: AuthUser
    ){
        return this.userLocationService.unassign(userId,locId,actor)
    }
}