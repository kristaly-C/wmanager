import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { LocationAccessService } from "../location/location-access.service";
import { AuthUser } from "../auth/decorators/current-user.decorator";
import { AdjustStockDto } from "./dto/adjust-stock.dto";
import { RelocateStockDto } from "./dto/relocate-stock.dto";
import { UpdateStockSettingsDto } from "./dto/update-stock-settings.dto";
import { CreateStockReportDto } from "./dto/create-stock-report.dto";
import { ResolveStockReportDto } from "./dto/resolve-stock-report.dto";
import { LocationType, SlotMode, MovementType, Role, StockReportStatus } from "../generated/prisma/enums";
import {
    buildVariantBarcodeOrClauses,
    buildVariantSkuOrClauses,
    buildVariantSupplierSkuOrClauses,
    getBarcodeSearchVariants,
} from "../common/barcode-search";
import { canSeeCostPrice, excludeCostPrice, excludeUnitCostHuf } from "../common/cost-price";

const INITIAL_STOCK_SETTING_KEY = 'initialStockEnabled';
const MANAGER_ROLES: readonly Role[] = [
    Role.BOSS,
    Role.ADMIN,
    Role.WAREHOUSE_MANAGER,
    Role.STORE_MANAGER,
];


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
            scoped = scoped.filter((item) => this.matchesStockSearch(item, q));
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
                          ...this.buildVariantSearchClauses(q),
                      ],
                  }
                : {}),
        };
        const [rawMovements, total] = await this.prisma.$transaction([
            this.prisma.stockMovement.findMany({
                where,
                include: {
                    location: true,
                    variant: {
                        include: {
                            product: true,
                            variantBarcodes: {
                                orderBy: [{ isPrimary: 'desc' as const }, { createdAt: 'asc' as const }],
                            },
                        },
                    },
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
                  ...excludeUnitCostHuf(movement),
                  variant: excludeCostPrice(movement.variant),
              }));
        return { items, total };
    }

    async getSettings() {
        const setting = await this.prisma.systemSetting.findUnique({
            where: { key: INITIAL_STOCK_SETTING_KEY },
        });
        return { initialStockEnabled: setting?.boolValue ?? false };
    }

    async updateSettings(dto: UpdateStockSettingsDto) {
        const setting = await this.prisma.systemSetting.upsert({
            where: { key: INITIAL_STOCK_SETTING_KEY },
            create: {
                key: INITIAL_STOCK_SETTING_KEY,
                boolValue: dto.initialStockEnabled,
            },
            update: {
                boolValue: dto.initialStockEnabled,
            },
        });
        return { initialStockEnabled: setting.boolValue };
    }

    async adjustStock(dto: AdjustStockDto, user: AuthUser){
        if (dto.type === MovementType.INITIAL_STOCK) {
            const { initialStockEnabled } = await this.getSettings();
            if (!initialStockEnabled) {
                throw new ForbiddenException(
                    'A kezdeti készletfelvitel (INITIAL_STOCK) jelenleg ki van kapcsolva. A BOSS a Vezérlőpulton engedélyezheti.',
                );
            }
        }

        if (dto.type === MovementType.MANUAL_CORRECTION) {
            if (!MANAGER_ROLES.includes(user.role)) {
                throw new ForbiddenException(
                    'Kézi készletkorrekciót csak vezető végezhet. Használd a Hiány / Eltérés jelentése funkciót!',
                );
            }
            if (!dto.note?.trim()) {
                throw new BadRequestException('Kézi korrekciónál az indoklás (megjegyzés) megadása kötelező');
            }
        }

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
            select: { id: true, productId: true, isActive: true, costPrice: true },
        });
        if(!variant){
            throw new NotFoundException('A megadott variáns nem található');
        }

        const result = await this.prisma.$transaction(async (tx) => {
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
                    unitCostHuf: variant.costPrice,
                    note: dto.note?.trim() || undefined,
                    createdByUserId: user.userId,
                },
            });

            if (
                dto.type === MovementType.MANUAL_CORRECTION ||
                dto.type === MovementType.STOCKTAKE_ADJUSTMENT
            ) {
                const now = new Date();
                const year = now.getFullYear();
                const month = now.getMonth() + 1;
                await tx.variantMonthlyStat.upsert({
                    where: {
                        variantId_year_month: {
                            variantId: variant.id,
                            year,
                            month,
                        },
                    },
                    create: {
                        variantId: variant.id,
                        productId: variant.productId,
                        year,
                        month,
                        adjustmentQty: dto.quantityChange,
                    },
                    update: {
                        adjustmentQty: { increment: dto.quantityChange },
                    },
                });
            }

            return { stockItem, movement };
        });

        return {
            stockItem: result.stockItem,
            movement: canSeeCostPrice(user.role)
                ? result.movement
                : excludeUnitCostHuf(result.movement),
        };
    }

    async relocateStock(dto: RelocateStockDto, user: AuthUser) {
        if (dto.fromLocationId === dto.toLocationId) {
            throw new BadRequestException('A forrás és a cél pozíció nem lehet ugyanaz');
        }

        await this.locationAccesService.assertCanAccess(user, dto.fromLocationId);
        await this.locationAccesService.assertCanAccess(user, dto.toLocationId);

        const [fromLoc, toLoc, variant] = await Promise.all([
            this.prisma.location.findUnique({ where: { id: dto.fromLocationId } }),
            this.prisma.location.findUnique({ where: { id: dto.toLocationId } }),
            this.prisma.variant.findUnique({ where: { id: dto.variantId }, select: { id: true, isActive: true } }),
        ]);

        if (!fromLoc) {
            throw new BadRequestException('A megadott forrás lokáció nem található');
        }
        if (!fromLoc.isActive) {
            throw new BadRequestException('Inaktív forrás lokációról nem lehet készletet áthelyezni');
        }
        if (!toLoc) {
            throw new BadRequestException('A megadott cél lokáció nem található');
        }
        if (!toLoc.isActive) {
            throw new BadRequestException('Inaktív cél lokációra nem lehet készletet áthelyezni');
        }
        if (!variant) {
            throw new NotFoundException('A megadott variáns nem található');
        }

        const movementNote = dto.note?.trim() || `Áthelyezés: ${fromLoc.name} → ${toLoc.name}`;

        return this.prisma.$transaction(async (tx) => {
            const sourceStock = await tx.stockItem.findUnique({
                where: {
                    variantId_locationId: {
                        variantId: dto.variantId,
                        locationId: dto.fromLocationId,
                    },
                },
            });

            const available = (sourceStock?.quantity ?? 0) - (sourceStock?.reservedQuantity ?? 0);
            if (available < dto.quantity) {
                throw new BadRequestException(
                    `Nincs elegendő szabad készlet a forrás pozíción (szabad: ${available} db)`,
                );
            }

            if (toLoc.slotMode === SlotMode.DEDICATED) {
                const otherStock = await tx.stockItem.findFirst({
                    where: {
                        locationId: dto.toLocationId,
                        variantId: { not: dto.variantId },
                        quantity: { gt: 0 },
                    },
                });
                if (otherStock) {
                    throw new ConflictException(
                        'Ez egy DEDICATED (dedikált) tárolóhely, amelyen már található másik termékvariáns',
                    );
                }
            }

            const fromStockItem = await tx.stockItem.update({
                where: {
                    variantId_locationId: {
                        variantId: dto.variantId,
                        locationId: dto.fromLocationId,
                    },
                },
                data: {
                    quantity: { decrement: dto.quantity },
                },
            });

            const toStockItem = await tx.stockItem.upsert({
                where: {
                    variantId_locationId: {
                        variantId: dto.variantId,
                        locationId: dto.toLocationId,
                    },
                },
                create: {
                    variantId: dto.variantId,
                    locationId: dto.toLocationId,
                    quantity: dto.quantity,
                },
                update: {
                    quantity: { increment: dto.quantity },
                },
            });

            const outMovement = await tx.stockMovement.create({
                data: {
                    type: MovementType.TRANSFER_OUT,
                    variantId: dto.variantId,
                    locationId: dto.fromLocationId,
                    quantity: -dto.quantity,
                    note: movementNote,
                    createdByUserId: user.userId,
                },
            });

            const inMovement = await tx.stockMovement.create({
                data: {
                    type: MovementType.TRANSFER_IN,
                    variantId: dto.variantId,
                    locationId: dto.toLocationId,
                    quantity: dto.quantity,
                    note: movementNote,
                    createdByUserId: user.userId,
                },
            });

            return {
                fromStockItem,
                toStockItem,
                movements: canSeeCostPrice(user.role)
                    ? [outMovement, inMovement]
                    : [excludeUnitCostHuf(outMovement), excludeUnitCostHuf(inMovement)],
            };
        });
    }

    async findReports(
        user: AuthUser,
        options?: { status?: StockReportStatus; locationId?: string; search?: string },
    ) {
        if (options?.locationId) {
            await this.locationAccesService.assertCanAccess(user, options.locationId);
        }
        const locationWhere = options?.locationId
            ? this.buildSubtreeLocationWhere(options.locationId)
            : await this.locationAccesService.accessibleWhere(user);

        const q = options?.search?.trim();

        const reports = await this.prisma.stockReport.findMany({
            where: {
                location: locationWhere,
                ...(options?.status ? { status: options.status } : {}),
                ...(q
                    ? {
                          OR: [
                              { reason: { contains: q, mode: 'insensitive' as const } },
                              { location: { name: { contains: q, mode: 'insensitive' as const } } },
                              ...this.buildVariantSearchClauses(q),
                          ],
                      }
                    : {}),
            },
            include: this.reportInclude,
            orderBy: { createdAt: 'desc' },
        });

        return this.applyCostPriceVisibility(reports, user);
    }

    async createReport(dto: CreateStockReportDto, user: AuthUser) {
        await this.locationAccesService.assertCanAccess(user, dto.locationId);

        const reason = dto.reason.trim();
        if (!reason) {
            throw new BadRequestException('Az eltérés okának megadása kötelező');
        }

        const [location, variant, existingStock] = await Promise.all([
            this.prisma.location.findUnique({ where: { id: dto.locationId } }),
            this.prisma.variant.findUnique({ where: { id: dto.variantId }, select: { id: true } }),
            this.prisma.stockItem.findUnique({
                where: {
                    variantId_locationId: {
                        variantId: dto.variantId,
                        locationId: dto.locationId,
                    },
                },
            }),
        ]);

        if (!location) {
            throw new NotFoundException('A megadott lokáció nem található');
        }
        if (!variant) {
            throw new NotFoundException('A megadott variáns nem található');
        }

        const report = await this.prisma.stockReport.create({
            data: {
                variantId: dto.variantId,
                locationId: dto.locationId,
                expectedQuantity: existingStock?.quantity ?? 0,
                foundQuantity: dto.foundQuantity,
                reason,
                status: StockReportStatus.PENDING,
                reportedByUserId: user.userId,
            },
            include: this.reportInclude,
        });

        return this.applyCostPriceVisibility([report], user)[0];
    }

    async resolveReport(id: string, dto: ResolveStockReportDto, user: AuthUser) {
        const existingReport = await this.prisma.stockReport.findUnique({
            where: { id },
        });
        if (!existingReport) {
            throw new NotFoundException('A hiány/eltérés jelentés nem található');
        }
        if (existingReport.status !== StockReportStatus.PENDING) {
            throw new BadRequestException('Ez a jelentés már el lett bírálva');
        }

        await this.locationAccesService.assertCanAccess(user, existingReport.locationId);

        const resolutionNote = dto.resolutionNote?.trim() || null;

        if (dto.action === 'REJECT') {
            const rejected = await this.prisma.stockReport.update({
                where: { id },
                data: {
                    status: StockReportStatus.REJECTED,
                    resolvedByUserId: user.userId,
                    resolvedAt: new Date(),
                    resolutionNote,
                },
                include: this.reportInclude,
            });
            return this.applyCostPriceVisibility([rejected], user)[0];
        }

        const approved = await this.prisma.$transaction(async (tx) => {
            const report = await tx.stockReport.findUnique({ where: { id } });
            if (!report) {
                throw new NotFoundException('A hiány/eltérés jelentés nem található');
            }
            if (report.status !== StockReportStatus.PENDING) {
                throw new BadRequestException('Ez a jelentés már el lett bírálva');
            }

            const existingStock = await tx.stockItem.findUnique({
                where: {
                    variantId_locationId: {
                        variantId: report.variantId,
                        locationId: report.locationId,
                    },
                },
            });

            const currentQty = existingStock?.quantity ?? 0;
            const newQty = report.foundQuantity;
            const clampedReserved = existingStock
                ? Math.min(existingStock.reservedQuantity, newQty)
                : 0;

            await tx.stockItem.upsert({
                where: {
                    variantId_locationId: {
                        variantId: report.variantId,
                        locationId: report.locationId,
                    },
                },
                create: {
                    variantId: report.variantId,
                    locationId: report.locationId,
                    quantity: newQty,
                    reservedQuantity: 0,
                },
                update: {
                    quantity: newQty,
                    reservedQuantity: clampedReserved,
                },
            });

            const delta = newQty - currentQty;
            if (delta !== 0) {
                const variant = await tx.variant.findUnique({
                    where: { id: report.variantId },
                    select: { id: true, productId: true, costPrice: true },
                });
                if (!variant) {
                    throw new NotFoundException('A megadott variáns nem található');
                }
                const now = new Date();
                const year = now.getFullYear();
                const month = now.getMonth() + 1;
                await tx.stockMovement.create({
                    data: {
                        type: MovementType.MANUAL_CORRECTION,
                        variantId: report.variantId,
                        locationId: report.locationId,
                        quantity: delta,
                        unitCostHuf: variant.costPrice,
                        note: `Hiány/eltérés jelentés jóváhagyva: ${report.reason}${resolutionNote ? ' (' + resolutionNote + ')' : ''}`,
                        createdByUserId: user.userId,
                    },
                });
                await tx.variantMonthlyStat.upsert({
                    where: {
                        variantId_year_month: {
                            variantId: variant.id,
                            year,
                            month,
                        },
                    },
                    create: {
                        variantId: variant.id,
                        productId: variant.productId,
                        year,
                        month,
                        adjustmentQty: delta,
                    },
                    update: {
                        adjustmentQty: { increment: delta },
                    },
                });
            }

            return tx.stockReport.update({
                where: { id },
                data: {
                    status: StockReportStatus.APPROVED,
                    resolvedByUserId: user.userId,
                    resolvedAt: new Date(),
                    resolutionNote,
                },
                include: this.reportInclude,
            });
        });

        return this.applyCostPriceVisibility([approved], user)[0];
    }

    private readonly reportInclude = {
        location: true,
        variant: {
            include: {
                product: true,
                variantBarcodes: {
                    orderBy: [{ isPrimary: 'desc' as const }, { createdAt: 'asc' as const }],
                },
            },
        },
        reportedByUser: { select: { id: true, name: true, email: true, role: true } },
        resolvedByUser: { select: { id: true, name: true, email: true, role: true } },
    };


    private buildVariantSearchClauses(q: string) {
        return [
            ...buildVariantSkuOrClauses(q).map((clause) => ({ variant: clause })),
            ...buildVariantBarcodeOrClauses(q).map((clause) => ({ variant: clause })),
            ...buildVariantSupplierSkuOrClauses(q).map((clause) => ({ variant: clause })),
            { variant: { size: { contains: q, mode: 'insensitive' as const } } },
            { variant: { product: { name: { contains: q, mode: 'insensitive' as const } } } },
            { variant: { product: { manufacturerCode: { contains: q, mode: 'insensitive' as const } } } },
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
                size: string | null;
                product: { name: string; manufacturerCode: string | null };
                variantBarcodes: Array<{ barcode: string }>;
            };
        },
        rawQuery: string,
    ): boolean {
        const qLower = rawQuery.toLowerCase();
        const codeCandidates = getBarcodeSearchVariants(rawQuery).map((v) => v.toLowerCase());
        return (
            item.location.name.toLowerCase().includes(qLower) ||
            (item.variant.size ?? '').toLowerCase().includes(qLower) ||
            item.variant.product.name.toLowerCase().includes(qLower) ||
            (item.variant.product.manufacturerCode ?? '').toLowerCase().includes(qLower) ||
            codeCandidates.some(
                (candidate) =>
                    item.variant.sku.toLowerCase().includes(candidate) ||
                    item.variant.variantBarcodes.some((b) =>
                        b.barcode.toLowerCase().includes(candidate),
                    ),
            )
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