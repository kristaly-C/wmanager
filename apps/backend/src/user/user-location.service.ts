import { BadRequestException, Injectable } from "@nestjs/common";
import { BaseService } from "../common/base.service";
import { PrismaService } from "../prisma/prisma.service";
import { UserService } from "./user.service";
import { AuthUser } from "../auth/decorators/current-user.decorator";
import { LOCATION_UNBOUND_ROLES } from "../common/location-scope";
import { LocationType } from "../generated/prisma/enums";



@Injectable()
export class UserLocationService {
    locationService: any;
    constructor(
        private prisma: PrismaService,
        private userService: UserService,
    ) {}


    async list(userId: string) {
        await this.userService.findOne(userId);
        return this.prisma.userLocation.findMany({
            where: { userId },
            include: { location: true },
        });
    }

    async assign(userId: string, locationId: string, actor: AuthUser) {
        const target = await this.userService.findOne(userId);
        this.userService.assertCanManage(actor, target.role);


        if (LOCATION_UNBOUND_ROLES.includes(target.role)) {
            throw new BadRequestException('Ehhez a szerepkörhöz nem rendelhető hely.');
        }

        const location = await this.prisma.location.findUnique({where: {id: locationId}});

        if(!location){
            throw new BadRequestException('A megadott lokáció nem létezik');
        }

        if(location.type !== LocationType.STORE && location.type !== LocationType.WAREHOUSE){
            throw new BadRequestException('Csak bolt vagy raktár rendelhető hozzá');
        }

        return this.prisma.userLocation.create({
            data: { userId, locationId },
            include: { location: true },
        });
    }

    async unassign(userId: string, locationId: string, actor: AuthUser) {
        const target = await this.userService.findOne(userId);
        this.userService.assertCanManage(actor, target.role);

        return this.prisma.userLocation.delete({
            where: { userId_locationId: { userId, locationId}},
            include: { location: true },
        })
    }

}