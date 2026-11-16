import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { LocationAccessService } from "../location/location-access.service";
import { AuthUser } from "../auth/decorators/current-user.decorator";
import { AdjustStockDto } from "./dto/adjust-stock.dto";
import { LocationType, SlotMode, MovementType } from "../generated/prisma/enums";
import { canSeeCostPrice, excludeCostPrice } from "../common/cost-price";


export interface FindStockOptions {
    locationId?: string;
    variantId?: string;
    productId?: string;
    search?: string;
    skip?: number;
    take?: number;
}
export interface FindMovementsOptions {
    locationId?: string;
    variantId?: string;
    productId?: string;
    type?: MovementType;
    search?: string;
    skip?: number;
    take?: number;
}

@Injectable()
export class StockService {
    constructor(
        private prisma: PrismaService,
        private locationAccesService: LocationAccessService,
    ){}

    async findAll(user: AuthUser, options?: FindStockOptions) {
        const scope = await this.locationAccesService.getScopeContext(user);
        if (options?.locationId && !scope.isUnbound && !scope.isAssigned(options.locationId)) {
            const targetLoc = scope.locationsById.get(options.locationId);
            if (
                !targetLoc ||
                (targetLoc.type !== LocationType.WAREHOUSE && targetLoc.type !== LocationType.STORE)
            ) {
                throw new ForbiddenException('Ehhez a helyhez nincs hozzáférésed');
            }
        }

        const q = options?.search?.trim();
        const include = {
            location: true,
            variant: {
                include: {
                    product: true,
                    variantBarcodes: {
                        orderBy: [{ isPrimary: 'desc' as const }, { createdAt: 'asc' as const }],
                    },
                },
            },
        };

        if (scope.isUnbound) {
            const locationWhere = options?.locationId
                ? this.buildSubtreeLocationWhere(options.locationId)
                : {};
            const where = {
                location: locationWhere,
                ...(options?.variantId ? { variantId: options.variantId } : {}),
                ...(options?.productId ? { variant: { productId: options.productId } } : {}),
                ...(q ? { OR: this.buildSearchClauses(q) } : {}),
            };
            const [rawItems, total] = await this.prisma.$transaction([
                this.prisma.stockItem.findMany({
                    where,
                    include,
                    ...(options?.skip !== undefined ? { skip: options.skip } : {}),
                    ...(options?.take !== undefined ? { take: options.take } : {}),
                    orderBy: { updatedAt: 'desc' },
                }),
                this.prisma.stockItem.count({ where }),
            ]);
            const scoped = this.locationAccesService.scopeStockItems(rawItems, scope, (root) => root);
            return { items: this.applyCostPriceVisibility(scoped, user), total };
        }

        const accessibleIdList = Array.from(scope.accessibleIds);
        const andClauses: Array<Record<string, unknown>> = [];
        if (options?.locationId) {
            andClauses.push({ location: this.buildSubtreeLocationWhere(options.locationId) });
        }
        andClauses.push(
            accessibleIdList.length > 0
                ? { OR: [{ locationId: { in: accessibleIdList } }, { quantity: { gt: 0 } }] }
                : { quantity: { gt: 0 } },
        );

        if (q) {
            const qLower = q.toLowerCase();
            const matchingAssignedIds = accessibleIdList.filter((id) =>
                scope.locationsById.get(id)?.name.toLowerCase().includes(qLower),
            );
            const matchingExternalRootIds = Array.from(scope.locationsById.values())
                .filter(
                    (loc) =>
                        (loc.type === LocationType.WAREHOUSE || loc.type === LocationType.STORE) &&
                        loc.name.toLowerCase().includes(qLower),
                )
                .map((loc) => loc.id);

            andClauses.push({
                OR: [
                    ...this.buildVariantSearchClauses(q),
                    ...(matchingAssignedIds.length > 0
                        ? [{ locationId: { in: matchingAssignedIds } }]
                        : []),
                    ...matchingExternalRootIds.map((rootId) => ({
                        location: this.buildSubtreeLocationWhere(rootId),
                    })),
                ],
            });
        }

        const rawItems = await this.prisma.stockItem.findMany({
            where: {
                ...(options?.variantId ? { variantId: options.variantId } : {}),
                ...(options?.productId ? { variant: { productId: options.productId } } : {}),
                AND: andClauses,
            },
            include,
            orderBy: { updatedAt: 'desc' },
        });

        let scoped = this.locationAccesService.scopeStockItems(rawItems, scope, (root) => root);
        if (q) {
            const qLower = q.toLowerCase();
            scoped = scoped.filter((item) => this.matchesStockSearch(item, qLower));
        }
        scoped.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

        const total = scoped.length;
        const skip = options?.skip ?? 0;
        const paged =
            options?.take !== undefined ? scoped.slice(skip, skip + options.take) : scoped.slice(skip);

        return { items: this.applyCostPriceVisibility(paged, user), total };
    }

