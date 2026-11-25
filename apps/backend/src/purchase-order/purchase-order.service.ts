import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { AuthUser } from '../auth/decorators/current-user.decorator';
import {
    buildVariantBarcodeOrClauses,
    buildVariantSkuOrClauses,
    buildVariantSupplierSkuOrClauses,
} from '../common/barcode-search';
import { Prisma } from '../generated/prisma/client';
import { GoodsReceiptStatus, PurchaseOrderStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { ConfirmPurchaseOrderDto } from './dto/confirm-purchase-order.dto';
import { CreatePurchaseOrderDto, CreatePurchaseOrderItemDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';

export interface FindPurchaseOrdersOptions {
    skip?: number;
    take?: number;
    status?: string;
    supplierId?: string;
    search?: string;
}

const PO_LIST_INCLUDE = {
    supplier: true,
    createdByUser: {
        select: { id: true, name: true, email: true, role: true },
    },
    items: {
        select: {
            id: true,
            variantId: true,
            orderedQuantity: true,
            confirmedQuantity: true,
            receivedQuantity: true,
            unitCost: true,
        },
        orderBy: { createdAt: 'asc' as const },
    },
    goodsReceipts: {
        select: {
            id: true,
            receiptNumber: true,
            status: true,
            targetLocationId: true,
            completedAt: true,
            createdAt: true,
        },
        orderBy: { createdAt: 'desc' as const },
    },
    _count: {
        select: { items: true, goodsReceipts: true },
    },
} satisfies Prisma.PurchaseOrderInclude;

const PO_DETAIL_INCLUDE = {
    supplier: true,
    createdByUser: {
        select: { id: true, name: true, email: true, role: true },
    },
    items: {
        include: {
            variant: {
                include: {
                    product: true,
                    variantBarcodes: {
                        orderBy: [{ isPrimary: 'desc' as const }, { createdAt: 'asc' as const }],
                    },
                },
            },
        },
        orderBy: { createdAt: 'asc' as const },
    },
    goodsReceipts: {
        select: {
            id: true,
            receiptNumber: true,
            status: true,
            targetLocationId: true,
            targetLocation: {
                select: { id: true, name: true, type: true },
            },
            invoiceNumber: true,
            createdByUser: {
                select: { id: true, name: true, email: true, role: true },
            },
            approvedByUser: {
                select: { id: true, name: true, email: true, role: true },
            },
            approvedAt: true,
            completedAt: true,
            createdAt: true,
            _count: { select: { items: true } },
        },
        orderBy: { createdAt: 'desc' as const },
    },
    _count: {
        select: { items: true, goodsReceipts: true },
    },
} satisfies Prisma.PurchaseOrderInclude;

@Injectable()
export class PurchaseOrderService {
    constructor(private readonly prisma: PrismaService) {}

    private normalizeNullableText(value: string | null | undefined): string | null | undefined {
        if (value === undefined) return undefined;
        if (value === null) return null;
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
    }

    private parseDateInput(value: string | null | undefined): Date | null | undefined {
        if (value === undefined) return undefined;
        if (value === null) return null;
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
            throw new BadRequestException('Érvénytelen dátumformátum');
        }
        return parsed;
    }

    private async assertSupplierExists(supplierId: string): Promise<void> {
        const supplier = await this.prisma.supplier.findUnique({
            where: { id: supplierId },
            select: { id: true },
        });
        if (!supplier) {
            throw new NotFoundException('A megadott beszállító nem található');
        }
    }

    private async validateOrderItems(items: CreatePurchaseOrderItemDto[]): Promise<void> {
        if (items.length === 0) return;

        const seenVariantIds = new Set<string>();
        for (const item of items) {
            if (seenVariantIds.has(item.variantId)) {
                throw new BadRequestException(
                    'Egy variáns csak egyszer szerepelhet a beszerzési rendelés tételei között',
                );
            }
            seenVariantIds.add(item.variantId);
        }

        const variantIds = Array.from(seenVariantIds);
        const existingVariants = await this.prisma.variant.findMany({
            where: { id: { in: variantIds } },
            select: { id: true },
        });

        if (existingVariants.length !== variantIds.length) {
            const foundIds = new Set(existingVariants.map((v) => v.id));
            const missingIds = variantIds.filter((id) => !foundIds.has(id));
            throw new NotFoundException(
                `Egy vagy több megadott variáns nem található: ${missingIds.join(', ')}`,
            );
        }
    }

    private async generateNextOrderNumber(tx: Prisma.TransactionClient): Promise<string> {
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const prefix = `PO-${yyyy}${mm}${dd}-`;

        const latest = await tx.purchaseOrder.findFirst({
            where: { orderNumber: { startsWith: prefix } },
            orderBy: { orderNumber: 'desc' },
            select: { orderNumber: true },
        });

        let nextSeq = 1;
        if (latest?.orderNumber) {
            const suffix = latest.orderNumber.slice(prefix.length);
            const parsed = Number.parseInt(suffix, 10);
            if (Number.isFinite(parsed) && parsed >= 1) {
                nextSeq = parsed + 1;
            }
        }

        return `${prefix}${String(nextSeq).padStart(4, '0')}`;
    }

    async findAll(options?: FindPurchaseOrdersOptions) {
        const skip =
            options?.skip !== undefined && Number.isFinite(options.skip) && options.skip >= 0
                ? Math.floor(options.skip)
                : undefined;
        const take =
            options?.take !== undefined && Number.isFinite(options.take) && options.take > 0
                ? Math.min(Math.floor(options.take), 200)
                : undefined;

        const rawStatus = options?.status?.trim();
        let status: PurchaseOrderStatus | undefined;
        if (rawStatus) {
            if (!Object.values(PurchaseOrderStatus).includes(rawStatus as PurchaseOrderStatus)) {
                throw new BadRequestException(`Érvénytelen beszerzési rendelés státusz: ${rawStatus}`);
            }
            status = rawStatus as PurchaseOrderStatus;
        }

        const supplierId = options?.supplierId?.trim() || undefined;
        const q = options?.search?.trim();

        const where: Prisma.PurchaseOrderWhereInput = {
            ...(status ? { status } : {}),
            ...(supplierId ? { supplierId } : {}),
            ...(q
                ? {
                      OR: [
                          { orderNumber: { contains: q, mode: 'insensitive' } },
                          { supplierReference: { contains: q, mode: 'insensitive' } },
                          { supplier: { name: { contains: q, mode: 'insensitive' } } },
                          {
                              items: {
                                  some: {
                                      variant: {
                                          OR: [
                                              ...buildVariantSkuOrClauses(q),
                                              ...buildVariantBarcodeOrClauses(q),
                                              ...buildVariantSupplierSkuOrClauses(q),
                                              {
                                                  product: {
                                                      name: { contains: q, mode: 'insensitive' },
                                                  },
                                              },
                                              {
                                                  product: {
                                                      manufacturerCode: {
                                                          contains: q,
                                                          mode: 'insensitive',
                                                      },
                                                  },
                                              },
                                          ],
                                      },
                                  },
                              },
                          },
                      ],
                  }
                : {}),
        };

        const [items, total] = await this.prisma.$transaction([
            this.prisma.purchaseOrder.findMany({
                where,
                include: PO_LIST_INCLUDE,
                ...(skip !== undefined ? { skip } : {}),
                ...(take !== undefined ? { take } : {}),
                orderBy: { createdAt: 'desc' },
            }),
            this.prisma.purchaseOrder.count({ where }),
        ]);

        return { items, total };
    }

    async findOne(id: string) {
        const purchaseOrder = await this.prisma.purchaseOrder.findUnique({
            where: { id },
            include: PO_DETAIL_INCLUDE,
        });

        if (!purchaseOrder) {
            throw new NotFoundException('A beszerzési rendelés nem található');
        }

        return purchaseOrder;
    }

    async create(dto: CreatePurchaseOrderDto, user: AuthUser) {
        await this.assertSupplierExists(dto.supplierId);
        const items = dto.items ?? [];
        await this.validateOrderItems(items);

        const currency = dto.currency?.trim().toUpperCase() || 'HUF';
        const exchangeRate = dto.exchangeRate ?? 1;
        const expectedDeliveryDate = this.parseDateInput(dto.expectedDeliveryDate) ?? null;
        const supplierReference = this.normalizeNullableText(dto.supplierReference) ?? null;
        const note = this.normalizeNullableText(dto.note) ?? null;

        const maxAttempts = 5;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await this.prisma.$transaction(async (tx) => {
                    const orderNumber = await this.generateNextOrderNumber(tx);

                    return tx.purchaseOrder.create({
                        data: {
                            orderNumber,
                            supplierId: dto.supplierId,
                            status: PurchaseOrderStatus.DRAFT,
                            currency,
                            exchangeRate,
                            supplierReference,
                            expectedDeliveryDate,
                            note,
                            createdByUserId: user.userId,
                            ...(items.length > 0
                                ? {
                                      items: {
                                          create: items.map((item) => ({
                                              variantId: item.variantId,
                                              orderedQuantity: item.orderedQuantity,
                                              unitCost: item.unitCost,
                                              note: this.normalizeNullableText(item.note) ?? null,
                                          })),
                                      },
                                  }
                                : {}),
                        },
                        include: PO_DETAIL_INCLUDE,
                    });
                });
            } catch (error) {
                const isOrderNumberCollision =
                    error instanceof Prisma.PrismaClientKnownRequestError &&
                    error.code === 'P2002';
                if (!isOrderNumberCollision || attempt === maxAttempts) {
                    throw error;
                }
            }
        }

        throw new ConflictException('Nem sikerült egyedi rendelésszámot generálni');
    }

    async update(id: string, dto: UpdatePurchaseOrderDto) {
        const existing = await this.prisma.purchaseOrder.findUnique({
            where: { id },
            select: { id: true, status: true },
        });

        if (!existing) {
            throw new NotFoundException('A beszerzési rendelés nem található');
        }

        if (existing.status === PurchaseOrderStatus.DRAFT) {
            if (dto.supplierId !== undefined) {
                await this.assertSupplierExists(dto.supplierId);
            }
            if (dto.items !== undefined) {
                await this.validateOrderItems(dto.items);
            }

            const expectedDeliveryDate = this.parseDateInput(dto.expectedDeliveryDate);
            const supplierReference = this.normalizeNullableText(dto.supplierReference);
            const note = this.normalizeNullableText(dto.note);
            const currency =
                dto.currency !== undefined ? dto.currency.trim().toUpperCase() || 'HUF' : undefined;

            return this.prisma.$transaction(async (tx) => {
                if (dto.items !== undefined) {
                    await tx.purchaseOrderItem.deleteMany({
                        where: { purchaseOrderId: id },
                    });

                    if (dto.items.length > 0) {
                        await tx.purchaseOrderItem.createMany({
                            data: dto.items.map((item) => ({
                                purchaseOrderId: id,
                                variantId: item.variantId,
                                orderedQuantity: item.orderedQuantity,
                                unitCost: item.unitCost,
                                note: this.normalizeNullableText(item.note) ?? null,
                            })),
                        });
                    }
                }

                return tx.purchaseOrder.update({
                    where: { id },
                    data: {
                        ...(dto.supplierId !== undefined ? { supplierId: dto.supplierId } : {}),
                        ...(currency !== undefined ? { currency } : {}),
                        ...(dto.exchangeRate !== undefined
                            ? { exchangeRate: dto.exchangeRate }
                            : {}),
                        ...(supplierReference !== undefined ? { supplierReference } : {}),
                        ...(expectedDeliveryDate !== undefined ? { expectedDeliveryDate } : {}),
                        ...(note !== undefined ? { note } : {}),
                    },
                    include: PO_DETAIL_INCLUDE,
                });
            });
        }

        if (
            existing.status === PurchaseOrderStatus.ORDERED ||
            existing.status === PurchaseOrderStatus.CONFIRMED
        ) {
            if (
                dto.items !== undefined ||
                dto.supplierId !== undefined ||
                dto.currency !== undefined ||
                dto.exchangeRate !== undefined
            ) {
                throw new BadRequestException(
                    'Megrendelt vagy visszaigazolt rendelésnél a tételek, a beszállító, a pénznem és az árfolyam már nem módosítható',
                );
            }

            const expectedDeliveryDate = this.parseDateInput(dto.expectedDeliveryDate);
            const supplierReference = this.normalizeNullableText(dto.supplierReference);
            const note = this.normalizeNullableText(dto.note);

            return this.prisma.purchaseOrder.update({
                where: { id },
                data: {
                    ...(supplierReference !== undefined ? { supplierReference } : {}),
                    ...(expectedDeliveryDate !== undefined ? { expectedDeliveryDate } : {}),
                    ...(note !== undefined ? { note } : {}),
                },
                include: PO_DETAIL_INCLUDE,
            });
        }

        throw new BadRequestException(
            `Ebben a státuszban (${existing.status}) a beszerzési rendelés már nem szerkeszthető`,
        );
    }

    async order(id: string) {
        const existing = await this.prisma.purchaseOrder.findUnique({
            where: { id },
            include: { items: { select: { id: true } } },
        });

        if (!existing) {
            throw new NotFoundException('A beszerzési rendelés nem található');
        }

        if (existing.status !== PurchaseOrderStatus.DRAFT) {
            throw new BadRequestException('Csak DRAFT státuszú beszerzési rendelés adható fel');
        }

        if (existing.items.length === 0) {
            throw new BadRequestException('Legalább 1 tétel kötelező a rendelés feladásához');
        }

        return this.prisma.purchaseOrder.update({
            where: { id },
            data: {
                status: PurchaseOrderStatus.ORDERED,
                orderedAt: new Date(),
            },
            include: PO_DETAIL_INCLUDE,
        });
    }

    async confirm(id: string, dto: ConfirmPurchaseOrderDto) {
        const existing = await this.prisma.purchaseOrder.findUnique({
            where: { id },
            include: { items: true },
        });

        if (!existing) {
            throw new NotFoundException('A beszerzési rendelés nem található');
        }

        if (
            existing.status !== PurchaseOrderStatus.ORDERED &&
            existing.status !== PurchaseOrderStatus.CONFIRMED
        ) {
            throw new BadRequestException(
                'Csak ORDERED vagy CONFIRMED státuszú beszerzési rendelés igazolható vissza',
            );
        }

        const itemById = new Map(existing.items.map((item) => [item.id, item]));
        const itemByVariantId = new Map(existing.items.map((item) => [item.variantId, item]));
        const resolvedUpdates: Array<{
            id: string;
            confirmedQuantity: number;
            unitCost?: number;
            note?: string | null;
        }> = [];
        const seenItemIds = new Set<string>();

        for (const entry of dto.items ?? []) {
            if (!entry.itemId && !entry.variantId) {
                throw new BadRequestException(
                    'A tétel visszaigazolásához itemId vagy variantId megadása kötelező',
                );
            }

            let target = entry.itemId
                ? itemById.get(entry.itemId)
                : itemByVariantId.get(entry.variantId!);

            if (!target) {
                throw new NotFoundException(
                    'A megadott tétel nem található ezen a beszerzési rendelésen',
                );
            }

            if (entry.itemId && entry.variantId && target.variantId !== entry.variantId) {
                throw new BadRequestException(
                    'Az itemId és a variantId nem egyezik meg ugyanazzal a tétellel',
                );
            }

            if (seenItemIds.has(target.id)) {
                throw new BadRequestException(
                    'Ugyanaz a tétel csak egyszer szerepelhet a visszaigazolásban',
                );
            }
            seenItemIds.add(target.id);

            resolvedUpdates.push({
                id: target.id,
                confirmedQuantity: entry.confirmedQuantity,
                unitCost: entry.unitCost,
                note: this.normalizeNullableText(entry.note),
            });
        }

        const expectedDeliveryDate = this.parseDateInput(dto.expectedDeliveryDate);
        const supplierReference = this.normalizeNullableText(dto.supplierReference);
        const note = this.normalizeNullableText(dto.note);

        return this.prisma.$transaction(async (tx) => {
            for (const updateItem of resolvedUpdates) {
                await tx.purchaseOrderItem.update({
                    where: { id: updateItem.id },
                    data: {
                        confirmedQuantity: updateItem.confirmedQuantity,
                        ...(updateItem.unitCost !== undefined
                            ? { unitCost: updateItem.unitCost }
                            : {}),
                        ...(updateItem.note !== undefined ? { note: updateItem.note } : {}),
                    },
                });
            }

            return tx.purchaseOrder.update({
                where: { id },
                data: {
                    status: PurchaseOrderStatus.CONFIRMED,
                    confirmedAt: new Date(),
                    ...(expectedDeliveryDate !== undefined ? { expectedDeliveryDate } : {}),
                    ...(supplierReference !== undefined ? { supplierReference } : {}),
                    ...(note !== undefined ? { note } : {}),
                },
                include: PO_DETAIL_INCLUDE,
            });
        });
    }

    async close(id: string) {
        return this.prisma.$transaction(async (tx) => {
            const existing = await tx.purchaseOrder.findUnique({
                where: { id },
                select: { id: true, status: true },
            });

            if (!existing) {
                throw new NotFoundException('A beszerzési rendelés nem található');
            }

            if (
                existing.status !== PurchaseOrderStatus.CONFIRMED &&
                existing.status !== PurchaseOrderStatus.PARTIALLY_RECEIVED
            ) {
                throw new BadRequestException(
                    'Csak CONFIRMED vagy PARTIALLY_RECEIVED státuszú rendelés zárható le',
                );
            }

            const openReceipt = await tx.goodsReceipt.findFirst({
                where: {
                    purchaseOrderId: id,
                    status: {
                        notIn: [GoodsReceiptStatus.COMPLETED, GoodsReceiptStatus.CANCELLED],
                    },
                },
                select: { id: true, receiptNumber: true, status: true },
            });

            if (openReceipt) {
                throw new ConflictException(
                    `A beszerzési rendelés nem zárható le, mert van még nem lezárt áruátvételi bizonylat (${openReceipt.receiptNumber})`,
                );
            }

            return tx.purchaseOrder.update({
                where: { id },
                data: { status: PurchaseOrderStatus.CLOSED },
                include: PO_DETAIL_INCLUDE,
            });
        });
    }

    async cancel(id: string) {
        return this.prisma.$transaction(async (tx) => {
            const existing = await tx.purchaseOrder.findUnique({
                where: { id },
                select: { id: true, status: true },
            });

            if (!existing) {
                throw new NotFoundException('A beszerzési rendelés nem található');
            }

            if (
                existing.status !== PurchaseOrderStatus.DRAFT &&
                existing.status !== PurchaseOrderStatus.ORDERED &&
                existing.status !== PurchaseOrderStatus.CONFIRMED
            ) {
                throw new BadRequestException(
                    'Csak DRAFT, ORDERED vagy CONFIRMED státuszú beszerzési rendelés mondható le',
                );
            }

            const activeReceipt = await tx.goodsReceipt.findFirst({
                where: {
                    purchaseOrderId: id,
                    status: { not: GoodsReceiptStatus.CANCELLED },
                },
                select: { id: true, receiptNumber: true, status: true },
            });

            if (activeReceipt) {
                throw new ConflictException(
                    `A beszerzési rendelés nem mondható le, mert tartozik hozzá nem sztornózott áruátvételi bizonylat (${activeReceipt.receiptNumber})`,
                );
            }

            return tx.purchaseOrder.update({
                where: { id },
                data: { status: PurchaseOrderStatus.CANCELLED },
                include: PO_DETAIL_INCLUDE,
            });
        });
    }
}
