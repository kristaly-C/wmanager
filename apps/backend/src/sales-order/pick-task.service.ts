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
    getBarcodeSearchVariants,
} from '../common/barcode-search';
import {
    canSeeCostPrice,
    excludeCostPrice,
    excludeUnitCostHuf,
} from '../common/cost-price';
import { acquireSiteVariantLocks } from '../common/sales-reservation';
import { Prisma } from '../generated/prisma/client';
import {
    LocationType,
    MovementType,
    PickTaskStatus,
    Role,
    SalesOrderStatus,
    SlotMode,
    StockReportStatus,
} from '../generated/prisma/enums';
import { LocationAccessService } from '../location/location-access.service';
import { PrismaService } from '../prisma/prisma.service';
import {
    ClaimPickTaskDto,
    ClaimPickTasksDto,
    UpdatePickTaskToteDto,
} from './dto/claim-pick-tasks.dto';
import { DropoffPickTaskDto } from './dto/dropoff-pick-task.dto';
import { PickItemDto } from './dto/pick-item.dto';
import { ReportPickShortageDto } from './dto/report-pick-shortage.dto';

export interface FindPickTasksOptions {
    sourceLocationId?: string;
    zoneId?: string;
    status?: PickTaskStatus;
    assignedToMe?: boolean;
    salesOrderId?: string;
    search?: string;
    skip?: number;
    take?: number;
}

export interface SubtreeLocationNode {
    id: string;
    parentId: string | null;
    name: string;
    type: LocationType;
    slotMode: SlotMode | null;
    isActive: boolean;
}

export interface AvailableShelfOption {
    locationId: string;
    locationName: string;
    locationPath: string;
    zoneId: string | null;
    zoneName: string | null;
    slotMode: SlotMode | null;
    quantity: number;
    isInTaskZone: boolean;
}

const NO_ZONE_KEY = '__NO_ZONE__';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HU_COLLATOR = new Intl.Collator('hu', { numeric: true, sensitivity: 'base' });

const MANAGER_ROLES: readonly Role[] = [
    Role.BOSS,
    Role.ADMIN,
    Role.WAREHOUSE_MANAGER,
    Role.STORE_MANAGER,
];

const STAFF_SELF_UNDO_ONLY_ROLES: readonly Role[] = [
    Role.WAREHOUSE_STAFF,
    Role.STORE_STAFF,
];

