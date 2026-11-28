import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { AuthUser } from '../auth/decorators/current-user.decorator';
import {
    buildVariantBarcodeOrClauses,
    buildVariantSkuOrClauses,
    buildVariantSupplierSkuOrClauses,
} from '../common/barcode-search';
import {
    canSeeCostPrice,
    excludeCostPrice,
    excludeUnitCostHuf,
} from '../common/cost-price';
import {
    acquireSiteVariantLocks,
    getClusterVariantAvailability,
    getSiteVariantAvailability,
    resolveClusterInfo,
} from '../common/sales-reservation';
import { Prisma } from '../generated/prisma/client';
import {
    LocationType,
    MovementType,
    PickTaskStatus,
    Role,
    SalesChannel,
    SalesOrderStatus,
    SlotMode,
} from '../generated/prisma/enums';
import { LocationAccessService } from '../location/location-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { CompleteSalesOrderDto } from './dto/complete-sales-order.dto';
import { CreateSalesOrderDto, CreateSalesOrderItemDto } from './dto/create-sales-order.dto';
import { ReassignSalesOrderLocationDto } from './dto/reassign-sales-order-location.dto';
import { RequestSalesOrderTransferDto } from './dto/request-sales-order-transfer.dto';
import { UpdateSalesOrderDto } from './dto/update-sales-order.dto';
import { PickTaskService } from './pick-task.service';