    async findMovements(user: AuthUser, options?: FindMovementsOptions) {
        if (options?.locationId) {
            await this.locationAccesService.assertCanAccess(user, options.locationId);
        }
        const locationWhere = options?.locationId
            ? this.buildSubtreeLocationWhere(options.locationId)
            : await this.locationAccesService.accessibleWhere(user);
        const q = options?.search?.trim();
        const take = options?.take ?? 100;
        const where = {
            location: locationWhere,
            ...(options?.variantId ? { variantId: options.variantId } : {}),
            ...(options?.productId ? { variant: { productId: options.productId } } : {}),
            ...(options?.type ? { type: options.type } : {}),
            ...(q
                ? {
                      OR: [
                          { note: { contains: q, mode: 'insensitive' as const } },
                          { location: { name: { contains: q, mode: 'insensitive' as const } } },
                          { variant: { sku: { contains: q, mode: 'insensitive' as const } } },
                          { variant: { product: { name: { contains: q, mode: 'insensitive' as const } } } },
                          { variant: { product: { manufacturerCode: { contains: q, mode: 'insensitive' as const } } } },
                      ],
                  }
                : {}),
        };
        const [rawMovements, total] = await this.prisma.$transaction([
            this.prisma.stockMovement.findMany({
                where,
                include: {
                    location: true,
                    variant: { include: { product: true } },
                    createdByUser: { select: { id: true, name: true, email: true, role: true } },
                },
                ...(options?.skip !== undefined ? { skip: options.skip } : {}),
                take,
                orderBy: { createdAt: 'desc' },
            }),
            this.prisma.stockMovement.count({ where }),
        ]);
        const items = canSeeCostPrice(user.role)
            ? rawMovements
            : rawMovements.map((movement) => ({
                  ...movement,
                  variant: excludeCostPrice(movement.variant),
              }));
        return { items, total };
    }

    async adjustStock(dto: AdjustStockDto, user: AuthUser){
        await this.locationAccesService.assertCanAccess(user, dto.locationId);

        const location = await this.prisma.location.findUnique({
            where: { id: dto.locationId},
        });
        if(!location) {
            throw new BadRequestException('A megadott lokáció nem található');
        }
        if( !location.isActive){
            throw new BadRequestException('Inaktív lokációra nem lehet készletet mozgatni');
        }

        const variant = await this.prisma.variant.findUnique({
            where: { id: dto.variantId},
            select: { id: true, isActive: true},
        });
        if(!variant){
            throw new NotFoundException('A megadott variáns nem található');
        }

        return this.prisma.$transaction(async (tx) => {
            if(location.slotMode === SlotMode.DEDICATED && dto.quantityChange > 0) {
                const otherStock = await tx.stockItem.findFirst({
                    where: {
                        locationId: dto.locationId,
                        variantId: { not: dto.variantId},
                        quantity: { gt: 0}
                    },
                });
                if(otherStock){
                    throw new ConflictException('Ez egy DEDICATED (dedikált) tárolóhely, amelyen már található másik termékvariáns',);
                }
            }

            const existing = await tx.stockItem.findUnique({
                where: {
                    variantId_locationId: {
                        variantId: dto.variantId,
                        locationId: dto.locationId
                    }
                }
            });

            const currentQty = existing?.quantity ?? 0;
            const newQty = currentQty + dto.quantityChange;

            if (newQty < 0) {
                throw new BadRequestException(`Nincs elegendő készlet a megadott helyen (jelenlegi: ${currentQty} db, módosítás: ${dto.quantityChange} db)`,);
            }

            const stockItem = await tx.stockItem.upsert({
                where: {
                    variantId_locationId: {
                        variantId: dto.variantId,
                        locationId: dto.locationId,
                    },
                },
                create: {
                    variantId: dto.variantId,
                    locationId: dto.locationId,
                    quantity: newQty
                },
                update: {
                    quantity: newQty,
                }
            });

            const movement = await tx.stockMovement.create({
                data: {
                    type: dto.type,
                    variantId: dto.variantId,
                    locationId: dto.locationId,
                    quantity: dto.quantityChange,
                    note: dto.note,
                    createdByUserId: user.userId,
                },
            });

            return {stockItem, movement};
        });
    }


    private buildVariantSearchClauses(q: string) {
        return [
            { variant: { sku: { contains: q, mode: 'insensitive' as const } } },
            { variant: { size: { contains: q, mode: 'insensitive' as const } } },
            { variant: { product: { name: { contains: q, mode: 'insensitive' as const } } } },
            { variant: { product: { manufacturerCode: { contains: q, mode: 'insensitive' as const } } } },
            {
                variant: {
                    variantBarcodes: {
                        some: { barcode: { contains: q, mode: 'insensitive' as const } },
                    },
                },
            },
        ];
    }

    private buildSearchClauses(q: string) {
        return [
            { location: { name: { contains: q, mode: 'insensitive' as const } } },
            ...this.buildVariantSearchClauses(q),
        ];
    }

    private matchesStockSearch(
        item: {
            location: { name: string };
            variant: {
                sku: string;
                size: string;
                product: { name: string; manufacturerCode: string };
                variantBarcodes: Array<{ barcode: string }>;
            };
        },
        qLower: string,
    ): boolean {
        return (
            item.location.name.toLowerCase().includes(qLower) ||
            item.variant.sku.toLowerCase().includes(qLower) ||
            item.variant.size.toLowerCase().includes(qLower) ||
            item.variant.product.name.toLowerCase().includes(qLower) ||
            item.variant.product.manufacturerCode.toLowerCase().includes(qLower) ||
            item.variant.variantBarcodes.some((b) => b.barcode.toLowerCase().includes(qLower))
        );
    }

    private applyCostPriceVisibility<T extends { variant: { costPrice?: unknown } }>(
        items: T[],
        user: AuthUser,
    ) {
        if (canSeeCostPrice(user.role)) {
            return items;
        }
        return items.map((item) => ({
            ...item,
            variant: excludeCostPrice(item.variant),
        }));
    }

    private buildSubtreeLocationWhere(locationId: string) {
        return {
            OR: [
                { id: locationId },
                { parentId: locationId },
                { parent: { parentId: locationId } },
                { parent: { parent: { parentId: locationId } } },
            ],
        };
    }
}