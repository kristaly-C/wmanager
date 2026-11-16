import { ForbiddenException, Injectable } from "@nestjs/common";
import { AuthUser } from "../auth/decorators/current-user.decorator";
import { LOCATION_UNBOUND_ROLES } from "../common/location-scope";
import { LocationModel } from "../generated/prisma/models";
import { PrismaService } from "../prisma/prisma.service";

export type ScopedLocationSummary = Pick<LocationModel, 'id' | 'name' | 'type' | 'parentId'>;

export interface ScopedStockItemInput<TLoc extends ScopedLocationSummary> {
    id: string;
    locationId: string;
    variantId: string;
    quantity: number;
    reservedQuantity: number;
    minStockLevel: number | null;
    maxStockLevel: number | null;
    createdAt: Date;
    updatedAt: Date;
    location: TLoc;
}

export interface LocationScopeContext {
    isUnbound: boolean;
    accessibleIds: Set<string>;
    locationsById: Map<string, LocationModel>;
    isAssigned: (locationId: string) => boolean;
    rootOf: (locationId: string) => LocationModel | null;
}

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

    /**
     * Builds an in-memory location scope context for the user, used for
     * distinguishing assigned locations from external root locations and
     * rolling up external stock items to their root WAREHOUSE/STORE.
     */
    async getScopeContext(user: AuthUser): Promise<LocationScopeContext> {
        if (LOCATION_UNBOUND_ROLES.includes(user.role)) {
            return {
                isUnbound: true,
                accessibleIds: new Set<string>(),
                locationsById: new Map<string, LocationModel>(),
                isAssigned: () => true,
                rootOf: () => null,
            };
        }

        const [assigned, allLocations] = await Promise.all([
            this.assignedLocationIds(user.userId),
            this.prisma.location.findMany(),
        ]);

        const locationsById = new Map(allLocations.map((loc) => [loc.id, loc]));
        const accessibleIds = new Set<string>();
        const rootById = new Map<string, LocationModel | null>();

        const resolveRoot = (locationId: string): LocationModel | null => {
            if (rootById.has(locationId)) {
                return rootById.get(locationId) ?? null;
            }
            const visited = new Set<string>();
            const chain: LocationModel[] = [];
            let current = locationsById.get(locationId);
            while (current && !visited.has(current.id)) {
                visited.add(current.id);
                chain.push(current);
                if (current.parentId === null) {
                    break;
                }
                current = locationsById.get(current.parentId);
            }
            const root = chain.length > 0 ? chain[chain.length - 1] : null;
            for (const node of chain) {
                rootById.set(node.id, root);
            }
            return root;
        };

        for (const loc of allLocations) {
            resolveRoot(loc.id);
            if (assigned.size === 0) continue;
            let current: LocationModel | undefined = loc;
            const visited = new Set<string>();
            while (current && !visited.has(current.id)) {
                if (assigned.has(current.id)) {
                    accessibleIds.add(loc.id);
                    break;
                }
                visited.add(current.id);
                current = current.parentId ? locationsById.get(current.parentId) : undefined;
            }
        }

        return {
            isUnbound: false,
            accessibleIds,
            locationsById,
            isAssigned: (locationId: string) => accessibleIds.has(locationId),
            rootOf: (locationId: string) => resolveRoot(locationId),
        };
    }

    /**
     * Keeps assigned stock items at shelf/bin granularity (isExternalLocation: false)
     * and aggregates positive non-assigned stock items per (variantId, rootLocationId).
     */
    scopeStockItems<
        TLoc extends ScopedLocationSummary,
        TItem extends ScopedStockItemInput<TLoc>,
    >(
        items: TItem[],
        scope: LocationScopeContext,
        toExternalLocation: (root: LocationModel) => TLoc,
    ): Array<
        Omit<TItem, 'location'> & {
            isExternalLocation: boolean;
            location: TLoc & { isAssigned: boolean };
        }
    > {
        if (scope.isUnbound) {
            return items.map((item) => ({
                ...item,
                isExternalLocation: false,
                location: {
                    ...item.location,
                    isAssigned: true,
                },
            }));
        }

        type ScopedResult = Omit<TItem, 'location'> & {
            isExternalLocation: boolean;
            location: TLoc & { isAssigned: boolean };
        };

        const assignedItems: ScopedResult[] = [];
        const externalByKey = new Map<string, ScopedResult>();

        for (const item of items) {
            if (scope.isAssigned(item.locationId)) {
                assignedItems.push({
                    ...item,
                    isExternalLocation: false,
                    location: {
                        ...item.location,
                        isAssigned: true,
                    },
                });
                continue;
            }

            if (item.quantity <= 0) {
                continue;
            }

            const root = scope.rootOf(item.locationId);
            if (!root) {
                continue;
            }

            const key = `${item.variantId}:${root.id}`;
            const existing = externalByKey.get(key);
            if (!existing) {
                externalByKey.set(key, {
                    ...item,
                    id: `external:${item.variantId}:${root.id}`,
                    locationId: root.id,
                    minStockLevel: null,
                    maxStockLevel: null,
                    isExternalLocation: true,
                    location: {
                        ...toExternalLocation(root),
                        isAssigned: false,
                    },
                });
            } else {
                existing.quantity += item.quantity;
                existing.reservedQuantity += item.reservedQuantity;
                if (item.createdAt < existing.createdAt) {
                    existing.createdAt = item.createdAt;
                }
                if (item.updatedAt > existing.updatedAt) {
                    existing.updatedAt = item.updatedAt;
                }
            }
        }

        return [...assignedItems, ...externalByKey.values()];
    }

}