export interface FindSalesOrdersOptions {
    skip?: number;
    take?: number;
    status?: SalesOrderStatus;
    channel?: SalesChannel;
    sourceLocationId?: string;
    onlyProblems?: boolean;
    search?: string;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HU_COLLATOR = new Intl.Collator('hu', { numeric: true, sensitivity: 'base' });

const SITE_LOCATION_TYPES: readonly LocationType[] = [
    LocationType.WAREHOUSE,
    LocationType.STORE,
];

const MANAGER_ROLES: readonly Role[] = [
    Role.BOSS,
    Role.ADMIN,
    Role.WAREHOUSE_MANAGER,
    Role.STORE_MANAGER,
];

@Injectable()
export class SalesOrderService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly locationAccessService: LocationAccessService,
        private readonly pickTaskService: PickTaskService,
    ) {}

    async findAll(user: AuthUser, options?: FindSalesOrdersOptions) {
        if (options?.sourceLocationId) {
            this.assertValidUuid(options.sourceLocationId, 'sourceLocationId');
            await this.locationAccessService.assertCanAccess(user, options.sourceLocationId);
        }

        const locationWhere = options?.sourceLocationId
            ? this.buildSubtreeLocationWhere(options.sourceLocationId)
            : await this.locationAccessService.accessibleWhere(user);

        const q = options?.search?.trim();
        const skip =
            options?.skip !== undefined && !Number.isNaN(options.skip)
                ? Math.max(0, options.skip)
                : 0;
        const take =
            options?.take !== undefined && !Number.isNaN(options.take)
                ? Math.min(200, Math.max(1, options.take))
                : 50;

        const andClauses: Prisma.SalesOrderWhereInput[] = [];
        if (options?.sourceLocationId) {
            andClauses.push({
                OR: [
                    { sourceLocation: locationWhere },
                    { pickTasks: { some: { dropoffLocation: locationWhere } } },
                ],
            });
        }
        if (options?.status) {
            andClauses.push({ status: options.status });
        }
        if (options?.onlyProblems) {
            andClauses.push({ status: SalesOrderStatus.ON_HOLD });
        }

        const where: Prisma.SalesOrderWhereInput = {
            ...(!options?.sourceLocationId ? { sourceLocation: locationWhere } : {}),
            ...(options?.channel ? { channel: options.channel } : {}),
            ...(andClauses.length > 0 ? { AND: andClauses } : {}),
            ...(q
                ? {
                      OR: [
                          { orderNumber: { contains: q, mode: 'insensitive' } },
                          { externalOrderRef: { contains: q, mode: 'insensitive' } },
                          { customerName: { contains: q, mode: 'insensitive' } },
                          { customerEmail: { contains: q, mode: 'insensitive' } },
                          { customerPhone: { contains: q, mode: 'insensitive' } },
                          { note: { contains: q, mode: 'insensitive' } },
                          {
                              items: {
                                  some: {
                                      OR: [
                                          ...buildVariantSkuOrClauses(q).map((clause) => ({
                                              variant: clause,
                                          })),
                                          ...buildVariantBarcodeOrClauses(q).map((clause) => ({
                                              variant: clause,
                                          })),
                                          ...buildVariantSupplierSkuOrClauses(q).map((clause) => ({
                                              variant: clause,
                                          })),
                                          {
                                              variant: {
                                                  product: {
                                                      name: { contains: q, mode: 'insensitive' },
                                                  },
                                              },
                                          },
                                          {
                                              variant: {
                                                  product: {
                                                      manufacturerCode: {
                                                          contains: q,
                                                          mode: 'insensitive',
                                                      },
                                                  },
                                              },
                                          },
                                      ],
                                  },
                              },
                          },
                      ],
                  }
                : {}),
        };

        const [rawItems, total, onHoldCount] = await this.prisma.$transaction([
            this.prisma.salesOrder.findMany({
                where,
                include: this.listInclude,
                skip,
                take,
                orderBy: { createdAt: 'desc' },
            }),
            this.prisma.salesOrder.count({ where }),
            this.prisma.salesOrder.count({
                where: {
                    sourceLocation: locationWhere,
                    status: SalesOrderStatus.ON_HOLD,
                },
            }),
        ]);

        const items = rawItems.map((order) => this.sanitizeOrder(order, user));
        return { items, total, onHoldCount };
    }

    private async getOrderClusterSiteIdsInTx(
        tx: Prisma.TransactionClient,
        sourceLocationId: string,
        isPickup: boolean,
    ): Promise<string[]> {
        if (!isPickup) {
            const cluster = await resolveClusterInfo(tx, sourceLocationId);
            if (cluster.hubId === sourceLocationId && cluster.siteIds.length > 1) {
                return cluster.siteIds;
            }
        }
        return [sourceLocationId];
    }

    private async getEffectiveOrderAvailabilityInTx(
        tx: Prisma.TransactionClient,
        sourceLocationId: string,
        isPickup: boolean,
        variantIds: string[],
    ) {
        if (!isPickup) {
            const cluster = await resolveClusterInfo(tx, sourceLocationId);
            if (cluster.hubId === sourceLocationId && cluster.siteIds.length > 1) {
                return getClusterVariantAvailability(tx, cluster.hubId, variantIds);
            }
        }
        return getSiteVariantAvailability(tx, sourceLocationId, variantIds);
    }

    private rankFulfillmentSites<
        T extends {
            locationId: string;
            locationName: string;
            locationType: LocationType;
            canFulfillWebshop: boolean;
            fulfillmentPriority: number;
            coveredQty: number;
            missingQty: number;
            totalOrderedQty: number;
            canFulfillAll: boolean;
            localCoveredQty?: number;
            clusterMemberNames?: string[];
        },
    >(sites: T[]): { ranked: T[]; winner: T | null; recommendationReason: string | null } {
        const eligible = sites.filter((site) => site.canFulfillWebshop);
        const pool = eligible.length > 0 ? [...eligible] : [...sites];
        if (pool.length === 0) {
            return { ranked: [], winner: null, recommendationReason: null };
        }

        pool.sort((a, b) => {
            if (a.canFulfillAll !== b.canFulfillAll) return a.canFulfillAll ? -1 : 1;
            if (a.missingQty !== b.missingQty) return a.missingQty - b.missingQty;
            if (a.fulfillmentPriority !== b.fulfillmentPriority) {
                return a.fulfillmentPriority - b.fulfillmentPriority;
            }
            const typeRankA = a.locationType === LocationType.WAREHOUSE ? 0 : 1;
            const typeRankB = b.locationType === LocationType.WAREHOUSE ? 0 : 1;
            if (typeRankA !== typeRankB) return typeRankA - typeRankB;
            return HU_COLLATOR.compare(a.locationName, b.locationName);
        });

        const winner = pool[0]!;
        const usedNeighbor =
            typeof winner.localCoveredQty === 'number' &&
            winner.coveredQty > winner.localCoveredQty &&
            (winner.clusterMemberNames?.length ?? 0) > 0;
        const clusterLabel = usedNeighbor
            ? `Közös körzet (${winner.locationName} + ${winner.clusterMemberNames!.join(', ')}): `
            : '';

        let recommendationReason: string;
        if (winner.canFulfillAll) {
            recommendationReason = `${clusterLabel}Teljes készlet elérhető (${winner.coveredQty}/${winner.totalOrderedQty} db, #${winner.fulfillmentPriority} prioritás)`;
        } else if (winner.coveredQty > 0) {
            recommendationReason = `${clusterLabel}Legkevesebb árumozgatás: ${winner.coveredQty}/${winner.totalOrderedQty} db helyben, ${winner.missingQty} db átkérés szükséges`;
        } else {
            recommendationReason =
                'Nincs szabad készlet a hálózatban — elsődleges telephelyre irányítva (ON_HOLD)';
        }

        return { ranked: pool, winner, recommendationReason };
    }

    /**
     * Hálózat szintű telephelyi (WAREHOUSE/STORE) szabad készlet lekérdezése
     * ON_HOLD átirányításhoz és rendelésrögzítéshez (költségár mezők nélkül!).
     */
    async getAvailability(rawVariantIds?: string, rawQuantities?: string) {
        const variantIds = Array.from(
            new Set(
                (rawVariantIds ?? '')
                    .split(',')
                    .map((s) => s.trim())
                    .filter((s) => s.length > 0),
            ),
        );

        if (variantIds.length === 0) {
            throw new BadRequestException('Legalább egy variantId megadása kötelező');
        }

        for (const variantId of variantIds) {
            this.assertValidUuid(variantId, 'variantIds');
        }

        const requiredByVariant = new Map<string, number>();
        for (const variantId of variantIds) {
            requiredByVariant.set(variantId, 1);
        }

        if (rawQuantities?.trim()) {
            for (const entry of rawQuantities.split(',')) {
                const trimmed = entry.trim();
                if (!trimmed) continue;
                const [vId, qtyStr] = trimmed.split(':');
                const parsedQty = Number.parseInt(qtyStr ?? '', 10);
                if (
                    vId &&
                    UUID_REGEX.test(vId.trim()) &&
                    !Number.isNaN(parsedQty) &&
                    parsedQty >= 1
                ) {
                    requiredByVariant.set(vId.trim(), parsedQty);
                }
            }
        }

        const totalOrderedQty = variantIds.reduce(
            (sum, variantId) => sum + (requiredByVariant.get(variantId) ?? 1),
            0,
        );

        const sites = await this.prisma.location.findMany({
            where: {
                isActive: true,
                type: { in: [...SITE_LOCATION_TYPES] },
            },
            select: {
                id: true,
                name: true,
                type: true,
                canFulfillWebshop: true,
                fulfillmentPriority: true,
                dispatchHubLocationId: true,
            },
            orderBy: [{ fulfillmentPriority: 'asc' }, { type: 'asc' }, { name: 'asc' }],
        });

        const satellitesByHubId = new Map<string, string[]>();
        for (const site of sites) {
            if (site.dispatchHubLocationId) {
                const list = satellitesByHubId.get(site.dispatchHubLocationId) ?? [];
                list.push(site.name);
                satellitesByHubId.set(site.dispatchHubLocationId, list);
            }
        }

        const prismaTx = this.prisma as unknown as Prisma.TransactionClient;

        const siteAvailabilities = await Promise.all(
            sites.map(async (site) => {
                const map = await getSiteVariantAvailability(prismaTx, site.id, variantIds);

                let coveredQty = 0;
                const variants = variantIds.map((variantId) => {
                    const avail = map.get(variantId) ?? {
                        siteLocationId: site.id,
                        variantId,
                        totalQty: 0,
                        reservedQty: 0,
                        availableQty: 0,
                    };
                    const reqQty = requiredByVariant.get(variantId) ?? 1;
                    coveredQty += Math.min(reqQty, Math.max(0, avail.availableQty));
                    return {
                        locationId: site.id,
                        locationName: site.name,
                        locationType: site.type,
                        variantId,
                        totalQty: avail.totalQty,
                        reservedQty: avail.reservedQty,
                        availableQty: avail.availableQty,
                    };
                });

                const missingQty = Math.max(0, totalOrderedQty - coveredQty);
                const canFulfillAll = missingQty === 0;
                const clusterMemberNames = satellitesByHubId.get(site.id) ?? [];

                let clusterCoveredQty = coveredQty;
                let clusterMissingQty = missingQty;
                let clusterCanFulfillAll = canFulfillAll;

                if (clusterMemberNames.length > 0 && site.dispatchHubLocationId === null) {
                    const clusterMap = await getClusterVariantAvailability(
                        prismaTx,
                        site.id,
                        variantIds,
                    );
                    let sumCluster = 0;
                    for (const variantId of variantIds) {
                        const reqQty = requiredByVariant.get(variantId) ?? 1;
                        const availQty = Math.max(
                            0,
                            clusterMap.get(variantId)?.availableQty ?? 0,
                        );
                        sumCluster += Math.min(reqQty, availQty);
                    }
                    clusterCoveredQty = sumCluster;
                    clusterMissingQty = Math.max(0, totalOrderedQty - sumCluster);
                    clusterCanFulfillAll = clusterMissingQty === 0;
                }

                return {
                    locationId: site.id,
                    locationName: site.name,
                    locationType: site.type,
                    canFulfillWebshop: site.canFulfillWebshop,
                    fulfillmentPriority: site.fulfillmentPriority,
                    dispatchHubLocationId: site.dispatchHubLocationId,
                    clusterMemberNames,
                    coveredQty,
                    missingQty,
                    totalOrderedQty,
                    canFulfillAll,
                    clusterCoveredQty,
                    clusterMissingQty,
                    clusterCanFulfillAll,
                    variants,
                };
            }),
        );

        const topLevelEligible = siteAvailabilities.filter(
            (site) => site.canFulfillWebshop && site.dispatchHubLocationId === null,
        );
        const eligiblePool =
            topLevelEligible.length > 0
                ? topLevelEligible
                : siteAvailabilities.filter((site) => site.canFulfillWebshop);

        const routing =
            eligiblePool.length > 0
                ? this.rankFulfillmentSites(
                      eligiblePool.map((site) => ({
                          ...site,
                          localCoveredQty: site.coveredQty,
                          coveredQty: site.clusterCoveredQty,
                          missingQty: site.clusterMissingQty,
                          canFulfillAll: site.clusterCanFulfillAll,
                      })),
                  )
                : { winner: null, recommendationReason: null };

        const flatItems = siteAvailabilities.flatMap((site) =>
            site.variants.map((v) => ({
                ...v,
                canFulfillAll: site.canFulfillAll,
            })),
        );

        return {
            variantIds,
            totalOrderedQty,
            recommendedLocationId: routing.winner?.locationId ?? null,
            recommendationReason: routing.recommendationReason,
            locations: siteAvailabilities,
            items: flatItems,
        };
    }

    /**
     * KIZÁRÓLAG COST_PRICE_ROLES számára!
     * Variáns COMPLETED eladási előzményei + havi statisztikái számított árréssel (marginHuf, marginPercent).
     */
    async getVariantHistory(
        variantId: string,
        user: AuthUser,
        options?: { skip?: number; take?: number },
    ) {
        if (!canSeeCostPrice(user.role)) {
            throw new ForbiddenException(
                'Az eladási előzmények és árrés adatok megtekintéséhez nincs jogosultságod',
            );
        }

        const variant = await this.prisma.variant.findUnique({
            where: { id: variantId },
            include: {
                product: true,
                variantBarcodes: {
                    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
                },
            },
        });
        if (!variant) {
            throw new NotFoundException('A megadott termékvariáns nem található');
        }

        const locationWhere = await this.locationAccessService.accessibleWhere(user);
        const skip =
            options?.skip !== undefined && !Number.isNaN(options.skip)
                ? Math.max(0, options.skip)
                : 0;
        const take =
            options?.take !== undefined && !Number.isNaN(options.take)
                ? Math.min(200, Math.max(1, options.take))
                : 50;

        const itemWhere: Prisma.SalesOrderItemWhereInput = {
            variantId,
            salesOrder: {
                status: SalesOrderStatus.COMPLETED,
                sourceLocation: locationWhere,
            },
        };

        const [rawItems, total, rawStats] = await this.prisma.$transaction([
            this.prisma.salesOrderItem.findMany({
                where: itemWhere,
                include: {
                    salesOrder: {
                        select: {
                            id: true,
                            orderNumber: true,
                            externalOrderRef: true,
                            channel: true,
                            status: true,
                            customerName: true,
                            sourceLocationId: true,
                            sourceLocation: {
                                select: { id: true, name: true, type: true },
                            },
                            completedAt: true,
                            completedByUser: {
                                select: { id: true, name: true, email: true, role: true },
                            },
                            createdAt: true,
                        },
                    },
                },
                skip,
                take,
                orderBy: [{ salesOrder: { completedAt: 'desc' } }, { createdAt: 'desc' }],
            }),
            this.prisma.salesOrderItem.count({ where: itemWhere }),
            this.prisma.variantMonthlyStat.findMany({
                where: { variantId },
                orderBy: [{ year: 'desc' }, { month: 'desc' }],
            }),
        ]);

        const items = rawItems.map((item) => {
            const qty = item.pickedQuantity > 0 ? item.pickedQuantity : item.orderedQuantity;
            const unitNet = Number(item.unitNetPrice);
            const unitGross = Number(item.unitGrossPrice);
            return {
                ...item,
                lineNetTotalHuf: this.round2(qty * unitNet),
                lineGrossTotalHuf: this.round2(qty * unitGross),
            };
        });

        let totalSoldQty = 0;
        let totalSoldRevenueHuf = 0;
        let totalSoldCogsHuf = 0;

        const monthlyStats = rawStats.map((stat) => {
            const soldRevenueHuf = this.round2(Number(stat.soldRevenueHuf));
            const soldCogsHuf = this.round2(Number(stat.soldCogsHuf));
            const marginHuf = this.round2(soldRevenueHuf - soldCogsHuf);
            const marginPercent =
                soldRevenueHuf > 0 ? this.round2((marginHuf / soldRevenueHuf) * 100) : null;

            totalSoldQty += stat.soldQty;
            totalSoldRevenueHuf = this.round2(totalSoldRevenueHuf + soldRevenueHuf);
            totalSoldCogsHuf = this.round2(totalSoldCogsHuf + soldCogsHuf);

            return {
                ...stat,
                soldRevenueHuf,
                soldCogsHuf,
                marginHuf,
                marginPercent,
            };
        });

        const totalMarginHuf = this.round2(totalSoldRevenueHuf - totalSoldCogsHuf);
        const totalMarginPercent =
            totalSoldRevenueHuf > 0
                ? this.round2((totalMarginHuf / totalSoldRevenueHuf) * 100)
                : null;

        return {
            variant,
            items,
            total,
            monthlyStats,
            summary: {
                totalSoldQty,
                totalSoldRevenueHuf,
                totalSoldCogsHuf,
                totalMarginHuf,
                totalMarginPercent,
            },
        };
    }

    async findOne(id: string, user: AuthUser) {
        const order = await this.prisma.salesOrder.findUnique({
            where: { id },
            include: this.detailInclude,
        });

        if (!order) {
            throw new NotFoundException('A keresett vevői rendelés nem található');
        }

        await this.locationAccessService.assertCanAccess(user, order.sourceLocationId);
        return this.sanitizeOrder(order, user);
    }

    async create(dto: CreateSalesOrderDto, user: AuthUser) {
        const isPickup = dto.isPickup === true;
        if (isPickup && !dto.sourceLocationId) {
            throw new BadRequestException(
                'Személyes bolti átvételnél a telephely (sourceLocationId) megadása kötelező',
            );
        }

        const variantMap = await this.validateAndLoadOrderItemVariants(dto.items);
        const variantIds = Array.from(variantMap.keys());

        let candidateSites: Array<{
            id: string;
            name: string;
            type: LocationType;
            canFulfillWebshop: boolean;
            fulfillmentPriority: number;
        }> = [];

        if (dto.sourceLocationId) {
            await this.locationAccessService.assertCanAccess(user, dto.sourceLocationId);
            await this.validateActiveSiteLocation(dto.sourceLocationId, 'forrás telephely');
        } else {
            const scope = await this.locationAccessService.getScopeContext(user);
            const allWebshopSites = await this.prisma.location.findMany({
                where: {
                    isActive: true,
                    canFulfillWebshop: true,
                    type: { in: [...SITE_LOCATION_TYPES] },
                    ...(!scope.isUnbound
                        ? { id: { in: Array.from(scope.accessibleIds) } }
                        : {}),
                },
                select: {
                    id: true,
                    name: true,
                    type: true,
                    canFulfillWebshop: true,
                    fulfillmentPriority: true,
                    dispatchHubLocationId: true,
                },
                orderBy: [{ fulfillmentPriority: 'asc' }, { type: 'asc' }, { name: 'asc' }],
            });

            const topLevelHubs = allWebshopSites.filter(
                (site) => site.dispatchHubLocationId === null,
            );
            candidateSites = topLevelHubs.length > 0 ? topLevelHubs : allWebshopSites;

            if (candidateSites.length === 0) {
                throw new BadRequestException(
                    'Nincs elérhető, webshop-teljesítésre engedélyezett telephely',
                );
            }
        }

        const totalOrderedQty = dto.items.reduce((sum, i) => sum + i.orderedQuantity, 0);

        const createdOrderId = await this.prisma.$transaction(async (tx) => {
            const siteIdsToLock = dto.sourceLocationId
                ? await this.getOrderClusterSiteIdsInTx(tx, dto.sourceLocationId, isPickup)
                : Array.from(
                      new Set(
                          (
                              await Promise.all(
                                  candidateSites.map((s) => resolveClusterInfo(tx, s.id)),
                              )
                          ).flatMap((cluster) => cluster.siteIds),
                      ),
                  );

            await acquireSiteVariantLocks(
                tx,
                siteIdsToLock.flatMap((siteLocationId) =>
                    variantIds.map((variantId) => ({
                        siteLocationId,
                        variantId,
                    })),
                ),
            );

            let resolvedSourceLocationId = dto.sourceLocationId ?? '';
            let availabilityMap: Awaited<ReturnType<typeof getSiteVariantAvailability>>;
            const availabilityMapBySite = new Map<
                string,
                Awaited<ReturnType<typeof getSiteVariantAvailability>>
            >();

            if (dto.sourceLocationId) {
                resolvedSourceLocationId = dto.sourceLocationId;
                availabilityMap = await this.getEffectiveOrderAvailabilityInTx(
                    tx,
                    resolvedSourceLocationId,
                    isPickup,
                    variantIds,
                );
            } else {
                const evaluated = await Promise.all(
                    candidateSites.map(async (site) => {
                        const map = await getClusterVariantAvailability(tx, site.id, variantIds);
                        availabilityMapBySite.set(site.id, map);
                        let coveredQty = 0;
                        for (const item of dto.items) {
                            const availQty = Math.max(
                                0,
                                map.get(item.variantId)?.availableQty ?? 0,
                            );
                            coveredQty += Math.min(item.orderedQuantity, availQty);
                        }
                        const missingQty = Math.max(0, totalOrderedQty - coveredQty);
                        return {
                            locationId: site.id,
                            locationName: site.name,
                            locationType: site.type,
                            canFulfillWebshop: site.canFulfillWebshop,
                            fulfillmentPriority: site.fulfillmentPriority,
                            coveredQty,
                            missingQty,
                            totalOrderedQty,
                            canFulfillAll: missingQty === 0,
                        };
                    }),
                );

                const routing = this.rankFulfillmentSites(evaluated);
                if (!routing.winner) {
                    throw new BadRequestException(
                        'Nem sikerült telephelyet kijelölni a rendelés teljesítéséhez',
                    );
                }
                resolvedSourceLocationId = routing.winner.locationId;
                availabilityMap = availabilityMapBySite.get(resolvedSourceLocationId)!;
            }

            const shortages: Array<{ variantId: string; sku: string; missing: number }> = [];
            const preparedItems = dto.items.map((inputItem) => {
                const variant = variantMap.get(inputItem.variantId)!;
                const pricing = this.resolveItemPricing(inputItem, variant);
                const avail = Math.max(
                    0,
                    availabilityMap.get(inputItem.variantId)?.availableQty ?? 0,
                );
                const reservedQuantity = Math.min(inputItem.orderedQuantity, avail);
                const missing = inputItem.orderedQuantity - reservedQuantity;
                if (missing > 0) {
                    shortages.push({
                        variantId: inputItem.variantId,
                        sku: variant.sku,
                        missing,
                    });
                }

                return {
                    variantId: inputItem.variantId,
                    variant,
                    orderedQuantity: inputItem.orderedQuantity,
                    reservedQuantity,
                    unitNetPrice: pricing.unitNetPrice,
                    unitGrossPrice: pricing.unitGrossPrice,
                    vatRate: pricing.vatRate,
                    discountPercent: pricing.discountPercent,
                    note: inputItem.note?.trim() || null,
                };
            });

            const allFullyReserved = preparedItems.every(
                (item) => item.reservedQuantity === item.orderedQuantity,
            );
            const orderNumber = await this.generateUniqueOrderNumberInTx(tx);
            const now = new Date();

            if (allFullyReserved && dto.instantComplete === true) {
                const created = await tx.salesOrder.create({
                    data: {
                        orderNumber,
                        externalOrderRef: dto.externalOrderRef?.trim() || null,
                        channel: dto.channel ?? SalesChannel.STORE,
                        isPickup,
                        status: SalesOrderStatus.COMPLETED,
                        sourceLocationId: resolvedSourceLocationId,
                        customerName: dto.customerName.trim(),
                        customerEmail: dto.customerEmail?.trim() || null,
                        customerPhone: dto.customerPhone?.trim() || null,
                        shippingAddress: dto.shippingAddress?.trim() || null,
                        note: dto.note?.trim() || null,
                        createdByUserId: user.userId,
                        completedByUserId: user.userId,
                        completedAt: now,
                        items: {
                            create: preparedItems.map((item) => ({
                                variantId: item.variantId,
                                orderedQuantity: item.orderedQuantity,
                                reservedQuantity: 0,
                                pickedQuantity: item.orderedQuantity,
                                unitNetPrice: item.unitNetPrice,
                                unitGrossPrice: item.unitGrossPrice,
                                vatRate: item.vatRate,
                                discountPercent: item.discountPercent,
                                note: item.note,
                            })),
                        },
                    },
                    select: { id: true },
                });

                await this.deductItemsDirectlyFromSiteShelvesInTx(
                    tx,
                    created.id,
                    orderNumber,
                    resolvedSourceLocationId,
                    preparedItems.map((item) => ({
                        variantId: item.variantId,
                        sku: item.variant.sku,
                        productId: item.variant.productId,
                        costPrice: Number(item.variant.costPrice),
                        unitNetPrice: item.unitNetPrice,
                        quantity: item.orderedQuantity,
                    })),
                    user.userId,
                    `Azonnali bolti kiadás (${orderNumber})`,
                );

                await this.updateMonthlyStatsFromOrderSaleMovementsInTx(tx, created.id, now);
                return created.id;
            }

            if (allFullyReserved) {
                const created = await tx.salesOrder.create({
                    data: {
                        orderNumber,
                        externalOrderRef: dto.externalOrderRef?.trim() || null,
                        channel: dto.channel ?? SalesChannel.WEBSHOP,
                        isPickup,
                        status: SalesOrderStatus.PENDING,
                        sourceLocationId: resolvedSourceLocationId,
                        customerName: dto.customerName.trim(),
                        customerEmail: dto.customerEmail?.trim() || null,
                        customerPhone: dto.customerPhone?.trim() || null,
                        shippingAddress: dto.shippingAddress?.trim() || null,
                        note: dto.note?.trim() || null,
                        createdByUserId: user.userId,
                        items: {
                            create: preparedItems.map((item) => ({
                                variantId: item.variantId,
                                orderedQuantity: item.orderedQuantity,
                                reservedQuantity: item.orderedQuantity,
                                pickedQuantity: 0,
                                unitNetPrice: item.unitNetPrice,
                                unitGrossPrice: item.unitGrossPrice,
                                vatRate: item.vatRate,
                                discountPercent: item.discountPercent,
                                note: item.note,
                            })),
                        },
                    },
                    select: { id: true },
                });

                await this.pickTaskService.generatePickTasksInTx(tx, created.id);
                return created.id;
            }

            let holdReason = this.formatShortageHoldReason(shortages);
            if (availabilityMapBySite.size > 1 && shortages.length > 0) {
                let bestBackupSite: { name: string; coveredMissing: number } | null = null;
                for (const site of candidateSites) {
                    if (site.id === resolvedSourceLocationId) continue;
                    const siteMap = availabilityMapBySite.get(site.id);
                    if (!siteMap) continue;
                    let coveredMissing = 0;
                    for (const s of shortages) {
                        const availQty = Math.max(0, siteMap.get(s.variantId)?.availableQty ?? 0);
                        coveredMissing += Math.min(s.missing, availQty);
                    }
                    if (
                        coveredMissing > 0 &&
                        (!bestBackupSite || coveredMissing > bestBackupSite.coveredMissing)
                    ) {
                        bestBackupSite = { name: site.name, coveredMissing };
                    }
                }
                if (bestBackupSite) {
                    holdReason = `${holdReason} · Pótolható innen: ${bestBackupSite.name}`;
                }
            }

            const created = await tx.salesOrder.create({
                data: {
                    orderNumber,
                    externalOrderRef: dto.externalOrderRef?.trim() || null,
                    channel: dto.channel ?? SalesChannel.WEBSHOP,
                    isPickup,
                    status: SalesOrderStatus.ON_HOLD,
                    sourceLocationId: resolvedSourceLocationId,
                    holdReason,
                    customerName: dto.customerName.trim(),
                    customerEmail: dto.customerEmail?.trim() || null,
                    customerPhone: dto.customerPhone?.trim() || null,
                    shippingAddress: dto.shippingAddress?.trim() || null,
                    note: dto.note?.trim() || null,
                    createdByUserId: user.userId,
                    items: {
                        create: preparedItems.map((item) => ({
                            variantId: item.variantId,
                            orderedQuantity: item.orderedQuantity,
                            reservedQuantity: item.reservedQuantity,
                            pickedQuantity: 0,
                            unitNetPrice: item.unitNetPrice,
                            unitGrossPrice: item.unitGrossPrice,
                            vatRate: item.vatRate,
                            discountPercent: item.discountPercent,
                            note: item.note,
                        })),
                    },
                },
                select: { id: true },
            });

            return created.id;
        });

        return this.findOne(createdOrderId, user);
    }

    async update(id: string, dto: UpdateSalesOrderDto, user: AuthUser) {
        const existing = await this.prisma.salesOrder.findUnique({
            where: { id },
            include: { items: true, pickTasks: true },
        });
        if (!existing) {
            throw new NotFoundException('A keresett vevői rendelés nem található');
        }

        await this.locationAccessService.assertCanAccess(user, existing.sourceLocationId);

        if (
            existing.status !== SalesOrderStatus.ON_HOLD &&
            existing.status !== SalesOrderStatus.PENDING
        ) {
            throw new BadRequestException(
                `Rendelés csak ON_HOLD vagy PENDING státuszban módosítható (jelenlegi: ${existing.status})`,
            );
        }

        if (existing.items.some((item) => item.pickedQuantity > 0)) {
            throw new BadRequestException(
                'Olyan rendelés, amelyből már történt kiszedés (pickedQuantity > 0), nem szerkeszthető',
            );
        }

        const metadataPatch: Prisma.SalesOrderUncheckedUpdateInput = {
            ...(dto.channel !== undefined ? { channel: dto.channel } : {}),
            ...(dto.isPickup !== undefined ? { isPickup: dto.isPickup } : {}),
            ...(dto.externalOrderRef !== undefined
                ? { externalOrderRef: dto.externalOrderRef.trim() || null }
                : {}),
            ...(dto.customerName !== undefined
                ? { customerName: dto.customerName.trim() }
                : {}),
            ...(dto.customerEmail !== undefined
                ? { customerEmail: dto.customerEmail.trim() || null }
                : {}),
            ...(dto.customerPhone !== undefined
                ? { customerPhone: dto.customerPhone.trim() || null }
                : {}),
            ...(dto.shippingAddress !== undefined
                ? { shippingAddress: dto.shippingAddress.trim() || null }
                : {}),
            ...(dto.note !== undefined ? { note: dto.note.trim() || null } : {}),
            ...(dto.holdReason !== undefined
                ? { holdReason: dto.holdReason.trim() || null }
                : {}),
        };

        if (dto.customerName !== undefined && !dto.customerName.trim()) {
            throw new BadRequestException('A vevő neve nem lehet üres');
        }

        if (!dto.items) {
            await this.prisma.salesOrder.update({
                where: { id },
                data: metadataPatch,
            });
            return this.findOne(id, user);
        }

        const variantMap = await this.validateAndLoadOrderItemVariants(dto.items);
        const newVariantIds = Array.from(variantMap.keys());

        await this.prisma.$transaction(async (tx) => {
            const current = await tx.salesOrder.findUnique({
                where: { id },
                include: { items: true, pickTasks: true },
            });
            if (!current) {
                throw new NotFoundException('A keresett vevői rendelés nem található');
            }
            if (
                current.status !== SalesOrderStatus.ON_HOLD &&
                current.status !== SalesOrderStatus.PENDING
            ) {
                throw new ConflictException(
                    `A rendelés időközben ${current.status} státuszba került, nem módosítható`,
                );
            }
            if (current.items.some((item) => item.pickedQuantity > 0)) {
                throw new ConflictException(
                    'A rendelésből időközben megkezdődött a kiszedés, a tételek nem módosíthatók',
                );
            }
            const hasActiveNonOpenTask = current.pickTasks.some(
                (t) =>
                    t.status === PickTaskStatus.IN_PROGRESS ||
                    t.status === PickTaskStatus.AWAITING_DROP ||
                    t.status === PickTaskStatus.COMPLETED,
            );
            if (hasActiveNonOpenTask) {
                throw new ConflictException(
                    'A rendeléshez már folyamatban lévő vagy lezárt kiszedési feladat tartozik',
                );
            }

            const lockVariantIds = Array.from(
                new Set([...current.items.map((i) => i.variantId), ...newVariantIds]),
            );
            const nextIsPickup =
                dto.isPickup !== undefined ? dto.isPickup : current.isPickup;
            const lockSiteIds = await this.getOrderClusterSiteIdsInTx(
                tx,
                current.sourceLocationId,
                nextIsPickup,
            );
            await acquireSiteVariantLocks(
                tx,
                lockSiteIds.flatMap((siteLocationId) =>
                    lockVariantIds.map((variantId) => ({
                        siteLocationId,
                        variantId,
                    })),
                ),
            );

            await tx.pickTask.deleteMany({
                where: {
                    salesOrderId: id,
                    status: PickTaskStatus.OPEN,
                },
            });

            await tx.salesOrderItem.deleteMany({
                where: { salesOrderId: id },
            });

            const availabilityMap = await this.getEffectiveOrderAvailabilityInTx(
                tx,
                current.sourceLocationId,
                nextIsPickup,
                newVariantIds,
            );

            const shortages: Array<{ sku: string; missing: number }> = [];
            const preparedItems = dto.items!.map((inputItem) => {
                const variant = variantMap.get(inputItem.variantId)!;
                const pricing = this.resolveItemPricing(inputItem, variant);
                const avail = Math.max(
                    0,
                    availabilityMap.get(inputItem.variantId)?.availableQty ?? 0,
                );
                const reservedQuantity = Math.min(inputItem.orderedQuantity, avail);
                const missing = inputItem.orderedQuantity - reservedQuantity;
                if (missing > 0) {
                    shortages.push({ sku: variant.sku, missing });
                }

                return {
                    salesOrderId: id,
                    variantId: inputItem.variantId,
                    orderedQuantity: inputItem.orderedQuantity,
                    reservedQuantity,
                    pickedQuantity: 0,
                    unitNetPrice: pricing.unitNetPrice,
                    unitGrossPrice: pricing.unitGrossPrice,
                    vatRate: pricing.vatRate,
                    discountPercent: pricing.discountPercent,
                    note: inputItem.note?.trim() || null,
                };
            });

            await tx.salesOrderItem.createMany({
                data: preparedItems,
            });

            const allFullyReserved = preparedItems.every(
                (item) => item.reservedQuantity === item.orderedQuantity,
            );

            if (allFullyReserved) {
                await tx.salesOrder.update({
                    where: { id },
                    data: {
                        ...metadataPatch,
                        status: SalesOrderStatus.PENDING,
                        holdReason: null,
                        transferRequestedFromLocationId: null,
                    },
                });
                await this.pickTaskService.generatePickTasksInTx(tx, id);
            } else {
                await tx.salesOrder.update({
                    where: { id },
                    data: {
                        ...metadataPatch,
                        status: SalesOrderStatus.ON_HOLD,
                        holdReason:
                            dto.holdReason?.trim() || this.formatShortageHoldReason(shortages),
                    },
                });
            }
        });

        return this.findOne(id, user);
    }

    async reassignLocation(
        id: string,
        dto: ReassignSalesOrderLocationDto,
        user: AuthUser,
    ) {
        const existing = await this.prisma.salesOrder.findUnique({
            where: { id },
            include: { items: true, pickTasks: true },
        });
        if (!existing) {
            throw new NotFoundException('A keresett vevői rendelés nem található');
        }

        await this.locationAccessService.assertCanAccess(user, existing.sourceLocationId);
        await this.validateActiveSiteLocation(dto.sourceLocationId, 'új forrás telephely');

        if (dto.sourceLocationId === existing.sourceLocationId) {
            throw new BadRequestException(
                'Az új forrás telephely megegyezik a rendelés jelenlegi telephelyével',
            );
        }

        if (
            existing.status !== SalesOrderStatus.ON_HOLD &&
            existing.status !== SalesOrderStatus.PENDING
        ) {
            throw new BadRequestException(
                `Telephely átirányítás csak ON_HOLD vagy PENDING státuszban engedélyezett (jelenlegi: ${existing.status})`,
            );
        }

        if (existing.items.some((item) => item.pickedQuantity > 0)) {
            throw new BadRequestException(
                'Már kiszedett tételeket tartalmazó rendelés telephelye nem módosítható',
            );
        }

        await this.prisma.$transaction(async (tx) => {
            const current = await tx.salesOrder.findUnique({
                where: { id },
                include: {
                    items: {
                        include: { variant: { select: { id: true, sku: true } } },
                    },
                    pickTasks: true,
                },
            });
            if (!current) {
                throw new NotFoundException('A keresett vevői rendelés nem található');
            }
            if (
                current.status !== SalesOrderStatus.ON_HOLD &&
                current.status !== SalesOrderStatus.PENDING
            ) {
                throw new ConflictException(
                    `A rendelés időközben ${current.status} státuszba került`,
                );
            }
            if (current.items.some((item) => item.pickedQuantity > 0)) {
                throw new ConflictException(
                    'A rendelésből időközben megkezdődött a kiszedés, nem irányítható át',
                );
            }
            const hasActiveNonOpenTask = current.pickTasks.some(
                (t) =>
                    t.status === PickTaskStatus.IN_PROGRESS ||
                    t.status === PickTaskStatus.AWAITING_DROP ||
                    t.status === PickTaskStatus.COMPLETED,
            );
            if (hasActiveNonOpenTask) {
                throw new ConflictException(
                    'A rendeléshez már folyamatban lévő vagy lezárt kiszedési feladat tartozik',
                );
            }

            const variantIds = current.items.map((item) => item.variantId);
            const oldClusterIds = await this.getOrderClusterSiteIdsInTx(
                tx,
                current.sourceLocationId,
                current.isPickup,
            );
            const newClusterIds = await this.getOrderClusterSiteIdsInTx(
                tx,
                dto.sourceLocationId,
                current.isPickup,
            );
            const uniqueLockSites = Array.from(new Set([...oldClusterIds, ...newClusterIds]));
            await acquireSiteVariantLocks(
                tx,
                uniqueLockSites.flatMap((siteLocationId) =>
                    variantIds.map((variantId) => ({
                        siteLocationId,
                        variantId,
                    })),
                ),
            );

            await tx.pickTask.deleteMany({
                where: {
                    salesOrderId: id,
                    status: PickTaskStatus.OPEN,
                },
            });

            await tx.salesOrderItem.updateMany({
                where: { salesOrderId: id },
                data: { reservedQuantity: 0 },
            });

            await tx.salesOrder.update({
                where: { id },
                data: {
                    sourceLocationId: dto.sourceLocationId,
                    transferRequestedFromLocationId: null,
                },
            });

            const availabilityMap = await this.getEffectiveOrderAvailabilityInTx(
                tx,
                dto.sourceLocationId,
                current.isPickup,
                variantIds,
            );

            const shortages: Array<{ sku: string; missing: number }> = [];
            let allFullyReserved = true;

            for (const item of current.items) {
                const avail = Math.max(
                    0,
                    availabilityMap.get(item.variantId)?.availableQty ?? 0,
                );
                const reservedQuantity = Math.min(item.orderedQuantity, avail);
                const missing = item.orderedQuantity - reservedQuantity;
                if (missing > 0) {
                    allFullyReserved = false;
                    shortages.push({ sku: item.variant.sku, missing });
                }

                await tx.salesOrderItem.update({
                    where: { id: item.id },
                    data: { reservedQuantity },
                });
            }

            const notePatch = dto.note?.trim()
                ? current.note
                    ? `${current.note}\n${dto.note.trim()}`
                    : dto.note.trim()
                : current.note;

            if (allFullyReserved) {
                await tx.salesOrder.update({
                    where: { id },
                    data: {
                        status: SalesOrderStatus.PENDING,
                        holdReason: null,
                        note: notePatch,
                    },
                });
                await this.pickTaskService.generatePickTasksInTx(tx, id);
            } else {
                await tx.salesOrder.update({
                    where: { id },
                    data: {
                        status: SalesOrderStatus.ON_HOLD,
                        holdReason: this.formatShortageHoldReason(shortages),
                        note: notePatch,
                    },
                });
            }
        });

        const updated = await this.prisma.salesOrder.findUnique({
            where: { id },
            include: this.detailInclude,
        });
        if (!updated) {
            throw new NotFoundException('A keresett vevői rendelés nem található');
        }
        return this.sanitizeOrder(updated, user);
    }

    async requestTransfer(
        id: string,
        dto: RequestSalesOrderTransferDto,
        user: AuthUser,
    ) {
        const existing = await this.prisma.salesOrder.findUnique({
            where: { id },
        });
        if (!existing) {
            throw new NotFoundException('A keresett vevői rendelés nem található');
        }

        await this.locationAccessService.assertCanAccess(user, existing.sourceLocationId);

        if (existing.status !== SalesOrderStatus.ON_HOLD) {
            throw new BadRequestException(
                `Átkérés csak ON_HOLD státuszú rendeléshez rögzíthető (jelenlegi: ${existing.status})`,
            );
        }

        if (dto.transferRequestedFromLocationId === existing.sourceLocationId) {
            throw new BadRequestException(
                'Az átkérés forrás telephelye nem egyezhet meg a rendelés saját telephelyével',
            );
        }

        await this.validateActiveSiteLocation(
            dto.transferRequestedFromLocationId,
            'átkérés forrás telephely',
        );

        await this.prisma.salesOrder.update({
            where: { id },
            data: {
                transferRequestedFromLocationId: dto.transferRequestedFromLocationId,
                ...(dto.holdReason !== undefined
                    ? { holdReason: dto.holdReason.trim() || existing.holdReason }
                    : {}),
                ...(dto.note !== undefined ? { note: dto.note.trim() || null } : {}),
            },
        });

        return this.findOne(id, user);
    }

    async recheckStock(id: string, user: AuthUser) {
        const existing = await this.prisma.salesOrder.findUnique({
            where: { id },
            select: { id: true, sourceLocationId: true, status: true },
        });
        if (!existing) {
            throw new NotFoundException('A keresett vevői rendelés nem található');
        }

        await this.locationAccessService.assertCanAccess(user, existing.sourceLocationId);

        if (existing.status !== SalesOrderStatus.ON_HOLD) {
            throw new BadRequestException(
                `Készlet újraellenőrzése csak ON_HOLD státuszú rendelésnél indítható (jelenlegi: ${existing.status})`,
            );
        }

        await this.prisma.$transaction(async (tx) => {
            const current = await tx.salesOrder.findUnique({
                where: { id },
                include: {
                    items: {
                        include: { variant: { select: { id: true, sku: true } } },
                    },
                    pickTasks: {
                        where: { status: { not: PickTaskStatus.CANCELLED } },
                        include: { items: true },
                    },
                },
            });

            if (!current) {
                throw new NotFoundException('A keresett vevői rendelés nem található');
            }
            if (current.status !== SalesOrderStatus.ON_HOLD) {
                throw new ConflictException(
                    `A rendelés időközben ${current.status} státuszba került`,
                );
            }

            const variantIds = current.items.map((i) => i.variantId);
            const lockSiteIds = await this.getOrderClusterSiteIdsInTx(
                tx,
                current.sourceLocationId,
                current.isPickup,
            );
            await acquireSiteVariantLocks(
                tx,
                lockSiteIds.flatMap((siteLocationId) =>
                    variantIds.map((variantId) => ({
                        siteLocationId,
                        variantId,
                    })),
                ),
            );

            const availabilityMap = await this.getEffectiveOrderAvailabilityInTx(
                tx,
                current.sourceLocationId,
                current.isPickup,
                variantIds,
            );

            const shortages: Array<{ sku: string; missing: number }> = [];
            let allFullyCovered = true;

            for (const item of current.items) {
                const remainingNeeded = Math.max(0, item.orderedQuantity - item.pickedQuantity);
                const avail = availabilityMap.get(item.variantId);
                const availableExcludingSelf = Math.max(
                    0,
                    (avail?.availableQty ?? 0) + item.reservedQuantity,
                );
                const nextReserved = Math.min(remainingNeeded, availableExcludingSelf);
                const missing = remainingNeeded - nextReserved;

                if (missing > 0) {
                    allFullyCovered = false;
                    shortages.push({ sku: item.variant.sku, missing });
                }

                if (nextReserved !== item.reservedQuantity) {
                    await tx.salesOrderItem.update({
                        where: { id: item.id },
                        data: { reservedQuantity: nextReserved },
                    });
                }
            }

            if (!allFullyCovered) {
                await tx.salesOrder.update({
                    where: { id },
                    data: {
                        holdReason: this.formatShortageHoldReason(shortages),
                    },
                });
                return;
            }

            const anyPicked = current.items.some((item) => item.pickedQuantity > 0);
            const allPicked =
                current.items.length > 0 &&
                current.items.every((item) => item.pickedQuantity === item.orderedQuantity);

            if (allPicked && current.pickTasks.every((t) => t.status === PickTaskStatus.COMPLETED)) {
                await tx.salesOrder.update({
                    where: { id },
                    data: {
                        status: SalesOrderStatus.READY,
                        holdReason: null,
                        transferRequestedFromLocationId: null,
                    },
                });
                return;
            }

            if (!anyPicked) {
                const hasNonOpenTask = current.pickTasks.some(
                    (t) => t.status !== PickTaskStatus.OPEN,
                );
                if (!hasNonOpenTask) {
                    await tx.pickTask.deleteMany({
                        where: {
                            salesOrderId: id,
                            status: PickTaskStatus.OPEN,
                        },
                    });
                    await tx.salesOrder.update({
                        where: { id },
                        data: {
                            status: SalesOrderStatus.PENDING,
                            holdReason: null,
                            transferRequestedFromLocationId: null,
                        },
                    });
                    await this.pickTaskService.generatePickTasksInTx(tx, id);
                    return;
                }
            }

            await this.pickTaskService.generatePickTasksInTx(tx, id);

            const refreshedTasks = await tx.pickTask.findMany({
                where: {
                    salesOrderId: id,
                    status: { not: PickTaskStatus.CANCELLED },
                },
                select: { status: true },
            });

            const anyStarted =
                anyPicked ||
                refreshedTasks.some(
                    (t) =>
                        t.status === PickTaskStatus.IN_PROGRESS ||
                        t.status === PickTaskStatus.AWAITING_DROP ||
                        t.status === PickTaskStatus.COMPLETED,
                );

            await tx.salesOrder.update({
                where: { id },
                data: {
                    status: anyStarted ? SalesOrderStatus.PICKING : SalesOrderStatus.PENDING,
                    holdReason: null,
                    transferRequestedFromLocationId: null,
                },
            });
        });

        return this.findOne(id, user);
    }

    async complete(id: string, dto: CompleteSalesOrderDto, user: AuthUser) {
        const existing = await this.prisma.salesOrder.findUnique({
            where: { id },
            select: { id: true, sourceLocationId: true, status: true },
        });
        if (!existing) {
            throw new NotFoundException('A keresett vevői rendelés nem található');
        }

        await this.locationAccessService.assertCanAccess(user, existing.sourceLocationId);

        if (
            existing.status === SalesOrderStatus.COMPLETED ||
            existing.status === SalesOrderStatus.CANCELLED
        ) {
            throw new BadRequestException(
                `A rendelés már ${existing.status} státuszban van`,
            );
        }

        await this.prisma.$transaction(async (tx) => {
            const current = await tx.salesOrder.findUnique({
                where: { id },
                include: {
                    items: {
                        include: {
                            variant: {
                                select: {
                                    id: true,
                                    sku: true,
                                    productId: true,
                                    costPrice: true,
                                },
                            },
                        },
                    },
                    pickTasks: {
                        where: { status: { not: PickTaskStatus.CANCELLED } },
                    },
                },
            });

            if (!current) {
                throw new NotFoundException('A keresett vevői rendelés nem található');
            }
            if (
                current.status === SalesOrderStatus.COMPLETED ||
                current.status === SalesOrderStatus.CANCELLED
            ) {
                throw new ConflictException(`A rendelés már ${current.status} státuszban van`);
            }
            if (current.status === SalesOrderStatus.ON_HOLD) {
                throw new BadRequestException(
                    'ON_HOLD státuszú rendelés nem zárható le; először oldd fel a készlethiányt',
                );
            }

            const allItemsPicked =
                current.items.length > 0 &&
                current.items.every((item) => item.pickedQuantity === item.orderedQuantity);

            const canCompleteDirectly =
                current.status === SalesOrderStatus.READY || allItemsPicked;

            if (!canCompleteDirectly) {
                if (dto?.instantFromShelf !== true || current.status !== SalesOrderStatus.PENDING) {
                    throw new BadRequestException(
                        'A rendelés csak READY státuszban (vagy minden tétel kiszedése után, illetve PENDING státuszban instantFromShelf: true opcióval) zárható le',
                    );
                }

                const hasStartedPickTask = current.pickTasks.some(
                    (t) =>
                        t.status === PickTaskStatus.IN_PROGRESS ||
                        t.status === PickTaskStatus.AWAITING_DROP,
                );
                if (hasStartedPickTask) {
                    throw new ConflictException(
                        'Folyamatban lévő kiszedési feladat mellett nem használható az 1-lépéses polci kiadás',
                    );
                }

                const remainingItems = current.items
                    .map((item) => ({
                        orderItemId: item.id,
                        variantId: item.variantId,
                        sku: item.variant.sku,
                        productId: item.variant.productId,
                        costPrice: Number(item.variant.costPrice),
                        unitNetPrice: Number(item.unitNetPrice),
                        orderedQuantity: item.orderedQuantity,
                        quantity: item.orderedQuantity - item.pickedQuantity,
                    }))
                    .filter((item) => item.quantity > 0);

                await acquireSiteVariantLocks(
                    tx,
                    remainingItems.map((item) => ({
                        siteLocationId: current.sourceLocationId,
                        variantId: item.variantId,
                    })),
                );

                await this.deductItemsDirectlyFromSiteShelvesInTx(
                    tx,
                    current.id,
                    current.orderNumber,
                    current.sourceLocationId,
                    remainingItems,
                    user.userId,
                    `Bolti 1-lépéses kiadás (${current.orderNumber})`,
                );

                for (const item of remainingItems) {
                    await tx.salesOrderItem.update({
                        where: { id: item.orderItemId },
                        data: {
                            pickedQuantity: item.orderedQuantity,
                            reservedQuantity: 0,
                        },
                    });
                }

                await tx.pickTask.updateMany({
                    where: {
                        salesOrderId: id,
                        status: PickTaskStatus.OPEN,
                    },
                    data: {
                        status: PickTaskStatus.CANCELLED,
                    },
                });
            }

            const completedAt = new Date();
            const updated = await tx.salesOrder.updateMany({
                where: {
                    id,
                    status: {
                        in: [
                            SalesOrderStatus.READY,
                            SalesOrderStatus.PICKING,
                            SalesOrderStatus.PENDING,
                        ],
                    },
                },
                data: {
                    status: SalesOrderStatus.COMPLETED,
                    completedByUserId: user.userId,
                    completedAt,
                    ...(dto?.note !== undefined
                        ? { note: dto.note.trim() || current.note }
                        : {}),
                },
            });

            if (updated.count !== 1) {
                throw new ConflictException(
                    'A rendelés időközben már lezárásra vagy módosításra került',
                );
            }

            await tx.salesOrderItem.updateMany({
                where: { salesOrderId: id },
                data: { reservedQuantity: 0 },
            });

            await this.updateMonthlyStatsFromOrderSaleMovementsInTx(tx, id, completedAt);
        });

        return this.findOne(id, user);
    }

    async cancel(id: string, user: AuthUser) {
        const existing = await this.prisma.salesOrder.findUnique({
            where: { id },
            include: { items: true },
        });
        if (!existing) {
            throw new NotFoundException('A keresett vevői rendelés nem található');
        }

        await this.locationAccessService.assertCanAccess(user, existing.sourceLocationId);

        if (
            existing.status === SalesOrderStatus.COMPLETED ||
            existing.status === SalesOrderStatus.CANCELLED
        ) {
            throw new BadRequestException(
                `A rendelés már ${existing.status} státuszban van, nem mondható le`,
            );
        }

        const hasPickedItems = existing.items.some((item) => item.pickedQuantity > 0);
        if (hasPickedItems && !MANAGER_ROLES.includes(user.role)) {
            throw new ForbiddenException(
                'Már kiszedett tételeket tartalmazó rendelést kizárólag vezető mondhat le',
            );
        }

        await this.prisma.$transaction(async (tx) => {
            const current = await tx.salesOrder.findUnique({
                where: { id },
                include: { items: true },
            });
            if (!current) {
                throw new NotFoundException('A keresett vevői rendelés nem található');
            }
            if (
                current.status === SalesOrderStatus.COMPLETED ||
                current.status === SalesOrderStatus.CANCELLED
            ) {
                throw new ConflictException(
                    `A rendelés időközben már ${current.status} státuszba került`,
                );
            }

            const variantIds = current.items.map((item) => item.variantId);
            const lockSiteIds = await this.getOrderClusterSiteIdsInTx(
                tx,
                current.sourceLocationId,
                current.isPickup,
            );
            await acquireSiteVariantLocks(
                tx,
                lockSiteIds.flatMap((siteLocationId) =>
                    variantIds.map((variantId) => ({
                        siteLocationId,
                        variantId,
                    })),
                ),
            );

            const activeSaleMovements = await tx.stockMovement.findMany({
                where: {
                    salesOrderId: id,
                    type: MovementType.SALE,
                    quantity: { lt: 0 },
                    reversedMovementId: null,
                    reversedBy: { is: null },
                },
            });

            if (activeSaleMovements.length > 0 && !MANAGER_ROLES.includes(user.role)) {
                throw new ForbiddenException(
                    'Már kiszedett tételeket tartalmazó rendelést kizárólag vezető mondhat le',
                );
            }

            for (const mv of activeSaleMovements) {
                const restockQty = Math.abs(mv.quantity);
                await tx.stockItem.upsert({
                    where: {
                        variantId_locationId: {
                            variantId: mv.variantId,
                            locationId: mv.locationId,
                        },
                    },
                    create: {
                        variantId: mv.variantId,
                        locationId: mv.locationId,
                        quantity: restockQty,
                    },
                    update: {
                        quantity: { increment: restockQty },
                    },
                });

                await tx.stockMovement.create({
                    data: {
                        type: MovementType.SALE,
                        variantId: mv.variantId,
                        locationId: mv.locationId,
                        quantity: restockQty,
                        salesOrderId: id,
                        pickTaskId: mv.pickTaskId,
                        unitCostHuf: mv.unitCostHuf,
                        unitPriceHuf: mv.unitPriceHuf,
                        reversedMovementId: mv.id,
                        note: `Rendelés lemondás visszavételezés (${current.orderNumber})`,
                        createdByUserId: user.userId,
                    },
                });
            }

            await tx.salesOrderItem.updateMany({
                where: { salesOrderId: id },
                data: {
                    reservedQuantity: 0,
                    pickedQuantity: 0,
                },
            });

            await tx.pickTask.updateMany({
                where: {
                    salesOrderId: id,
                    status: { not: PickTaskStatus.CANCELLED },
                },
                data: {
                    status: PickTaskStatus.CANCELLED,
                },
            });

            await tx.salesOrder.update({
                where: { id },
                data: {
                    status: SalesOrderStatus.CANCELLED,
                    cancelledAt: new Date(),
                    transferRequestedFromLocationId: null,
                },
            });
        });

        return this.findOne(id, user);
    }

    private async deductItemsDirectlyFromSiteShelvesInTx(
        tx: Prisma.TransactionClient,
        salesOrderId: string,
        orderNumber: string,
        sourceLocationId: string,
        items: Array<{
            variantId: string;
            sku: string;
            productId: string;
            costPrice: number;
            unitNetPrice: number;
            quantity: number;
        }>,
        userId: string,
        note: string,
    ) {
        if (items.length === 0) return;

        const subtreeMap = await this.pickTaskService.loadSubtreeLocations(tx, sourceLocationId);
        const subtreeIds = Array.from(subtreeMap.keys());
        const variantIds = Array.from(new Set(items.map((i) => i.variantId)));

        const stockRows = await tx.stockItem.findMany({
            where: {
                locationId: { in: subtreeIds },
                variantId: { in: variantIds },
                quantity: { gt: 0 },
            },
            select: {
                locationId: true,
                variantId: true,
                quantity: true,
            },
        });

        for (const item of items) {
            const candidateShelves = stockRows
                .filter((row) => row.variantId === item.variantId && row.quantity > 0)
                .map((row) => {
                    const node = subtreeMap.get(row.locationId);
                    const path = node
                        ? this.pickTaskService.buildLocationPathFromSubtree(
                              node.id,
                              sourceLocationId,
                              subtreeMap,
                          )
                        : '';
                    return {
                        locationId: row.locationId,
                        quantity: row.quantity,
                        isActive: node?.isActive ?? false,
                        slotMode: node?.slotMode ?? null,
                        path,
                    };
                })
                .sort((a, b) => {
                    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
                    const aDed = a.slotMode === SlotMode.DEDICATED ? 1 : 0;
                    const bDed = b.slotMode === SlotMode.DEDICATED ? 1 : 0;
                    if (aDed !== bDed) return bDed - aDed;
                    if (a.quantity !== b.quantity) return b.quantity - a.quantity;
                    return HU_COLLATOR.compare(a.path, b.path);
                });

            let remaining = item.quantity;
            for (const shelf of candidateShelves) {
                if (remaining <= 0) break;
                const take = Math.min(remaining, shelf.quantity);
                if (take <= 0) continue;

                await tx.stockItem.update({
                    where: {
                        variantId_locationId: {
                            variantId: item.variantId,
                            locationId: shelf.locationId,
                        },
                    },
                    data: {
                        quantity: { decrement: take },
                    },
                });

                await tx.stockMovement.create({
                    data: {
                        type: MovementType.SALE,
                        variantId: item.variantId,
                        locationId: shelf.locationId,
                        quantity: -take,
                        salesOrderId,
                        unitPriceHuf: item.unitNetPrice,
                        unitCostHuf: item.costPrice,
                        note: note || `Eladás (${orderNumber})`,
                        createdByUserId: userId,
                    },
                });

                remaining -= take;
            }

            if (remaining > 0) {
                throw new ConflictException(
                    `Nincs elegendő fizikai polckészlet az azonnali kiadáshoz (${item.sku}, hiány: ${remaining} db)`,
                );
            }
        }
    }

    /**
     * VariantMonthlyStat frissítése KIZÁRÓLAG rendelés COMPLETED zárásakor,
     * a nem-sztornózott negatív SALE StockMovement rekordok alapján.
     */
    private async updateMonthlyStatsFromOrderSaleMovementsInTx(
        tx: Prisma.TransactionClient,
        salesOrderId: string,
        completedAt: Date,
    ) {
        const [activeSaleMovements, orderItems] = await Promise.all([
            tx.stockMovement.findMany({
                where: {
                    salesOrderId,
                    type: MovementType.SALE,
                    quantity: { lt: 0 },
                    reversedMovementId: null,
                    reversedBy: { is: null },
                },
                include: {
                    variant: {
                        select: { id: true, productId: true, costPrice: true },
                    },
                },
            }),
            tx.salesOrderItem.findMany({
                where: { salesOrderId },
                select: { variantId: true, unitNetPrice: true },
            }),
        ]);

        const itemNetPriceByVariant = new Map(
            orderItems.map((item) => [item.variantId, Number(item.unitNetPrice)]),
        );

        const aggByVariant = new Map<
            string,
            {
                productId: string;
                soldQty: number;
                soldRevenueHuf: number;
                soldCogsHuf: number;
            }
        >();

        for (const mv of activeSaleMovements) {
            const qty = Math.abs(mv.quantity);
            if (qty <= 0) continue;

            const unitPrice =
                mv.unitPriceHuf !== null
                    ? Number(mv.unitPriceHuf)
                    : (itemNetPriceByVariant.get(mv.variantId) ?? 0);
            const unitCost =
                mv.unitCostHuf !== null
                    ? Number(mv.unitCostHuf)
                    : Number(mv.variant.costPrice);

            const existing = aggByVariant.get(mv.variantId) ?? {
                productId: mv.variant.productId,
                soldQty: 0,
                soldRevenueHuf: 0,
                soldCogsHuf: 0,
            };

            existing.soldQty += qty;
            existing.soldRevenueHuf = this.round2(existing.soldRevenueHuf + qty * unitPrice);
            existing.soldCogsHuf = this.round2(existing.soldCogsHuf + qty * unitCost);
            aggByVariant.set(mv.variantId, existing);
        }

        const year = completedAt.getFullYear();
        const month = completedAt.getMonth() + 1;

        for (const [variantId, agg] of aggByVariant.entries()) {
            await tx.variantMonthlyStat.upsert({
                where: {
                    variantId_year_month: {
                        variantId,
                        year,
                        month,
                    },
                },
                create: {
                    variantId,
                    productId: agg.productId,
                    year,
                    month,
                    soldQty: agg.soldQty,
                    soldRevenueHuf: agg.soldRevenueHuf,
                    soldCogsHuf: agg.soldCogsHuf,
                },
                update: {
                    soldQty: { increment: agg.soldQty },
                    soldRevenueHuf: { increment: agg.soldRevenueHuf },
                    soldCogsHuf: { increment: agg.soldCogsHuf },
                },
            });
        }
    }

    private resolveItemPricing(
        inputItem: CreateSalesOrderItemDto,
        variant: {
            netPrice: Prisma.Decimal;
            grossPrice: Prisma.Decimal;
            product: { vatRate: Prisma.Decimal };
        },
    ) {
        const vatRate = this.round2(
            inputItem.vatRate !== undefined ? inputItem.vatRate : Number(variant.product.vatRate),
        );
        const vatMultiplier = 1 + vatRate / 100;
        const discountPercent =
            inputItem.discountPercent !== undefined ? this.round2(inputItem.discountPercent) : null;

        let unitNetPrice: number;
        let unitGrossPrice: number;

        if (inputItem.unitNetPrice === undefined && inputItem.unitGrossPrice === undefined) {
            const baseNet = Number(variant.netPrice);
            const baseGross = Number(variant.grossPrice);
            if (discountPercent !== null && discountPercent > 0) {
                const factor = Math.max(0, 1 - discountPercent / 100);
                unitNetPrice = this.round2(baseNet * factor);
                unitGrossPrice = this.round2(unitNetPrice * vatMultiplier);
            } else {
                unitNetPrice = this.round2(baseNet);
                unitGrossPrice =
                    inputItem.vatRate !== undefined
                        ? this.round2(unitNetPrice * vatMultiplier)
                        : this.round2(baseGross);
            }
        } else if (inputItem.unitNetPrice !== undefined && inputItem.unitGrossPrice === undefined) {
            unitNetPrice = this.round2(inputItem.unitNetPrice);
            unitGrossPrice = this.round2(unitNetPrice * vatMultiplier);
        } else if (inputItem.unitNetPrice === undefined && inputItem.unitGrossPrice !== undefined) {
            unitGrossPrice = this.round2(inputItem.unitGrossPrice);
            unitNetPrice =
                vatMultiplier > 0 ? this.round2(unitGrossPrice / vatMultiplier) : unitGrossPrice;
        } else {
            unitNetPrice = this.round2(inputItem.unitNetPrice!);
            unitGrossPrice = this.round2(inputItem.unitGrossPrice!);
        }

        return {
            unitNetPrice,
            unitGrossPrice,
            vatRate,
            discountPercent,
        };
    }

    private async validateActiveSiteLocation(locationId: string, label: string) {
        const location = await this.prisma.location.findUnique({
            where: { id: locationId },
        });
        if (!location) {
            throw new NotFoundException(`A megadott ${label} nem található`);
        }
        if (!location.isActive) {
            throw new BadRequestException(`Inaktív ${label} nem választható ki`);
        }
        if (!SITE_LOCATION_TYPES.includes(location.type)) {
            throw new BadRequestException(
                `A ${label} kizárólag WAREHOUSE vagy STORE típusú telephely lehet (kapott: ${location.type})`,
            );
        }
        return location;
    }

    private async validateAndLoadOrderItemVariants(items: CreateSalesOrderItemDto[]) {
        if (!items || items.length === 0) {
            throw new BadRequestException('A rendeléshez legalább egy tétel megadása kötelező');
        }

        const seen = new Set<string>();
        for (const item of items) {
            if (seen.has(item.variantId)) {
                throw new BadRequestException(
                    `Duplikált termékvariáns a rendelés tételei között: ${item.variantId}`,
                );
            }
            seen.add(item.variantId);
        }

        const variants = await this.prisma.variant.findMany({
            where: { id: { in: Array.from(seen) } },
            include: {
                product: {
                    select: {
                        id: true,
                        name: true,
                        vatRate: true,
                    },
                },
            },
        });

        if (variants.length !== seen.size) {
            throw new NotFoundException('Egy vagy több megadott termékvariáns nem található');
        }

        return new Map(variants.map((v) => [v.id, v]));
    }

    private async generateUniqueOrderNumberInTx(tx: Prisma.TransactionClient): Promise<string> {
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const datePrefix = `SO-${yyyy}${mm}${dd}-`;

        const lockKey = `so-number-gen:${datePrefix}`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

        const latest = await tx.salesOrder.findFirst({
            where: { orderNumber: { startsWith: datePrefix } },
            orderBy: { orderNumber: 'desc' },
            select: { orderNumber: true },
        });

        let nextSeq = 1;
        if (latest) {
            const suffix = latest.orderNumber.slice(datePrefix.length);
            const parsed = Number.parseInt(suffix, 10);
            if (!Number.isNaN(parsed) && parsed >= 1) {
                nextSeq = parsed + 1;
            }
        }

        for (let attempt = 0; attempt < 100; attempt++) {
            const candidate = `${datePrefix}${String(nextSeq + attempt).padStart(4, '0')}`;
            const exists = await tx.salesOrder.findUnique({
                where: { orderNumber: candidate },
                select: { id: true },
            });
            if (!exists) {
                return candidate;
            }
        }

        const randomSuffix = Math.floor(1000 + Math.random() * 9000);
        return `${datePrefix}${Date.now().toString().slice(-4)}${randomSuffix}`;
    }

    private formatShortageHoldReason(shortages: Array<{ sku: string; missing: number }>): string {
        if (shortages.length === 0) {
            return 'Készlethiány miatt felfüggesztve';
        }
        return `Készlethiány: ${shortages.map((s) => `${s.sku} (-${s.missing} db)`).join(', ')}`;
    }

    private assertValidUuid(value: string, fieldName: string) {
        if (!UUID_REGEX.test(value)) {
            throw new BadRequestException(`Érvénytelen UUID paraméter (${fieldName}): ${value}`);
        }
    }

    private round2(value: number): number {
        return Math.round((value + Number.EPSILON) * 100) / 100;
    }

    private sanitizeMovement<
        T extends {
            unitCostHuf?: unknown;
            variant?: {
                costPrice?: unknown;
                lastPurchasePrice?: unknown;
                costCurrency?: unknown;
                lastPurchaseAt?: unknown;
            };
        },
    >(movement: T, user: AuthUser) {
        if (canSeeCostPrice(user.role)) {
            return movement;
        }
        const withoutUnitCost = excludeUnitCostHuf(movement);
        if (withoutUnitCost.variant) {
            return {
                ...withoutUnitCost,
                variant: excludeCostPrice(withoutUnitCost.variant),
            };
        }
        return withoutUnitCost;
    }

    private sanitizeOrder<
        T extends {
            items?: Array<
                Record<string, unknown> & {
                    variant?: {
                        costPrice?: unknown;
                        lastPurchasePrice?: unknown;
                        costCurrency?: unknown;
                        lastPurchaseAt?: unknown;
                    };
                }
            >;
            pickTasks?: Array<
                Record<string, unknown> & {
                    items?: Array<
                        Record<string, unknown> & {
                            variant?: {
                                costPrice?: unknown;
                                lastPurchasePrice?: unknown;
                                costCurrency?: unknown;
                                lastPurchaseAt?: unknown;
                            };
                        }
                    >;
                }
            >;
            stockMovements?: Array<
                Record<string, unknown> & {
                    unitCostHuf?: unknown;
                    variant?: {
                        costPrice?: unknown;
                        lastPurchasePrice?: unknown;
                        costCurrency?: unknown;
                        lastPurchaseAt?: unknown;
                    };
                }
            >;
        },
    >(order: T, user: AuthUser) {
        if (canSeeCostPrice(user.role)) {
            return order;
        }

        return {
            ...order,
            ...(order.items !== undefined
                ? {
                      items: order.items.map((item) => ({
                          ...item,
                          ...(item.variant ? { variant: excludeCostPrice(item.variant) } : {}),
                      })),
                  }
                : {}),
            ...(order.pickTasks !== undefined
                ? {
                      pickTasks: order.pickTasks.map((task) => ({
                          ...task,
                          ...(task.items !== undefined
                              ? {
                                    items: task.items.map((tItem) => ({
                                        ...tItem,
                                        ...(tItem.variant
                                            ? { variant: excludeCostPrice(tItem.variant) }
                                            : {}),
                                    })),
                                }
                              : {}),
                      })),
                  }
                : {}),
            ...(order.stockMovements !== undefined
                ? {
                      stockMovements: order.stockMovements.map((mv) =>
                          this.sanitizeMovement(mv, user),
                      ),
                  }
                : {}),
        };
    }

    private buildSubtreeLocationWhere(locationId: string): Prisma.LocationWhereInput {
        return {
            OR: [
                { id: locationId },
                { parentId: locationId },
                { parent: { parentId: locationId } },
                { parent: { parent: { parentId: locationId } } },
            ],
        };
    }

    private readonly listInclude = {
        sourceLocation: true,
        transferRequestedFromLocation: true,
        createdByUser: { select: { id: true, name: true, email: true, role: true } },
        completedByUser: { select: { id: true, name: true, email: true, role: true } },
        items: {
            include: {
                variant: {
                    include: {
                        product: true,
                        variantBarcodes: {
                            orderBy: [
                                { isPrimary: 'desc' as const },
                                { createdAt: 'asc' as const },
                            ],
                        },
                    },
                },
            },
            orderBy: { createdAt: 'asc' as const },
        },
        pickTasks: {
            include: {
                zone: true,
                assignedToUser: { select: { id: true, name: true, email: true, role: true } },
                dropoffLocation: true,
                _count: { select: { items: true } },
            },
            orderBy: { createdAt: 'asc' as const },
        },
    } satisfies Prisma.SalesOrderInclude;

    private readonly detailInclude = {
        ...this.listInclude,
        pickTasks: {
            include: {
                zone: true,
                assignedToUser: { select: { id: true, name: true, email: true, role: true } },
                dropoffLocation: true,
                items: {
                    include: {
                        suggestedLocation: true,
                        variant: {
                            include: {
                                product: true,
                                variantBarcodes: {
                                    orderBy: [
                                        { isPrimary: 'desc' as const },
                                        { createdAt: 'asc' as const },
                                    ],
                                },
                            },
                        },
                    },
                    orderBy: { createdAt: 'asc' as const },
                },
            },
            orderBy: { createdAt: 'asc' as const },
        },
        stockMovements: {
            include: {
                location: true,
                variant: { include: { product: true } },
                createdByUser: { select: { id: true, name: true, email: true, role: true } },
                reversedBy: {
                    select: { id: true, createdAt: true, createdByUserId: true },
                },
                reversedMovement: {
                    select: { id: true, createdAt: true, createdByUserId: true },
                },
            },
            orderBy: { createdAt: 'desc' as const },
        },
    } satisfies Prisma.SalesOrderInclude;
}
