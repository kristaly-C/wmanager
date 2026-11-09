import { ForbiddenException, Injectable } from "@nestjs/common";
import { AuthUser } from "../auth/decorators/current-user.decorator";
import { LOCATION_UNBOUND_ROLES } from "../common/location-scope";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class LocationAccessService {
    constructor(private prisma: PrismaService) {}

    async assignedLocationIds(userId: string): Promise<Set<string>> {
        const rows = await this.prisma.userLocation.findMany(
            {where: { userId}
            , select: { locationId: true},
        });
        return new Set(rows.map((row) => row.locationId));
    }


    async isUnderAssigned(locationId: string, assigned: Set<string>): Promise<boolean> {
        if(assigned.size === 0) return false;
        if(assigned.has(locationId)) return true;
        

        const loc = await this.prisma.location.findUnique({
            where: { id: locationId},
            select: {
                parentId: true,
                parent: {
                    select: {
                        parentId : true,
                        parent: {
                            select: { parentId: true},
                        },
                    },
                },
            },
        })

        if(!loc) return false;

        const ancestorIds = [
            loc.parentId,
            loc.parent?.parentId,
            loc.parent?.parent?.parentId,
        ];

        return ancestorIds.some((id) => id != null && assigned.has(id));
        
    }

    async canAccess(user: AuthUser, locationId: string): Promise<boolean> {
        if( LOCATION_UNBOUND_ROLES.includes(user.role)){
            return true;
        }

        const assigned = await this.assignedLocationIds(user.userId);

        return this.isUnderAssigned(locationId,assigned)
    }

    async assertCanAccess(user: AuthUser, locationId: string) {
        if( !(await this.canAccess(user,locationId))) {
            throw new ForbiddenException('Ehhez a helyhez nincs hozzáférésed')
        }
    }

    async accessibleWhere(user: AuthUser) {
        if( LOCATION_UNBOUND_ROLES.includes(user.role)) {
            return {};
        }

        const ids = Array.from(await this.assignedLocationIds(user.userId));
        if(ids.length === 0){
            return {id: {in: []}};
        }

        return {
            OR: [
                {id: {in: ids}},
                {parentId: { in: ids}},
                {parent: {parentId: { in: ids}}},
                {parent: {parent: {parentId: {in: ids} } } },
            ],
        };
    }


}