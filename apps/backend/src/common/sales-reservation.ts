import { ConflictException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { LocationType, SalesOrderStatus } from '../generated/prisma/enums';

export const ACTIVE_RESERVATION_ORDER_STATUSES: SalesOrderStatus[] = [
    SalesOrderStatus.ON_HOLD,
    SalesOrderStatus.PENDING,
    SalesOrderStatus.PICKING,
    SalesOrderStatus.READY,
];

export interface SiteVariantAvailability {
    siteLocationId: string;
    variantId: string;
    totalQty: number;
    reservedQty: number;
    availableQty: number;
}

export async function acquireSiteVariantLocks(
    tx: Prisma.TransactionClient,
    pairs: Array<{ siteLocationId: string; variantId: string }>,
): Promise<void> {
    if (pairs.length === 0) {
        return;
    }

    const sortedKeys = Array.from(
        new Set(pairs.map((pair) => `${pair.siteLocationId}:${pair.variantId}`)),
    ).sort();

    for (const key of sortedKeys) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    }
}

export async function resolveRootSiteLocationId(
    tx: Prisma.TransactionClient,
    locationId: string,
): Promise<string> {
    const visited = new Set<string>();
    let currentId: string | null = locationId;
    let lastValidId = locationId;

    while (currentId && !visited.has(currentId)) {
        visited.add(currentId);
        const loc: { id: string; type: LocationType; parentId: string | null } | null =
            await tx.location.findUnique({
                where: { id: currentId },
                select: { id: true, type: true, parentId: true },
            });

        if (!loc) {
            break;
        }

        lastValidId = loc.id;
        if (loc.type === LocationType.WAREHOUSE || loc.type === LocationType.STORE) {
            return loc.id;
        }

        if (!loc.parentId) {
            return loc.id;
        }

        currentId = loc.parentId;
    }

    return lastValidId;
}

export async function getSubtreeLocationIds(
    tx: Prisma.TransactionClient,
    rootLocationId: string,
): Promise<string[]> {
    const visited = new Set<string>([rootLocationId]);
    let frontier: string[] = [rootLocationId];

    while (frontier.length > 0) {
        const children = await tx.location.findMany({
            where: { parentId: { in: frontier } },
            select: { id: true },
        });

        const nextFrontier: string[] = [];
        for (const child of children) {
            if (!visited.has(child.id)) {
                visited.add(child.id);
                nextFrontier.push(child.id);
            }
        }
        frontier = nextFrontier;
    }

    return Array.from(visited);
}

export async function getSiteVariantAvailability(
    tx: Prisma.TransactionClient,
    siteLocationId: string,
    variantIds: string[],
): Promise<Map<string, SiteVariantAvailability>> {
    const uniqueVariantIds = Array.from(new Set(variantIds));
    const result = new Map<string, SiteVariantAvailability>();

    if (uniqueVariantIds.length === 0) {
        return result;
    }

    const subtreeLocationIds = await getSubtreeLocationIds(tx, siteLocationId);

    const [stockSums, reservedSums] = await Promise.all([
        tx.stockItem.groupBy({
            by: ['variantId'],
            where: {
                locationId: { in: subtreeLocationIds },
                variantId: { in: uniqueVariantIds },
            },
            _sum: { quantity: true },
        }),
        tx.salesOrderItem.groupBy({
            by: ['variantId'],
            where: {
                variantId: { in: uniqueVariantIds },
                salesOrder: {
                    sourceLocationId: siteLocationId,
                    status: { in: ACTIVE_RESERVATION_ORDER_STATUSES },
                },
            },
            _sum: { reservedQuantity: true },
        }),
    ]);

    const totalByVariant = new Map<string, number>();
    for (const row of stockSums) {
        totalByVariant.set(row.variantId, row._sum.quantity ?? 0);
    }

    const reservedByVariant = new Map<string, number>();
    for (const row of reservedSums) {
        reservedByVariant.set(row.variantId, row._sum.reservedQuantity ?? 0);
    }

    for (const variantId of uniqueVariantIds) {
        const totalQty = totalByVariant.get(variantId) ?? 0;
        const reservedQty = reservedByVariant.get(variantId) ?? 0;
        result.set(variantId, {
            siteLocationId,
            variantId,
            totalQty,
            reservedQty,
            availableQty: totalQty - reservedQty,
        });
    }

    return result;
}

export async function assertSiteStockCanDecrease(
    tx: Prisma.TransactionClient,
    locationId: string,
    variantId: string,
    decreaseQty: number,
): Promise<void> {
    if (decreaseQty <= 0) {
        return;
    }

    const siteLocationId = await resolveRootSiteLocationId(tx, locationId);
    await acquireSiteVariantLocks(tx, [{ siteLocationId, variantId }]);

    const availabilityMap = await getSiteVariantAvailability(tx, siteLocationId, [variantId]);
    const availability = availabilityMap.get(variantId) ?? {
        siteLocationId,
        variantId,
        totalQty: 0,
        reservedQty: 0,
        availableQty: 0,
    };

    if (decreaseQty > availability.availableQty) {
        throw new ConflictException(
            `A készlet nem csökkenthető ${decreaseQty} db-bal, mert az aktív vevői rendelések foglalása alá esne ` +
                `(összes telephelyi készlet: ${availability.totalQty} db, aktív foglalás: ${availability.reservedQty} db, szabad készlet: ${availability.availableQty} db).`,
        );
    }
}