@Injectable()
export class PickTaskService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly locationAccessService: LocationAccessService,
    ) {}

    /**
     * Okos IKEA-módú 2-menetes zónás kiszedési feladat generálás egy SalesOrder-höz.
     * - 1. menet: 1-zónás vagy DEDICATED polccal rendelkező tételek -> kijelölik a rendelés aktív zónáit.
     * - 2. menet: Több MIXED zónában is elérhető tételek -> előnyben részesítik a már aktív zónát,
     *   különben a legnagyobb készletű / természetes sorrendben első zónát; szükség esetén több zónára bont.
     * - Garantálja, hogy minden tételnél sum(PickTaskItem.requiredQuantity) === remaining (orderedQuantity - pickedQuantity).
     */
    async generatePickTasksInTx(tx: Prisma.TransactionClient, salesOrderId: string) {
        const order = await tx.salesOrder.findUnique({
            where: { id: salesOrderId },
            include: {
                items: {
                    orderBy: { createdAt: 'asc' },
                },
                pickTasks: {
                    where: {
                        status: {
                            in: [
                                PickTaskStatus.OPEN,
                                PickTaskStatus.IN_PROGRESS,
                                PickTaskStatus.AWAITING_DROP,
                            ],
                        },
                    },
                    include: {
                        items: true,
                    },
                },
            },
        });

        if (!order) {
            throw new NotFoundException('A megadott rendelés nem található');
        }

        const alreadyAllocatedByOrderItem = new Map<string, number>();
        for (const existingTask of order.pickTasks) {
            for (const existingTaskItem of existingTask.items) {
                const openRemaining = Math.max(
                    0,
                    existingTaskItem.requiredQuantity - existingTaskItem.pickedQuantity,
                );
                alreadyAllocatedByOrderItem.set(
                    existingTaskItem.salesOrderItemId,
                    (alreadyAllocatedByOrderItem.get(existingTaskItem.salesOrderItemId) ?? 0) +
                        openRemaining,
                );
            }
        }

        const itemsToAllocate = order.items
            .map((item) => {
                const remainingOnOrder = Math.max(0, item.orderedQuantity - item.pickedQuantity);
                const alreadyAllocated = alreadyAllocatedByOrderItem.get(item.id) ?? 0;
                const toAllocate = Math.max(0, remainingOnOrder - alreadyAllocated);
                return {
                    salesOrderItemId: item.id,
                    variantId: item.variantId,
                    requiredQuantity: toAllocate,
                };
            })
            .filter((item) => item.requiredQuantity > 0);

        if (itemsToAllocate.length === 0) {
            return [];
        }

        const subtreeMap = await this.loadSubtreeLocations(tx, order.sourceLocationId);
        const subtreeIds = Array.from(subtreeMap.keys());
        const variantIds = Array.from(new Set(itemsToAllocate.map((i) => i.variantId)));

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

        type ShelfCandidate = {
            locationId: string;
            name: string;
            path: string;
            slotMode: SlotMode | null;
            isActive: boolean;
            quantity: number;
            zoneId: string | null;
        };

        type ZoneBucket = {
            zoneKey: string;
            zoneId: string | null;
            zoneName: string;
            totalQty: number;
            hasDedicated: boolean;
            shelves: ShelfCandidate[];
            bestShelfId: string | null;
        };

        const zonesByVariant = new Map<string, ZoneBucket[]>();

        for (const variantId of variantIds) {
            const variantStock = stockRows.filter((row) => row.variantId === variantId);
            const activeOnly = variantStock.filter(
                (row) => subtreeMap.get(row.locationId)?.isActive !== false,
            );
            const chosenStock = activeOnly.length > 0 ? activeOnly : variantStock;

            const bucketByZoneKey = new Map<string, ZoneBucket>();
            for (const row of chosenStock) {
                const node = subtreeMap.get(row.locationId);
                if (!node) continue;
                const zoneId = this.resolveZoneIdFromSubtree(
                    node.id,
                    order.sourceLocationId,
                    subtreeMap,
                );
                const zoneKey = zoneId ?? NO_ZONE_KEY;
                const zoneName = zoneId ? (subtreeMap.get(zoneId)?.name ?? '') : '';
                const path = this.buildLocationPathFromSubtree(
                    node.id,
                    order.sourceLocationId,
                    subtreeMap,
                );

                let bucket = bucketByZoneKey.get(zoneKey);
                if (!bucket) {
                    bucket = {
                        zoneKey,
                        zoneId,
                        zoneName,
                        totalQty: 0,
                        hasDedicated: false,
                        shelves: [],
                        bestShelfId: null,
                    };
                    bucketByZoneKey.set(zoneKey, bucket);
                }

                bucket.totalQty += row.quantity;
                if (node.slotMode === SlotMode.DEDICATED) {
                    bucket.hasDedicated = true;
                }
                bucket.shelves.push({
                    locationId: node.id,
                    name: node.name,
                    path,
                    slotMode: node.slotMode,
                    isActive: node.isActive,
                    quantity: row.quantity,
                    zoneId,
                });
            }

            for (const bucket of bucketByZoneKey.values()) {
                bucket.shelves.sort((a, b) => {
                    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
                    const aDed = a.slotMode === SlotMode.DEDICATED ? 1 : 0;
                    const bDed = b.slotMode === SlotMode.DEDICATED ? 1 : 0;
                    if (aDed !== bDed) return bDed - aDed;
                    if (a.quantity !== b.quantity) return b.quantity - a.quantity;
                    return HU_COLLATOR.compare(a.path, b.path);
                });
                bucket.bestShelfId = bucket.shelves[0]?.locationId ?? null;
            }

            zonesByVariant.set(variantId, Array.from(bucketByZoneKey.values()));
        }

        const activeZoneKeys = new Set<string>();
        const allocationsByZoneKey = new Map<
            string,
            {
                zoneId: string | null;
                zoneName: string;
                items: Array<{
                    salesOrderItemId: string;
                    variantId: string;
                    suggestedLocationId: string | null;
                    suggestedPath: string;
                    requiredQuantity: number;
                }>;
            }
        >();

        const addAllocation = (
            zoneKey: string,
            zoneId: string | null,
            zoneName: string,
            entry: {
                salesOrderItemId: string;
                variantId: string;
                suggestedLocationId: string | null;
                requiredQuantity: number;
            },
        ) => {
            activeZoneKeys.add(zoneKey);
            let group = allocationsByZoneKey.get(zoneKey);
            if (!group) {
                group = { zoneId, zoneName, items: [] };
                allocationsByZoneKey.set(zoneKey, group);
            }
            const suggestedPath = entry.suggestedLocationId
                ? this.buildLocationPathFromSubtree(
                      entry.suggestedLocationId,
                      order.sourceLocationId,
                      subtreeMap,
                  )
                : '';
            group.items.push({
                ...entry,
                suggestedPath,
            });
        };

        const compareZoneNames = (a: ZoneBucket, b: ZoneBucket) => {
            if (a.zoneId === null && b.zoneId !== null) return 1;
            if (a.zoneId !== null && b.zoneId === null) return -1;
            return HU_COLLATOR.compare(a.zoneName, b.zoneName);
        };

        const pass1Items: typeof itemsToAllocate = [];
        const pass2Items: typeof itemsToAllocate = [];

        for (const item of itemsToAllocate) {
            const buckets = zonesByVariant.get(item.variantId) ?? [];
            const hasDedicatedZone = buckets.some((b) => b.hasDedicated);
            if (buckets.length <= 1 || hasDedicatedZone) {
                pass1Items.push(item);
            } else {
                pass2Items.push(item);
            }
        }

        const allocateItemAcrossBuckets = (
            item: { salesOrderItemId: string; variantId: string; requiredQuantity: number },
            sortedBuckets: ZoneBucket[],
        ) => {
            if (sortedBuckets.length === 0) {
                addAllocation(NO_ZONE_KEY, null, '', {
                    salesOrderItemId: item.salesOrderItemId,
                    variantId: item.variantId,
                    suggestedLocationId: order.sourceLocationId,
                    requiredQuantity: item.requiredQuantity,
                });
                return;
            }

            let remaining = item.requiredQuantity;
            for (let idx = 0; idx < sortedBuckets.length && remaining > 0; idx++) {
                const bucket = sortedBuckets[idx];
                const isLast = idx === sortedBuckets.length - 1;
                const take = isLast ? remaining : Math.min(remaining, bucket.totalQty);
                if (take <= 0) {
                    continue;
                }
                addAllocation(bucket.zoneKey, bucket.zoneId, bucket.zoneName, {
                    salesOrderItemId: item.salesOrderItemId,
                    variantId: item.variantId,
                    suggestedLocationId: bucket.bestShelfId,
                    requiredQuantity: take,
                });
                remaining -= take;
            }
        };

        // 1. menet: egy-zónás vagy DEDICATED polcos tételek
        for (const item of pass1Items) {
            const buckets = [...(zonesByVariant.get(item.variantId) ?? [])];
            buckets.sort((a, b) => {
                if (a.hasDedicated !== b.hasDedicated) return a.hasDedicated ? -1 : 1;
                const aCovers = a.totalQty >= item.requiredQuantity ? 1 : 0;
                const bCovers = b.totalQty >= item.requiredQuantity ? 1 : 0;
                if (aCovers !== bCovers) return bCovers - aCovers;
                if (a.totalQty !== b.totalQty) return b.totalQty - a.totalQty;
                return compareZoneNames(a, b);
            });
            allocateItemAcrossBuckets(item, buckets);
        }

        // 2. menet: több MIXED zónás tételek -> már aktív zónák előnyben
        for (const item of pass2Items) {
            const buckets = [...(zonesByVariant.get(item.variantId) ?? [])];
            buckets.sort((a, b) => {
                const aActive = activeZoneKeys.has(a.zoneKey) ? 1 : 0;
                const bActive = activeZoneKeys.has(b.zoneKey) ? 1 : 0;
                const aActiveFull = aActive && a.totalQty >= item.requiredQuantity ? 1 : 0;
                const bActiveFull = bActive && b.totalQty >= item.requiredQuantity ? 1 : 0;
                if (aActiveFull !== bActiveFull) return bActiveFull - aActiveFull;
                if (aActive !== bActive) return bActive - aActive;
                const aCovers = a.totalQty >= item.requiredQuantity ? 1 : 0;
                const bCovers = b.totalQty >= item.requiredQuantity ? 1 : 0;
                if (aCovers !== bCovers) return bCovers - aCovers;
                if (a.totalQty !== b.totalQty) return b.totalQty - a.totalQty;
                return compareZoneNames(a, b);
            });
            allocateItemAcrossBuckets(item, buckets);
        }

        const sortedGroups = Array.from(allocationsByZoneKey.values()).sort((a, b) => {
            if (a.zoneId === null && b.zoneId !== null) return 1;
            if (a.zoneId !== null && b.zoneId === null) return -1;
            return HU_COLLATOR.compare(a.zoneName, b.zoneName);
        });

        const taskNumbers = await this.generateUniquePickTaskNumbersInTx(tx, sortedGroups.length);
        const createdTasks = [];

        for (let i = 0; i < sortedGroups.length; i++) {
            const group = sortedGroups[i];
            group.items.sort((a, b) => HU_COLLATOR.compare(a.suggestedPath, b.suggestedPath));

            const task = await tx.pickTask.create({
                data: {
                    taskNumber: taskNumbers[i],
                    salesOrderId: order.id,
                    sourceLocationId: order.sourceLocationId,
                    zoneId: group.zoneId,
                    status: PickTaskStatus.OPEN,
                    items: {
                        create: group.items.map((item) => ({
                            salesOrderItemId: item.salesOrderItemId,
                            variantId: item.variantId,
                            suggestedLocationId: item.suggestedLocationId,
                            requiredQuantity: item.requiredQuantity,
                            pickedQuantity: 0,
                        })),
                    },
                },
                include: {
                    zone: true,
                    items: true,
                },
            });
            createdTasks.push(task);
        }

        return createdTasks;
    }

    async findAll(user: AuthUser, options?: FindPickTasksOptions) {
        if (options?.sourceLocationId) {
            this.assertValidUuid(options.sourceLocationId, 'sourceLocationId');
            await this.locationAccessService.assertCanAccess(user, options.sourceLocationId);
        }
        if (options?.salesOrderId) {
            this.assertValidUuid(options.salesOrderId, 'salesOrderId');
        }
        if (options?.zoneId && options.zoneId !== 'NONE') {
            this.assertValidUuid(options.zoneId, 'zoneId');
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

        const where: Prisma.PickTaskWhereInput = {
            sourceLocation: locationWhere,
            ...(options?.status ? { status: options.status } : {}),
            ...(options?.assignedToMe ? { assignedToUserId: user.userId } : {}),
            ...(options?.salesOrderId ? { salesOrderId: options.salesOrderId } : {}),
            ...(options?.zoneId === 'NONE'
                ? { zoneId: null }
                : options?.zoneId
                  ? { zoneId: options.zoneId }
                  : {}),
            ...(q
                ? {
                      OR: [
                          { taskNumber: { contains: q, mode: 'insensitive' } },
                          { toteCode: { contains: q, mode: 'insensitive' } },
                          { dropoffCode: { contains: q, mode: 'insensitive' } },
                          { zone: { name: { contains: q, mode: 'insensitive' } } },
                          {
                              salesOrder: {
                                  OR: [
                                      { orderNumber: { contains: q, mode: 'insensitive' } },
                                      { externalOrderRef: { contains: q, mode: 'insensitive' } },
                                      { customerName: { contains: q, mode: 'insensitive' } },
                                  ],
                              },
                          },
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

        const [rawItems, total] = await this.prisma.$transaction([
            this.prisma.pickTask.findMany({
                where,
                include: this.listInclude,
                skip,
                take,
                orderBy: [{ createdAt: 'desc' }],
            }),
            this.prisma.pickTask.count({ where }),
        ]);

        const items = rawItems.map((task) => this.sanitizePickTask(task, user));
        return { items, total };
    }

    async getMyRoute(user: AuthUser, sourceLocationId?: string) {
        if (sourceLocationId) {
            this.assertValidUuid(sourceLocationId, 'sourceLocationId');
            await this.locationAccessService.assertCanAccess(user, sourceLocationId);
        }

        const locationWhere = sourceLocationId
            ? this.buildSubtreeLocationWhere(sourceLocationId)
            : await this.locationAccessService.accessibleWhere(user);

        const rawTasks = await this.prisma.pickTask.findMany({
            where: {
                assignedToUserId: user.userId,
                status: { in: [PickTaskStatus.IN_PROGRESS, PickTaskStatus.AWAITING_DROP] },
                sourceLocation: locationWhere,
            },
            include: this.listInclude,
            orderBy: [{ startedAt: 'asc' }, { createdAt: 'asc' }],
        });

        const siteIds = Array.from(new Set(rawTasks.map((t) => t.sourceLocationId)));
        const subtreeBySite = new Map<string, Map<string, SubtreeLocationNode>>();
        for (const siteId of siteIds) {
            subtreeBySite.set(siteId, await this.loadSubtreeLocations(this.prisma, siteId));
        }

        const allSubtreeIds = Array.from(
            new Set(
                Array.from(subtreeBySite.values()).flatMap((map) => Array.from(map.keys())),
            ),
        );
        const allVariantIds = Array.from(
            new Set(rawTasks.flatMap((t) => t.items.map((item) => item.variantId))),
        );

        const stockRows =
            allSubtreeIds.length > 0 && allVariantIds.length > 0
                ? await this.prisma.stockItem.findMany({
                      where: {
                          locationId: { in: allSubtreeIds },
                          variantId: { in: allVariantIds },
                          quantity: { gt: 0 },
                      },
                      select: {
                          locationId: true,
                          variantId: true,
                          quantity: true,
                      },
                  })
                : [];

        const routeItems: Array<{
            pickTaskId: string;
            taskNumber: string;
            salesOrderId: string;
            orderNumber: string;
            externalOrderRef: string | null;
            customerName: string;
            toteCode: string | null;
            sourceLocationId: string;
            sourceLocationName: string;
            zoneId: string | null;
            zoneName: string | null;
            pickTaskItemId: string;
            salesOrderItemId: string;
            variantId: string;
            variant: unknown;
            suggestedLocationId: string | null;
            suggestedLocationName: string | null;
            suggestedLocationPath: string;
            requiredQuantity: number;
            pickedQuantity: number;
            remainingQuantity: number;
            availableShelves: AvailableShelfOption[];
        }> = [];

        const enrichedTasks = rawTasks.map((task) => {
            const subtreeMap = subtreeBySite.get(task.sourceLocationId) ?? new Map();
            const enrichedItems = task.items
                .map((item) => {
                    const suggestedLocationPath = item.suggestedLocationId
                        ? this.buildLocationPathFromSubtree(
                              item.suggestedLocationId,
                              task.sourceLocationId,
                              subtreeMap,
                          )
                        : '';
                    const availableShelves = this.buildAvailableShelves(
                        stockRows,
                        item.variantId,
                        task.sourceLocationId,
                        task.zoneId,
                        item.suggestedLocationId,
                        subtreeMap,
                    );
                    const sanitizedVariant = this.sanitizeVariant(item.variant, user);

                    const remainingQuantity = Math.max(
                        0,
                        item.requiredQuantity - item.pickedQuantity,
                    );
                    if (task.status === PickTaskStatus.IN_PROGRESS && remainingQuantity > 0) {
                        routeItems.push({
                            pickTaskId: task.id,
                            taskNumber: task.taskNumber,
                            salesOrderId: task.salesOrderId,
                            orderNumber: task.salesOrder.orderNumber,
                            externalOrderRef: task.salesOrder.externalOrderRef,
                            customerName: task.salesOrder.customerName,
                            toteCode: task.toteCode,
                            sourceLocationId: task.sourceLocationId,
                            sourceLocationName: task.sourceLocation.name,
                            zoneId: task.zoneId,
                            zoneName: task.zone?.name ?? null,
                            pickTaskItemId: item.id,
                            salesOrderItemId: item.salesOrderItemId,
                            variantId: item.variantId,
                            variant: sanitizedVariant,
                            suggestedLocationId: item.suggestedLocationId,
                            suggestedLocationName: item.suggestedLocation?.name ?? null,
                            suggestedLocationPath,
                            requiredQuantity: item.requiredQuantity,
                            pickedQuantity: item.pickedQuantity,
                            remainingQuantity,
                            availableShelves,
                        });
                    }

                    return {
                        ...item,
                        variant: sanitizedVariant,
                        suggestedLocationPath,
                        availableShelves,
                    };
                })
                .sort((a, b) => {
                    const pathCmp = HU_COLLATOR.compare(
                        a.suggestedLocationPath || '\uffff',
                        b.suggestedLocationPath || '\uffff',
                    );
                    if (pathCmp !== 0) return pathCmp;
                    return HU_COLLATOR.compare(a.variant.sku, b.variant.sku);
                });

            return {
                ...task,
                items: enrichedItems,
            };
        });

        routeItems.sort((a, b) => {
            const zoneCmp = HU_COLLATOR.compare(
                a.zoneName ?? '\uffff',
                b.zoneName ?? '\uffff',
            );
            if (zoneCmp !== 0) return zoneCmp;
            const pathCmp = HU_COLLATOR.compare(
                a.suggestedLocationPath || '\uffff',
                b.suggestedLocationPath || '\uffff',
            );
            if (pathCmp !== 0) return pathCmp;
            const skuA = (a.variant as { sku?: string }).sku ?? '';
            const skuB = (b.variant as { sku?: string }).sku ?? '';
            return HU_COLLATOR.compare(skuA, skuB);
        });

        return {
            tasks: enrichedTasks,
            inProgressTasks: enrichedTasks.filter(
                (task) => task.status === PickTaskStatus.IN_PROGRESS,
            ),
            awaitingDropTasks: enrichedTasks.filter(
                (task) => task.status === PickTaskStatus.AWAITING_DROP,
            ),
            routeItems,
        };
    }

    async findOne(id: string, user: AuthUser) {
        const task = await this.prisma.pickTask.findUnique({
            where: { id },
            include: this.detailInclude,
        });

        if (!task) {
            throw new NotFoundException('A keresett kiszedési feladat nem található');
        }

        await this.locationAccessService.assertCanAccess(user, task.sourceLocationId);

        const subtreeMap = await this.loadSubtreeLocations(this.prisma, task.sourceLocationId);
        const subtreeIds = Array.from(subtreeMap.keys());
        const variantIds = Array.from(new Set(task.items.map((i) => i.variantId)));

        const stockRows =
            subtreeIds.length > 0 && variantIds.length > 0
                ? await this.prisma.stockItem.findMany({
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
                  })
                : [];

        const enrichedItems = task.items
            .map((item) => {
                const suggestedLocationPath = item.suggestedLocationId
                    ? this.buildLocationPathFromSubtree(
                          item.suggestedLocationId,
                          task.sourceLocationId,
                          subtreeMap,
                      )
                    : '';
                const availableShelves = this.buildAvailableShelves(
                    stockRows,
                    item.variantId,
                    task.sourceLocationId,
                    task.zoneId,
                    item.suggestedLocationId,
                    subtreeMap,
                );
                return {
                    ...item,
                    variant: this.sanitizeVariant(item.variant, user),
                    suggestedLocationPath,
                    availableShelves,
                };
            })
            .sort((a, b) => {
                const pathCmp = HU_COLLATOR.compare(
                    a.suggestedLocationPath || '\uffff',
                    b.suggestedLocationPath || '\uffff',
                );
                if (pathCmp !== 0) return pathCmp;
                return HU_COLLATOR.compare(a.variant.sku, b.variant.sku);
            });

        const sanitizedMovements = task.stockMovements.map((mv) =>
            this.sanitizeMovement(mv, user),
        );

        return {
            ...task,
            items: enrichedItems,
            stockMovements: sanitizedMovements,
        };
    }

    async claim(id: string, dto: ClaimPickTaskDto, user: AuthUser) {
        await this.claimTasksInternal(
            [{ pickTaskId: id, toteCode: dto?.toteCode?.trim() || undefined }],
            user,
        );
        return this.findOne(id, user);
    }

    async claimBatch(dto: ClaimPickTasksDto, user: AuthUser) {
        const entries: Array<{ pickTaskId: string; toteCode?: string }> = [];
        const sharedTote = dto.toteCode?.trim() || undefined;

        if (dto.tasks && dto.tasks.length > 0) {
            for (const entry of dto.tasks) {
                entries.push({
                    pickTaskId: entry.pickTaskId,
                    toteCode: entry.toteCode?.trim() || sharedTote,
                });
            }
        } else if (dto.pickTaskIds && dto.pickTaskIds.length > 0) {
            for (const pickTaskId of dto.pickTaskIds) {
                entries.push({
                    pickTaskId,
                    toteCode: sharedTote,
                });
            }
        }

        if (entries.length === 0) {
            throw new BadRequestException(
                'Legalább egy kiszedési feladat (pickTaskIds vagy tasks) megadása kötelező',
            );
        }

        const uniqueCheck = new Set<string>();
        for (const entry of entries) {
            if (uniqueCheck.has(entry.pickTaskId)) {
                throw new BadRequestException(
                    `Duplikált kiszedési feladat azonosító: ${entry.pickTaskId}`,
                );
            }
            uniqueCheck.add(entry.pickTaskId);
        }

        await this.claimTasksInternal(entries, user);

        const tasks = await Promise.all(entries.map((entry) => this.findOne(entry.pickTaskId, user)));
        return { tasks };
    }

    private async claimTasksInternal(
        entries: Array<{ pickTaskId: string; toteCode?: string }>,
        user: AuthUser,
    ) {
        const ids = entries.map((e) => e.pickTaskId);
        const existingTasks = await this.prisma.pickTask.findMany({
            where: { id: { in: ids } },
            include: {
                salesOrder: {
                    select: { id: true, orderNumber: true, status: true },
                },
            },
        });

        if (existingTasks.length !== ids.length) {
            throw new NotFoundException('Egy vagy több megadott kiszedési feladat nem található');
        }

        const taskById = new Map(existingTasks.map((t) => [t.id, t]));
        for (const task of existingTasks) {
            await this.locationAccessService.assertCanAccess(user, task.sourceLocationId);
            if (
                task.salesOrder.status === SalesOrderStatus.ON_HOLD ||
                task.salesOrder.status === SalesOrderStatus.CANCELLED ||
                task.salesOrder.status === SalesOrderStatus.COMPLETED
            ) {
                throw new ConflictException(
                    `A(z) ${task.salesOrder.orderNumber} rendelés jelenleg ${task.salesOrder.status} státuszban van, a kiszedési feladat nem vehető fel`,
                );
            }
        }

        const now = new Date();

        await this.prisma.$transaction(async (tx) => {
            const touchedOrderIds = new Set<string>();

            for (const entry of entries) {
                const task = taskById.get(entry.pickTaskId)!;

                const claimOpen = await tx.pickTask.updateMany({
                    where: {
                        id: entry.pickTaskId,
                        status: PickTaskStatus.OPEN,
                        salesOrder: {
                            status: {
                                notIn: [
                                    SalesOrderStatus.ON_HOLD,
                                    SalesOrderStatus.CANCELLED,
                                    SalesOrderStatus.COMPLETED,
                                ],
                            },
                        },
                    },
                    data: {
                        status: PickTaskStatus.IN_PROGRESS,
                        assignedToUserId: user.userId,
                        ...(entry.toteCode !== undefined ? { toteCode: entry.toteCode } : {}),
                        startedAt: now,
                    },
                });

                if (claimOpen.count !== 1) {
                    const claimUnassignedInProgress = await tx.pickTask.updateMany({
                        where: {
                            id: entry.pickTaskId,
                            status: PickTaskStatus.IN_PROGRESS,
                            assignedToUserId: null,
                            salesOrder: {
                                status: {
                                    notIn: [
                                        SalesOrderStatus.ON_HOLD,
                                        SalesOrderStatus.CANCELLED,
                                        SalesOrderStatus.COMPLETED,
                                    ],
                                },
                            },
                        },
                        data: {
                            assignedToUserId: user.userId,
                            ...(entry.toteCode !== undefined ? { toteCode: entry.toteCode } : {}),
                        },
                    });

                    if (claimUnassignedInProgress.count !== 1) {
                        throw new ConflictException(
                            `A(z) ${task.taskNumber} kiszedési feladat már nem OPEN státuszú vagy más dolgozó felvette`,
                        );
                    }
                }

                touchedOrderIds.add(task.salesOrderId);
            }

            if (touchedOrderIds.size > 0) {
                await tx.salesOrder.updateMany({
                    where: {
                        id: { in: Array.from(touchedOrderIds) },
                        status: SalesOrderStatus.PENDING,
                    },
                    data: {
                        status: SalesOrderStatus.PICKING,
                    },
                });
            }
        });
    }

    async release(id: string, user: AuthUser) {
        const task = await this.prisma.pickTask.findUnique({
            where: { id },
            include: {
                items: true,
                salesOrder: {
                    select: { id: true, status: true },
                },
            },
        });

        if (!task) {
            throw new NotFoundException('A keresett kiszedési feladat nem található');
        }

        await this.locationAccessService.assertCanAccess(user, task.sourceLocationId);

        if (task.status !== PickTaskStatus.IN_PROGRESS) {
            throw new BadRequestException(
                `Csak IN_PROGRESS státuszú kiszedési feladat engedhető el (jelenlegi: ${task.status})`,
            );
        }

        const isManager = MANAGER_ROLES.includes(user.role);
        if (task.assignedToUserId !== user.userId && !isManager) {
            throw new ForbiddenException(
                'Csak a saját magadhoz rendelt kiszedési feladatot engedheted el',
            );
        }

        const totalPicked = task.items.reduce((sum, item) => sum + item.pickedQuantity, 0);

        if (totalPicked > 0 && !isManager) {
            throw new ForbiddenException(
                'Már részben kiszedett feladatot csak vezető engedhet el / adhat át másnak',
            );
        }

        await this.prisma.$transaction(async (tx) => {
            if (totalPicked === 0) {
                await tx.pickTask.update({
                    where: { id },
                    data: {
                        status: PickTaskStatus.OPEN,
                        assignedToUserId: null,
                        startedAt: null,
                        toteCode: null,
                    },
                });

                if (task.salesOrder.status === SalesOrderStatus.PICKING) {
                    const orderTasks = await tx.pickTask.findMany({
                        where: {
                            salesOrderId: task.salesOrderId,
                            status: { not: PickTaskStatus.CANCELLED },
                        },
                        include: { items: true },
                    });

                    const allOpenAndUnpicked =
                        orderTasks.length > 0 &&
                        orderTasks.every(
                            (t) =>
                                t.status === PickTaskStatus.OPEN &&
                                t.items.every((i) => i.pickedQuantity === 0),
                        );

                    if (allOpenAndUnpicked) {
                        await tx.salesOrder.update({
                            where: { id: task.salesOrderId },
                            data: { status: SalesOrderStatus.PENDING },
                        });
                    }
                }
            } else {
                await tx.pickTask.update({
                    where: { id },
                    data: {
                        assignedToUserId: null,
                    },
                });
            }
        });

        return this.findOne(id, user);
    }

    async updateTote(id: string, dto: UpdatePickTaskToteDto, user: AuthUser) {
        const task = await this.prisma.pickTask.findUnique({
            where: { id },
        });
        if (!task) {
            throw new NotFoundException('A keresett kiszedési feladat nem található');
        }

        await this.locationAccessService.assertCanAccess(user, task.sourceLocationId);

        if (
            task.status === PickTaskStatus.COMPLETED ||
            task.status === PickTaskStatus.CANCELLED
        ) {
            throw new BadRequestException(
                `Lezárt vagy törölt feladaton a láda/kosár kód már nem módosítható (${task.status})`,
            );
        }

        const isManager = MANAGER_ROLES.includes(user.role);
        if (task.assignedToUserId && task.assignedToUserId !== user.userId && !isManager) {
            throw new ForbiddenException(
                'Csak a saját kiszedési feladatod láda/kosár kódját módosíthatod',
            );
        }

        await this.prisma.pickTask.update({
            where: { id },
            data: {
                toteCode: dto.toteCode ? dto.toteCode.trim() || null : null,
            },
        });

        return this.findOne(id, user);
    }

    async pick(id: string, dto: PickItemDto, user: AuthUser) {
        const task = await this.prisma.pickTask.findUnique({
            where: { id },
            include: {
                salesOrder: true,
                items: {
                    include: {
                        salesOrderItem: true,
                    },
                },
            },
        });

        if (!task) {
            throw new NotFoundException('A keresett kiszedési feladat nem található');
        }

        await this.locationAccessService.assertCanAccess(user, task.sourceLocationId);

        if (task.status !== PickTaskStatus.IN_PROGRESS) {
            throw new BadRequestException(
                `Kiszedés csak IN_PROGRESS státuszú feladaton végezhető (jelenlegi: ${task.status})`,
            );
        }

        if (
            task.salesOrder.status === SalesOrderStatus.ON_HOLD ||
            task.salesOrder.status === SalesOrderStatus.COMPLETED ||
            task.salesOrder.status === SalesOrderStatus.CANCELLED
        ) {
            throw new ConflictException(
                `A kapcsolódó rendelés (${task.salesOrder.orderNumber}) ${task.salesOrder.status} státuszban van, kiszedés nem engedélyezett`,
            );
        }

        const isManager = MANAGER_ROLES.includes(user.role);
        if (task.assignedToUserId && task.assignedToUserId !== user.userId && !isManager) {
            throw new ForbiddenException(
                'Ez a kiszedési feladat másik dolgozóhoz van rendelve',
            );
        }

        const variant = await this.resolveVariantForPick(dto, task.items);
        const matchingTaskItem = dto.pickTaskItemId
            ? task.items.find((i) => i.id === dto.pickTaskItemId)
            : task.items.find((i) => i.variantId === variant.id);

        if (!matchingTaskItem || matchingTaskItem.variantId !== variant.id) {
            throw new BadRequestException(
                `A(z) ${variant.sku} termékvariáns nem szerepel ezen a kiszedési feladaton`,
            );
        }

        const shelf = await this.resolveShelfForPick(
            dto,
            task.sourceLocationId,
            matchingTaskItem.suggestedLocationId,
            user,
        );

        const txResult = await this.prisma.$transaction(async (tx) => {
            await acquireSiteVariantLocks(tx, [
                { siteLocationId: task.sourceLocationId, variantId: variant.id },
            ]);

            const currentTask = await tx.pickTask.findUnique({
                where: { id },
                include: {
                    salesOrder: true,
                },
            });
            if (!currentTask || currentTask.status !== PickTaskStatus.IN_PROGRESS) {
                throw new ConflictException(
                    'A kiszedési feladat időközben már nem IN_PROGRESS státuszban van',
                );
            }
            if (
                currentTask.salesOrder.status === SalesOrderStatus.ON_HOLD ||
                currentTask.salesOrder.status === SalesOrderStatus.COMPLETED ||
                currentTask.salesOrder.status === SalesOrderStatus.CANCELLED
            ) {
                throw new ConflictException(
                    `A rendelés időközben ${currentTask.salesOrder.status} státuszba került`,
                );
            }

            const currentTaskItem = await tx.pickTaskItem.findUnique({
                where: { id: matchingTaskItem.id },
                include: { salesOrderItem: true },
            });
            if (!currentTaskItem) {
                throw new NotFoundException('A kiszedési tétel nem található');
            }

            const remainingTaskQty =
                currentTaskItem.requiredQuantity - currentTaskItem.pickedQuantity;
            if (dto.quantity > remainingTaskQty) {
                throw new BadRequestException(
                    `A kiszedni kívánt mennyiség (${dto.quantity} db) meghaladja a feladat hátralévő mennyiségét (${remainingTaskQty} db)`,
                );
            }

            const remainingOrderItemQty =
                currentTaskItem.salesOrderItem.orderedQuantity -
                currentTaskItem.salesOrderItem.pickedQuantity;
            if (dto.quantity > remainingOrderItemQty) {
                throw new BadRequestException(
                    `A kiszedni kívánt mennyiség (${dto.quantity} db) meghaladja a rendeléstétel hátralévő mennyiségét (${remainingOrderItemQty} db)`,
                );
            }

            const stockItem = await tx.stockItem.findUnique({
                where: {
                    variantId_locationId: {
                        variantId: variant.id,
                        locationId: shelf.id,
                    },
                },
            });

            if (!stockItem || stockItem.quantity < dto.quantity) {
                throw new ConflictException(
                    `Nincs elegendő fizikai készlet a(z) "${shelf.name}" polcon (elérhető: ${stockItem?.quantity ?? 0} db, kért: ${dto.quantity} db)`,
                );
            }

            const updatedStockItem = await tx.stockItem.update({
                where: {
                    variantId_locationId: {
                        variantId: variant.id,
                        locationId: shelf.id,
                    },
                },
                data: {
                    quantity: { decrement: dto.quantity },
                },
            });

            await tx.pickTaskItem.update({
                where: { id: currentTaskItem.id },
                data: {
                    pickedQuantity: { increment: dto.quantity },
                },
            });

            const nextReserved = Math.max(
                0,
                currentTaskItem.salesOrderItem.reservedQuantity - dto.quantity,
            );
            await tx.salesOrderItem.update({
                where: { id: currentTaskItem.salesOrderItemId },
                data: {
                    pickedQuantity: { increment: dto.quantity },
                    reservedQuantity: nextReserved,
                },
            });

            if (currentTask.salesOrder.status === SalesOrderStatus.PENDING) {
                await tx.salesOrder.update({
                    where: { id: currentTask.salesOrderId },
                    data: { status: SalesOrderStatus.PICKING },
                });
            }

            const movement = await tx.stockMovement.create({
                data: {
                    type: MovementType.SALE,
                    variantId: variant.id,
                    locationId: shelf.id,
                    quantity: -dto.quantity,
                    salesOrderId: currentTask.salesOrderId,
                    pickTaskId: currentTask.id,
                    unitPriceHuf: currentTaskItem.salesOrderItem.unitNetPrice,
                    unitCostHuf: variant.costPrice,
                    note:
                        dto.note?.trim() ||
                        `Kiszedés (${currentTask.taskNumber} / ${currentTask.salesOrder.orderNumber})`,
                    createdByUserId: user.userId,
                },
                include: {
                    location: true,
                    variant: { include: { product: true } },
                    createdByUser: { select: { id: true, name: true, email: true, role: true } },
                },
            });

            const allTaskItems = await tx.pickTaskItem.findMany({
                where: { pickTaskId: currentTask.id },
                select: { requiredQuantity: true, pickedQuantity: true },
            });

            const allPicked = allTaskItems.every(
                (item) => item.pickedQuantity >= item.requiredQuantity,
            );

            await tx.pickTask.update({
                where: { id: currentTask.id },
                data: {
                    ...(currentTask.assignedToUserId === null
                        ? { assignedToUserId: user.userId }
                        : {}),
                    ...(allPicked ? { status: PickTaskStatus.AWAITING_DROP } : {}),
                },
            });

            return { movement, stockItem: updatedStockItem };
        });

        const updatedTask = await this.findOne(id, user);
        return {
            ...updatedTask,
            lastMovement: this.sanitizeMovement(txResult.movement, user),
            stockItem: txResult.stockItem,
        };
    }

    async dropoff(id: string, dto: DropoffPickTaskDto, user: AuthUser) {
        const task = await this.prisma.pickTask.findUnique({
            where: { id },
            include: { salesOrder: true },
        });
        if (!task) {
            throw new NotFoundException('A keresett kiszedési feladat nem található');
        }

        await this.locationAccessService.assertCanAccess(user, task.sourceLocationId);

        if (task.status !== PickTaskStatus.AWAITING_DROP) {
            throw new BadRequestException(
                `Leadás (dropoff) csak AWAITING_DROP státuszú feladaton végezhető (jelenlegi: ${task.status})`,
            );
        }

        const isManager = MANAGER_ROLES.includes(user.role);
        if (task.assignedToUserId && task.assignedToUserId !== user.userId && !isManager) {
            throw new ForbiddenException(
                'Csak a saját magadhoz rendelt kiszedési feladatot adhatod le',
            );
        }

        const rawCode = dto?.dropoffCode?.trim() || '';
        const hasLocationId = Boolean(dto?.dropoffLocationId?.trim());
        const hasCode = rawCode.length > 0;
        const handoverAtCounter = dto?.handoverAtCounter === true;

        if (!hasLocationId && !hasCode && !handoverAtCounter) {
            throw new BadRequestException(
                'A leadáshoz add meg a dropoffLocationId vagy dropoffCode mezőt, vagy jelöld be a pultnál történő átadást (handoverAtCounter: true)',
            );
        }

        const subtreeMap = await this.loadSubtreeLocations(this.prisma, task.sourceLocationId);

        let resolvedDropoffLocationId: string | null = null;
        let resolvedDropoffCode: string | null = null;

        if (hasLocationId) {
            const locNode = subtreeMap.get(dto.dropoffLocationId!.trim());
            if (!locNode) {
                throw new BadRequestException(
                    'A megadott leadási helyszín nem található a feladat telephelyén belül',
                );
            }
            if (!locNode.isActive) {
                throw new BadRequestException('Inaktív helyszínre nem adható le kiszedett áru');
            }
            resolvedDropoffLocationId = locNode.id;
            resolvedDropoffCode = hasCode ? rawCode : locNode.name;
        } else if (hasCode) {
            resolvedDropoffCode = rawCode;
            if (UUID_REGEX.test(rawCode)) {
                const byId = subtreeMap.get(rawCode);
                if (byId && byId.isActive) {
                    resolvedDropoffLocationId = byId.id;
                    resolvedDropoffCode = byId.name;
                }
            }
            if (!resolvedDropoffLocationId) {
                const byName = Array.from(subtreeMap.values()).find(
                    (loc) => loc.isActive && loc.name.toLowerCase() === rawCode.toLowerCase(),
                );
                if (byName) {
                    resolvedDropoffLocationId = byName.id;
                }
            }
        } else {
            resolvedDropoffLocationId = null;
            resolvedDropoffCode = 'PULT / AZONNALI ÁTADÁS';
        }

        const now = new Date();

        await this.prisma.$transaction(async (tx) => {
            const updated = await tx.pickTask.updateMany({
                where: {
                    id,
                    status: PickTaskStatus.AWAITING_DROP,
                },
                data: {
                    status: PickTaskStatus.COMPLETED,
                    dropoffLocationId: resolvedDropoffLocationId,
                    dropoffCode: resolvedDropoffCode,
                    droppedAt: now,
                    completedAt: now,
                },
            });

            if (updated.count !== 1) {
                throw new ConflictException(
                    'A kiszedési feladat időközben már leadásra került vagy nem AWAITING_DROP státuszú',
                );
            }

            const order = await tx.salesOrder.findUnique({
                where: { id: task.salesOrderId },
                include: {
                    items: {
                        select: { orderedQuantity: true, pickedQuantity: true },
                    },
                    pickTasks: {
                        where: { status: { not: PickTaskStatus.CANCELLED } },
                        select: { status: true },
                    },
                },
            });

            if (
                order &&
                order.status !== SalesOrderStatus.COMPLETED &&
                order.status !== SalesOrderStatus.CANCELLED &&
                order.status !== SalesOrderStatus.ON_HOLD
            ) {
                const allTasksCompleted =
                    order.pickTasks.length > 0 &&
                    order.pickTasks.every((t) => t.status === PickTaskStatus.COMPLETED);
                const allItemsPicked =
                    order.items.length > 0 &&
                    order.items.every((item) => item.pickedQuantity === item.orderedQuantity);

                if (allTasksCompleted && allItemsPicked) {
                    await tx.salesOrder.update({
                        where: { id: order.id },
                        data: { status: SalesOrderStatus.READY },
                    });
                }
            }
        });

        return this.findOne(id, user);
    }

    async undoPick(id: string, movementId: string, user: AuthUser) {
        const task = await this.prisma.pickTask.findUnique({
            where: { id },
            include: { salesOrder: true },
        });
        if (!task) {
            throw new NotFoundException('A keresett kiszedési feladat nem található');
        }

        await this.locationAccessService.assertCanAccess(user, task.sourceLocationId);

        if (task.status === PickTaskStatus.CANCELLED) {
            throw new BadRequestException('Törölt kiszedési feladat mozgása nem sztornózható');
        }

        if (
            task.salesOrder.status === SalesOrderStatus.COMPLETED ||
            task.salesOrder.status === SalesOrderStatus.CANCELLED
        ) {
            throw new BadRequestException(
                `A rendelés már ${task.salesOrder.status} státuszban van, kiszedés nem sztornózható`,
            );
        }

        const movement = await this.prisma.stockMovement.findUnique({
            where: { id: movementId },
            include: { reversedBy: true },
        });

        if (!movement || movement.pickTaskId !== id) {
            throw new NotFoundException(
                'A megadott kiszedési mozgás nem található ezen a kiszedési feladaton',
            );
        }
        if (movement.type !== MovementType.SALE) {
            throw new BadRequestException('Csak SALE típusú kiszedési mozgás sztornózható');
        }
        if (movement.quantity >= 0 || movement.reversedMovementId !== null) {
            throw new BadRequestException('Sztornó mozgást nem lehet újra sztornózni');
        }
        if (movement.reversedBy) {
            throw new ConflictException('Ezt a kiszedési tételt már sztornózták');
        }

        if (
            STAFF_SELF_UNDO_ONLY_ROLES.includes(user.role) &&
            movement.createdByUserId !== user.userId
        ) {
            throw new ForbiddenException(
                'Munkatársként csak a saját magad által rögzített kiszedést sztornózhatod',
            );
        }

        await this.locationAccessService.assertCanAccess(user, movement.locationId);

        const reversalMovement = await this.prisma.$transaction(async (tx) => {
            await acquireSiteVariantLocks(tx, [
                { siteLocationId: task.sourceLocationId, variantId: movement.variantId },
            ]);

            const currentTask = await tx.pickTask.findUnique({
                where: { id },
                include: { salesOrder: true },
            });
            if (
                !currentTask ||
                currentTask.status === PickTaskStatus.CANCELLED ||
                currentTask.salesOrder.status === SalesOrderStatus.COMPLETED ||
                currentTask.salesOrder.status === SalesOrderStatus.CANCELLED
            ) {
                throw new ConflictException(
                    'A rendelés vagy a feladat időközben lezárásra került, sztornózás nem lehetséges',
                );
            }

            const currentMovement = await tx.stockMovement.findUnique({
                where: { id: movementId },
                include: { reversedBy: true },
            });
            if (!currentMovement || currentMovement.reversedBy) {
                throw new ConflictException('Ezt a kiszedési tételt már sztornózták');
            }

            const undoQty = Math.abs(currentMovement.quantity);

            await tx.stockItem.upsert({
                where: {
                    variantId_locationId: {
                        variantId: currentMovement.variantId,
                        locationId: currentMovement.locationId,
                    },
                },
                create: {
                    variantId: currentMovement.variantId,
                    locationId: currentMovement.locationId,
                    quantity: undoQty,
                },
                update: {
                    quantity: { increment: undoQty },
                },
            });

            const taskItem = await tx.pickTaskItem.findFirst({
                where: {
                    pickTaskId: id,
                    variantId: currentMovement.variantId,
                },
            });
            if (taskItem) {
                await tx.pickTaskItem.update({
                    where: { id: taskItem.id },
                    data: {
                        pickedQuantity: Math.max(0, taskItem.pickedQuantity - undoQty),
                    },
                });
            }

            const orderItem = await tx.salesOrderItem.findUnique({
                where: {
                    salesOrderId_variantId: {
                        salesOrderId: currentTask.salesOrderId,
                        variantId: currentMovement.variantId,
                    },
                },
            });
            if (orderItem) {
                const nextPicked = Math.max(0, orderItem.pickedQuantity - undoQty);
                const maxReservable = Math.max(0, orderItem.orderedQuantity - nextPicked);
                const nextReserved = Math.min(maxReservable, orderItem.reservedQuantity + undoQty);
                await tx.salesOrderItem.update({
                    where: { id: orderItem.id },
                    data: {
                        pickedQuantity: nextPicked,
                        reservedQuantity: nextReserved,
                    },
                });
            }

            await tx.pickTask.update({
                where: { id },
                data: {
                    status: PickTaskStatus.IN_PROGRESS,
                    droppedAt: null,
                    completedAt: null,
                },
            });

            if (currentTask.salesOrder.status !== SalesOrderStatus.ON_HOLD) {
                await tx.salesOrder.update({
                    where: { id: currentTask.salesOrderId },
                    data: { status: SalesOrderStatus.PICKING },
                });
            }

            return tx.stockMovement.create({
                data: {
                    type: MovementType.SALE,
                    variantId: currentMovement.variantId,
                    locationId: currentMovement.locationId,
                    quantity: undoQty,
                    salesOrderId: currentTask.salesOrderId,
                    pickTaskId: id,
                    unitCostHuf: currentMovement.unitCostHuf,
                    unitPriceHuf: currentMovement.unitPriceHuf,
                    reversedMovementId: currentMovement.id,
                    note: `Sztornó: ${currentMovement.note ?? currentTask.taskNumber}`,
                    createdByUserId: user.userId,
                },
                include: {
                    location: true,
                    variant: { include: { product: true } },
                    createdByUser: { select: { id: true, name: true, email: true, role: true } },
                },
            });
        });

        const updatedTask = await this.findOne(id, user);
        return {
            ...updatedTask,
            lastMovement: this.sanitizeMovement(reversalMovement, user),
        };
    }

    async reportShortage(id: string, dto: ReportPickShortageDto, user: AuthUser) {
        const task = await this.prisma.pickTask.findUnique({
            where: { id },
            include: {
                salesOrder: true,
                items: true,
            },
        });
        if (!task) {
            throw new NotFoundException('A keresett kiszedési feladat nem található');
        }

        await this.locationAccessService.assertCanAccess(user, task.sourceLocationId);
        await this.locationAccessService.assertCanAccess(user, dto.locationId);

        if (
            task.status === PickTaskStatus.COMPLETED ||
            task.status === PickTaskStatus.CANCELLED
        ) {
            throw new BadRequestException(
                `Lezárt vagy törölt kiszedési feladaton nem jelenthető hiány (${task.status})`,
            );
        }

        if (
            task.salesOrder.status === SalesOrderStatus.COMPLETED ||
            task.salesOrder.status === SalesOrderStatus.CANCELLED
        ) {
            throw new BadRequestException(
                `Lezárt vagy lemondott rendeléshez nem jelenthető hiány (${task.salesOrder.status})`,
            );
        }

        const hasVariant = task.items.some((item) => item.variantId === dto.variantId);
        if (!hasVariant) {
            throw new BadRequestException(
                'A megadott termékvariáns nem szerepel ezen a kiszedési feladaton',
            );
        }

        const subtreeMap = await this.loadSubtreeLocations(this.prisma, task.sourceLocationId);
        const targetShelf = subtreeMap.get(dto.locationId);
        if (!targetShelf) {
            throw new BadRequestException(
                'A megadott polc/helyszín nem tartozik a kiszedési feladat telephelyéhez',
            );
        }

        const variant = await this.prisma.variant.findUnique({
            where: { id: dto.variantId },
            select: { id: true, sku: true },
        });
        if (!variant) {
            throw new NotFoundException('A megadott termékvariáns nem található');
        }

        const report = await this.prisma.$transaction(async (tx) => {
            const existingStock = await tx.stockItem.findUnique({
                where: {
                    variantId_locationId: {
                        variantId: dto.variantId,
                        locationId: dto.locationId,
                    },
                },
            });

            const customReason = dto.reason?.trim();
            const reportReason =
                customReason ||
                `Kiszedési hiány (${task.taskNumber} / ${task.salesOrder.orderNumber}): ${variant.sku} @ ${targetShelf.name} (talált: ${dto.foundQuantity} db)`;

            const createdReport = await tx.stockReport.create({
                data: {
                    variantId: dto.variantId,
                    locationId: dto.locationId,
                    expectedQuantity: existingStock?.quantity ?? 0,
                    foundQuantity: dto.foundQuantity,
                    reason: reportReason,
                    status: StockReportStatus.PENDING,
                    reportedByUserId: user.userId,
                },
                include: {
                    location: true,
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
                    reportedByUser: {
                        select: { id: true, name: true, email: true, role: true },
                    },
                },
            });

            const holdReason = `Kiszedési hiány (${task.taskNumber}): ${variant.sku} @ ${targetShelf.name} – talált: ${dto.foundQuantity} db${customReason ? ` (${customReason})` : ''}`;

            await tx.salesOrder.update({
                where: { id: task.salesOrderId },
                data: {
                    status: SalesOrderStatus.ON_HOLD,
                    holdReason,
                },
            });

            return createdReport;
        });

        const updatedTask = await this.findOne(id, user);
        return {
            task: updatedTask,
            stockReport: {
                ...report,
                variant: this.sanitizeVariant(report.variant, user),
            },
        };
    }

    async loadSubtreeLocations(
        db: Prisma.TransactionClient | PrismaService,
        rootLocationId: string,
    ): Promise<Map<string, SubtreeLocationNode>> {
        const root = await db.location.findUnique({
            where: { id: rootLocationId },
            select: {
                id: true,
                parentId: true,
                name: true,
                type: true,
                slotMode: true,
                isActive: true,
            },
        });

        const map = new Map<string, SubtreeLocationNode>();
        if (!root) {
            return map;
        }

        map.set(root.id, root);
        let frontier: string[] = [root.id];

        while (frontier.length > 0) {
            const children = await db.location.findMany({
                where: { parentId: { in: frontier } },
                select: {
                    id: true,
                    parentId: true,
                    name: true,
                    type: true,
                    slotMode: true,
                    isActive: true,
                },
            });

            const nextFrontier: string[] = [];
            for (const child of children) {
                if (!map.has(child.id)) {
                    map.set(child.id, child);
                    nextFrontier.push(child.id);
                }
            }
            frontier = nextFrontier;
        }

        return map;
    }

    resolveZoneIdFromSubtree(
        locationId: string,
        rootLocationId: string,
        subtreeMap: Map<string, SubtreeLocationNode>,
    ): string | null {
        const visited = new Set<string>();
        let currentId: string | null = locationId;

        while (currentId && !visited.has(currentId)) {
            visited.add(currentId);
            const node = subtreeMap.get(currentId);
            if (!node) break;
            if (node.type === LocationType.ZONE) {
                return node.id;
            }
            if (node.id === rootLocationId) {
                return null;
            }
            currentId = node.parentId;
        }

        return null;
    }

    buildLocationPathFromSubtree(
        locationId: string,
        rootLocationId: string,
        subtreeMap: Map<string, SubtreeLocationNode>,
    ): string {
        const parts: string[] = [];
        const visited = new Set<string>();
        let currentId: string | null = locationId;

        while (currentId && !visited.has(currentId)) {
            visited.add(currentId);
            const node = subtreeMap.get(currentId);
            if (!node) break;
            if (node.id === rootLocationId) {
                if (parts.length === 0) {
                    parts.push(node.name);
                }
                break;
            }
            parts.push(node.name);
            currentId = node.parentId;
        }

        return parts.reverse().join(' / ');
    }

    private buildAvailableShelves(
        stockRows: Array<{ locationId: string; variantId: string; quantity: number }>,
        variantId: string,
        sourceLocationId: string,
        taskZoneId: string | null,
        suggestedLocationId: string | null,
        subtreeMap: Map<string, SubtreeLocationNode>,
    ): AvailableShelfOption[] {
        const options: AvailableShelfOption[] = [];

        for (const row of stockRows) {
            if (row.variantId !== variantId || row.quantity <= 0) {
                continue;
            }
            const node = subtreeMap.get(row.locationId);
            if (!node || !node.isActive) {
                continue;
            }
            const zoneId = this.resolveZoneIdFromSubtree(node.id, sourceLocationId, subtreeMap);
            const zoneName = zoneId ? (subtreeMap.get(zoneId)?.name ?? null) : null;
            const locationPath = this.buildLocationPathFromSubtree(
                node.id,
                sourceLocationId,
                subtreeMap,
            );
            options.push({
                locationId: node.id,
                locationName: node.name,
                locationPath,
                zoneId,
                zoneName,
                slotMode: node.slotMode,
                quantity: row.quantity,
                isInTaskZone: zoneId === taskZoneId,
            });
        }

        options.sort((a, b) => {
            if (a.isInTaskZone !== b.isInTaskZone) return a.isInTaskZone ? -1 : 1;
            const aSugg = a.locationId === suggestedLocationId ? 1 : 0;
            const bSugg = b.locationId === suggestedLocationId ? 1 : 0;
            if (aSugg !== bSugg) return bSugg - aSugg;
            const aDed = a.slotMode === SlotMode.DEDICATED ? 1 : 0;
            const bDed = b.slotMode === SlotMode.DEDICATED ? 1 : 0;
            if (aDed !== bDed) return bDed - aDed;
            if (a.quantity !== b.quantity) return b.quantity - a.quantity;
            return HU_COLLATOR.compare(a.locationPath, b.locationPath);
        });

        return options;
    }

    private async resolveVariantForPick(
        dto: PickItemDto,
        taskItems: Array<{ id: string; variantId: string }>,
    ) {
        if (dto.pickTaskItemId?.trim()) {
            const matched = taskItems.find((i) => i.id === dto.pickTaskItemId!.trim());
            if (!matched) {
                throw new NotFoundException(
                    'A megadott pickTaskItemId nem tartozik ehhez a kiszedési feladathoz',
                );
            }
            const variant = await this.prisma.variant.findUnique({
                where: { id: matched.variantId },
            });
            if (!variant) {
                throw new NotFoundException('A megadott termékvariáns nem található');
            }
            return variant;
        }

        const hasIdentifier = Boolean(
            dto.variantId?.trim() || dto.barcode?.trim() || dto.sku?.trim(),
        );
        if (!hasIdentifier) {
            throw new BadRequestException(
                'A termék azonosításához pickTaskItemId, variantId, barcode vagy sku megadása kötelező',
            );
        }

        if (dto.variantId?.trim()) {
            const variant = await this.prisma.variant.findUnique({
                where: { id: dto.variantId.trim() },
            });
            if (!variant) {
                throw new NotFoundException(
                    'A megadott variantId alapján termékvariáns nem található',
                );
            }
            return variant;
        }

        if (dto.barcode?.trim()) {
            const code = dto.barcode.trim();
            const candidates = getBarcodeSearchVariants(code);

            const exactBarcode = await this.prisma.variantBarcode.findFirst({
                where: { barcode: { in: candidates } },
                include: { variant: true },
            });
            if (exactBarcode?.variant) {
                return exactBarcode.variant;
            }

            const insensitiveBarcode = await this.prisma.variantBarcode.findFirst({
                where: {
                    OR: candidates.map((candidate) => ({
                        barcode: { equals: candidate, mode: 'insensitive' as const },
                    })),
                },
                include: { variant: true },
            });
            if (insensitiveBarcode?.variant) {
                return insensitiveBarcode.variant;
            }

            const bySkuFallback = await this.prisma.variant.findFirst({
                where: {
                    OR: candidates.map((candidate) => ({
                        sku: { equals: candidate, mode: 'insensitive' as const },
                    })),
                },
            });
            if (bySkuFallback) {
                return bySkuFallback;
            }

            throw new NotFoundException(`Nem található termékvariáns ezzel a vonalkóddal: ${code}`);
        }

        const sku = dto.sku!.trim();
        const skuCandidates = getBarcodeSearchVariants(sku);
        const bySku = await this.prisma.variant.findFirst({
            where: {
                OR: skuCandidates.map((candidate) => ({
                    sku: { equals: candidate, mode: 'insensitive' as const },
                })),
            },
        });
        if (bySku) {
            return bySku;
        }

        const barcodeFallback = await this.prisma.variantBarcode.findFirst({
            where: {
                OR: skuCandidates.map((candidate) => ({
                    barcode: { equals: candidate, mode: 'insensitive' as const },
                })),
            },
            include: { variant: true },
        });
        if (barcodeFallback?.variant) {
            return barcodeFallback.variant;
        }

        throw new NotFoundException(`Nem található termékvariáns ezzel a cikkszámmal (SKU): ${sku}`);
    }

    private async resolveShelfForPick(
        dto: PickItemDto,
        sourceLocationId: string,
        suggestedLocationId: string | null,
        user: AuthUser,
    ): Promise<SubtreeLocationNode> {
        const subtreeMap = await this.loadSubtreeLocations(this.prisma, sourceLocationId);

        let targetNode: SubtreeLocationNode | undefined;

        if (dto.locationId?.trim()) {
            targetNode = subtreeMap.get(dto.locationId.trim());
            if (!targetNode) {
                throw new BadRequestException(
                    'A megadott polc/helyszín nem a kiszedési feladat telephelyéhez tartozik',
                );
            }
        } else if (dto.locationName?.trim()) {
            const name = dto.locationName.trim();
            targetNode = Array.from(subtreeMap.values()).find(
                (loc) => loc.name.toLowerCase() === name.toLowerCase(),
            );
            if (!targetNode) {
                throw new NotFoundException(
                    `Nem található "${name}" nevű polc/helyszín a kiszedési feladat telephelyén belül`,
                );
            }
        } else if (suggestedLocationId) {
            targetNode = subtreeMap.get(suggestedLocationId);
        }

        if (!targetNode) {
            throw new BadRequestException(
                'A kiszedési polc/helyszín (locationId vagy locationName) megadása kötelező',
            );
        }

        if (!targetNode.isActive) {
            throw new BadRequestException('Inaktív polcról/helyszínről nem lehet kiszedni');
        }

        await this.locationAccessService.assertCanAccess(user, targetNode.id);
        return targetNode;
    }

    private async generateUniquePickTaskNumbersInTx(
        tx: Prisma.TransactionClient,
        count: number,
    ): Promise<string[]> {
        if (count <= 0) return [];

        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const datePrefix = `PK-${yyyy}${mm}${dd}-`;

        const lockKey = `pk-number-gen:${datePrefix}`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

        const latest = await tx.pickTask.findFirst({
            where: { taskNumber: { startsWith: datePrefix } },
            orderBy: { taskNumber: 'desc' },
            select: { taskNumber: true },
        });

        let nextSeq = 1;
        if (latest) {
            const suffix = latest.taskNumber.slice(datePrefix.length);
            const parsed = Number.parseInt(suffix, 10);
            if (!Number.isNaN(parsed) && parsed >= 1) {
                nextSeq = parsed + 1;
            }
        }

        const results: string[] = [];
        for (let i = 0; i < count; i++) {
            let candidate = `${datePrefix}${String(nextSeq).padStart(4, '0')}`;
            while (
                await tx.pickTask.findUnique({
                    where: { taskNumber: candidate },
                    select: { id: true },
                })
            ) {
                nextSeq += 1;
                candidate = `${datePrefix}${String(nextSeq).padStart(4, '0')}`;
            }
            results.push(candidate);
            nextSeq += 1;
        }

        return results;
    }

    private assertValidUuid(value: string, fieldName: string) {
        if (!UUID_REGEX.test(value)) {
            throw new BadRequestException(`Érvénytelen UUID paraméter (${fieldName}): ${value}`);
        }
    }

    private sanitizeVariant<
        T extends {
            costPrice?: unknown;
            lastPurchasePrice?: unknown;
            costCurrency?: unknown;
            lastPurchaseAt?: unknown;
        },
    >(variant: T, user: AuthUser) {
        if (canSeeCostPrice(user.role)) {
            return variant;
        }
        return excludeCostPrice(variant);
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

    private sanitizePickTask<
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
    >(task: T, user: AuthUser) {
        if (canSeeCostPrice(user.role)) {
            return task;
        }

        return {
            ...task,
            ...(task.items !== undefined
                ? {
                      items: task.items.map((item) => ({
                          ...item,
                          ...(item.variant ? { variant: excludeCostPrice(item.variant) } : {}),
                      })),
                  }
                : {}),
            ...(task.stockMovements !== undefined
                ? {
                      stockMovements: task.stockMovements.map((mv) =>
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
        salesOrder: {
            select: {
                id: true,
                orderNumber: true,
                externalOrderRef: true,
                channel: true,
                status: true,
                customerName: true,
                holdReason: true,
                note: true,
                createdAt: true,
            },
        },
        sourceLocation: true,
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
    } satisfies Prisma.PickTaskInclude;

    private readonly detailInclude = {
        ...this.listInclude,
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
    } satisfies Prisma.PickTaskInclude;
}
