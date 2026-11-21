import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { AuthUser } from '../auth/decorators/current-user.decorator';
import {
    canSeeCostPrice,
    excludeCostFields,
    excludeCostPrice,
    excludeUnitCostHuf,
} from '../common/cost-price';
import {
    GoodsReceiptStatus,
    MovementType,
    PurchaseOrderStatus,
    Role,
    SlotMode,
} from '../generated/prisma/enums';
import { Prisma } from '../generated/prisma/client';
import { LocationAccessService } from '../location/location-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { AddGoodsReceiptItemDto } from './dto/add-goods-receipt-item.dto';
import { ApproveGoodsReceiptDto } from './dto/approve-goods-receipt.dto';
import { CreateGoodsReceiptDto } from './dto/create-goods-receipt.dto';
import { PutawayDto } from './dto/putaway.dto';

export interface FindGoodsReceiptsOptions {
    status?: GoodsReceiptStatus;
    locationId?: string;
    purchaseOrderId?: string;
    supplierId?: string;
    search?: string;
    skip?: number;
    take?: number;
}

const ALLOWED_PO_STATUSES_FOR_RECEIPT: readonly PurchaseOrderStatus[] = [
    PurchaseOrderStatus.ORDERED,
    PurchaseOrderStatus.CONFIRMED,
    PurchaseOrderStatus.PARTIALLY_RECEIVED,
];

const STAFF_SELF_UNDO_ONLY_ROLES: readonly Role[] = [
    Role.WAREHOUSE_STAFF,
    Role.STORE_STAFF,
];

@Injectable()
export class GoodsReceiptService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly locationAccessService: LocationAccessService,
    ) {}

    async findAll(user: AuthUser, options?: FindGoodsReceiptsOptions) {
        if (options?.locationId) {
            await this.locationAccessService.assertCanAccess(user, options.locationId);
        }

        const locationWhere = options?.locationId
            ? this.buildSubtreeLocationWhere(options.locationId)
            : await this.locationAccessService.accessibleWhere(user);

        const q = options?.search?.trim();
        const skip = options?.skip !== undefined && !Number.isNaN(options.skip) ? Math.max(0, options.skip) : 0;
        const take =
            options?.take !== undefined && !Number.isNaN(options.take)
                ? Math.min(200, Math.max(1, options.take))
                : 50;

        const where: Prisma.GoodsReceiptWhereInput = {
            targetLocation: locationWhere,
            ...(options?.status ? { status: options.status } : {}),
            ...(options?.purchaseOrderId ? { purchaseOrderId: options.purchaseOrderId } : {}),
            ...(options?.supplierId ? { supplierId: options.supplierId } : {}),
            ...(q
                ? {
                      OR: [
                          { receiptNumber: { contains: q, mode: 'insensitive' } },
                          { invoiceNumber: { contains: q, mode: 'insensitive' } },
                          { note: { contains: q, mode: 'insensitive' } },
                          { purchaseOrder: { orderNumber: { contains: q, mode: 'insensitive' } } },
                          { supplier: { name: { contains: q, mode: 'insensitive' } } },
                          {
                              items: {
                                  some: {
                                      OR: [
                                          { variant: { sku: { contains: q, mode: 'insensitive' } } },
                                          {
                                              variant: {
                                                  product: { name: { contains: q, mode: 'insensitive' } },
                                              },
                                          },
                                          {
                                              variant: {
                                                  product: {
                                                      manufacturerCode: { contains: q, mode: 'insensitive' },
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
            this.prisma.goodsReceipt.findMany({
                where,
                include: this.listInclude,
                skip,
                take,
                orderBy: { createdAt: 'desc' },
            }),
            this.prisma.goodsReceipt.count({ where }),
        ]);

        const items = rawItems.map((receipt) => this.sanitizeReceipt(receipt, user));
        return { items, total };
    }

    async findOne(id: string, user: AuthUser) {
        const receipt = await this.prisma.goodsReceipt.findUnique({
            where: { id },
            include: this.detailInclude,
        });

        if (!receipt) {
            throw new NotFoundException('A keresett bevételezés nem található');
        }

        await this.locationAccessService.assertCanAccess(user, receipt.targetLocationId);
        return this.sanitizeReceipt(receipt, user);
    }

    async create(dto: CreateGoodsReceiptDto, user: AuthUser) {
        await this.locationAccessService.assertCanAccess(user, dto.targetLocationId);

        const targetLocation = await this.prisma.location.findUnique({
            where: { id: dto.targetLocationId },
        });
        if (!targetLocation) {
            throw new NotFoundException('A megadott célhelyszín nem található');
        }
        if (!targetLocation.isActive) {
            throw new BadRequestException('Inaktív helyszínre nem indítható bevételezés');
        }

        let resolvedSupplierId = dto.supplierId ?? null;
        let resolvedCurrency = dto.currency ? dto.currency.trim().toUpperCase() : 'HUF';
        let resolvedExchangeRate = dto.exchangeRate ?? 1;

        const poItemsByVariantId = new Map<
            string,
            {
                id: string;
                variantId: string;
                orderedQuantity: number;
                confirmedQuantity: number | null;
                receivedQuantity: number;
                unitCost: Prisma.Decimal;
            }
        >();

        if (dto.purchaseOrderId) {
            const po = await this.prisma.purchaseOrder.findUnique({
                where: { id: dto.purchaseOrderId },
                include: { items: true },
            });
            if (!po) {
                throw new NotFoundException('A megadott beszerzési rendelés (PO) nem található');
            }
            if (!ALLOWED_PO_STATUSES_FOR_RECEIPT.includes(po.status)) {
                throw new BadRequestException(
                    `Csak ORDERED, CONFIRMED vagy PARTIALLY_RECEIVED státuszú megrendeléshez indítható bevételezés (jelenlegi: ${po.status})`,
                );
            }
            if (dto.supplierId && dto.supplierId !== po.supplierId) {
                throw new BadRequestException(
                    'A megadott beszállító nem egyezik a beszerzési rendelés beszállítójával',
                );
            }
            resolvedSupplierId = po.supplierId;
            if (!dto.currency) {
                resolvedCurrency = po.currency;
            }
            if (dto.exchangeRate === undefined) {
                resolvedExchangeRate = Number(po.exchangeRate);
            }
            for (const poItem of po.items) {
                poItemsByVariantId.set(poItem.variantId, poItem);
            }
        }

        if (resolvedSupplierId) {
            const supplier = await this.prisma.supplier.findUnique({
                where: { id: resolvedSupplierId },
                select: { id: true },
            });
            if (!supplier) {
                throw new NotFoundException('A megadott beszállító nem található');
            }
        }

        const inputItems =
            dto.items && dto.items.length > 0
                ? dto.items
                : dto.purchaseOrderId
                  ? Array.from(poItemsByVariantId.values())
                        .map((poItem) => {
                            const targetQty = poItem.confirmedQuantity ?? poItem.orderedQuantity;
                            const remaining = Math.max(0, targetQty - poItem.receivedQuantity);
                            return {
                                variantId: poItem.variantId,
                                purchaseOrderItemId: poItem.id,
                                expectedQuantity: remaining > 0 ? remaining : targetQty,
                                unitCost: Number(poItem.unitCost),
                                expectedLocationId: undefined,
                                note: undefined,
                            };
                        })
                        .filter((item) => item.expectedQuantity > 0)
                  : [];

        const seenVariantIds = new Set<string>();
        for (const item of inputItems) {
            if (seenVariantIds.has(item.variantId)) {
                throw new BadRequestException(
                    `Duplikált variáns a bevételezési tételek között: ${item.variantId}`,
                );
            }
            seenVariantIds.add(item.variantId);
        }

        if (seenVariantIds.size > 0) {
            const existingVariants = await this.prisma.variant.findMany({
                where: { id: { in: Array.from(seenVariantIds) } },
                select: { id: true },
            });
            if (existingVariants.length !== seenVariantIds.size) {
                throw new NotFoundException('Egy vagy több megadott termékvariáns nem található');
            }
        }

        for (const item of inputItems) {
            if (item.expectedLocationId) {
                await this.validateShelfLocation(item.expectedLocationId, dto.targetLocationId, user);
            }
        }

        const preparedItems = inputItems.map((item) => {
            const matchingPoItem = poItemsByVariantId.get(item.variantId);
            if (
                item.purchaseOrderItemId &&
                (!matchingPoItem || matchingPoItem.id !== item.purchaseOrderItemId)
            ) {
                throw new BadRequestException(
                    `A megadott purchaseOrderItemId (${item.purchaseOrderItemId}) nem tartozik a kiválasztott megrendeléshez és variánshoz`,
                );
            }
            const unitCost = this.round2(item.unitCost);
            const unitCostHuf = this.round2(unitCost * resolvedExchangeRate);

            return {
                variantId: item.variantId,
                purchaseOrderItemId: item.purchaseOrderItemId ?? matchingPoItem?.id ?? null,
                expectedQuantity: item.expectedQuantity,
                receivedQuantity: 0,
                unitCost,
                unitCostHuf,
                expectedLocationId: item.expectedLocationId ?? null,
                isUnexpected: false,
                note: item.note?.trim() || null,
            };
        });

        const receiptNumber = await this.generateUniqueReceiptNumber();

        const created = await this.prisma.goodsReceipt.create({
            data: {
                receiptNumber,
                purchaseOrderId: dto.purchaseOrderId ?? null,
                supplierId: resolvedSupplierId,
                targetLocationId: dto.targetLocationId,
                invoiceNumber: dto.invoiceNumber?.trim() || null,
                currency: resolvedCurrency,
                exchangeRate: resolvedExchangeRate,
                status: GoodsReceiptStatus.OPEN,
                note: dto.note?.trim() || null,
                createdByUserId: user.userId,
                ...(preparedItems.length > 0
                    ? {
                          items: {
                              create: preparedItems,
                          },
                      }
                    : {}),
            },
            include: this.detailInclude,
        });

        return this.sanitizeReceipt(created, user);
    }

    async addOrUpdateItem(id: string, dto: AddGoodsReceiptItemDto, user: AuthUser) {
        const receipt = await this.prisma.goodsReceipt.findUnique({
            where: { id },
        });
        if (!receipt) {
            throw new NotFoundException('A keresett bevételezés nem található');
        }

        await this.locationAccessService.assertCanAccess(user, receipt.targetLocationId);

        if (
            receipt.status !== GoodsReceiptStatus.OPEN &&
            receipt.status !== GoodsReceiptStatus.IN_PROGRESS
        ) {
            throw new BadRequestException(
                'Tétel hozzáadása vagy módosítása csak OPEN vagy IN_PROGRESS státuszú bevételezésnél engedélyezett',
            );
        }

        const variant = await this.prisma.variant.findUnique({
            where: { id: dto.variantId },
            select: { id: true },
        });
        if (!variant) {
            throw new NotFoundException('A megadott termékvariáns nem található');
        }

        if (dto.expectedLocationId) {
            await this.validateShelfLocation(dto.expectedLocationId, receipt.targetLocationId, user);
        }

        let resolvedPoItemId: string | null = dto.purchaseOrderItemId ?? null;
        if (receipt.purchaseOrderId) {
            const poItem = await this.prisma.purchaseOrderItem.findUnique({
                where: {
                    purchaseOrderId_variantId: {
                        purchaseOrderId: receipt.purchaseOrderId,
                        variantId: dto.variantId,
                    },
                },
            });
            if (dto.purchaseOrderItemId && (!poItem || poItem.id !== dto.purchaseOrderItemId)) {
                throw new BadRequestException(
                    'A megadott purchaseOrderItemId nem tartozik a bevételezés megrendeléséhez és a variánshoz',
                );
            }
            if (!resolvedPoItemId && poItem) {
                resolvedPoItemId = poItem.id;
            }
        } else if (dto.purchaseOrderItemId) {
            throw new BadRequestException(
                'A bevételezéshez nincs beszerzési rendelés (PO) rendelve, így purchaseOrderItemId nem adható meg',
            );
        }

        const unitCost = this.round2(dto.unitCost);
        const unitCostHuf = this.round2(unitCost * Number(receipt.exchangeRate));

        await this.prisma.$transaction(async (tx) => {
            await tx.goodsReceiptItem.upsert({
                where: {
                    goodsReceiptId_variantId: {
                        goodsReceiptId: id,
                        variantId: dto.variantId,
                    },
                },
                create: {
                    goodsReceiptId: id,
                    purchaseOrderItemId: resolvedPoItemId,
                    variantId: dto.variantId,
                    expectedQuantity: dto.expectedQuantity,
                    receivedQuantity: 0,
                    unitCost,
                    unitCostHuf,
                    expectedLocationId: dto.expectedLocationId ?? null,
                    isUnexpected: false,
                    note: dto.note?.trim() || null,
                },
                update: {
                    purchaseOrderItemId: resolvedPoItemId,
                    expectedQuantity: dto.expectedQuantity,
                    unitCost,
                    unitCostHuf,
                    ...(dto.expectedLocationId !== undefined
                        ? { expectedLocationId: dto.expectedLocationId || null }
                        : {}),
                    isUnexpected: false,
                    ...(dto.note !== undefined ? { note: dto.note.trim() || null } : {}),
                },
            });

            await tx.stockMovement.updateMany({
                where: {
                    goodsReceiptId: id,
                    variantId: dto.variantId,
                },
                data: {
                    unitCostHuf,
                },
            });
        });

        return this.findOne(id, user);
    }

    async start(id: string, user: AuthUser) {
        const receipt = await this.prisma.goodsReceipt.findUnique({
            where: { id },
        });
        if (!receipt) {
            throw new NotFoundException('A keresett bevételezés nem található');
        }

        await this.locationAccessService.assertCanAccess(user, receipt.targetLocationId);

        if (receipt.status === GoodsReceiptStatus.IN_PROGRESS) {
            return this.findOne(id, user);
        }

        if (receipt.status !== GoodsReceiptStatus.OPEN) {
            throw new BadRequestException(
                `A bevételezés nem indítható el ebben a státuszban: ${receipt.status}`,
            );
        }

        await this.prisma.goodsReceipt.update({
            where: { id },
            data: { status: GoodsReceiptStatus.IN_PROGRESS },
        });

        return this.findOne(id, user);
    }

    /**
     * Párhuzamos PC + PDA elrakás (putaway).
     * KIZÁRÓLAG StockItem + StockMovement + GoodsReceiptItem.receivedQuantity frissítést végez egy $transaction-ben.
     * SOHA nem számol újra Variant.costPrice-t, nem frissít VariantMonthlyStat-ot és nem zár PO-t!
     */
    async putaway(id: string, dto: PutawayDto, user: AuthUser) {
        const receipt = await this.prisma.goodsReceipt.findUnique({
            where: { id },
            include: { items: true },
        });
        if (!receipt) {
            throw new NotFoundException('A keresett bevételezés nem található');
        }

        await this.locationAccessService.assertCanAccess(user, receipt.targetLocationId);

        if (
            receipt.status !== GoodsReceiptStatus.OPEN &&
            receipt.status !== GoodsReceiptStatus.IN_PROGRESS
        ) {
            throw new BadRequestException(
                `Elrakás (putaway) csak OPEN vagy IN_PROGRESS státuszú bevételezésnél engedélyezett (jelenlegi: ${receipt.status})`,
            );
        }

        const variant = await this.resolveVariantForPutaway(dto);
        const existingReceiptItem = receipt.items.find((i) => i.variantId === variant.id);

        const targetShelf = await this.resolveLocationForPutaway(
            dto,
            receipt.targetLocationId,
            existingReceiptItem?.expectedLocationId ?? null,
            user,
        );

        const txResult = await this.prisma.$transaction(async (tx) => {
            const currentReceipt = await tx.goodsReceipt.findUnique({
                where: { id },
            });
            if (!currentReceipt) {
                throw new NotFoundException('A bevételezés nem található');
            }
            if (
                currentReceipt.status !== GoodsReceiptStatus.OPEN &&
                currentReceipt.status !== GoodsReceiptStatus.IN_PROGRESS
            ) {
                throw new ConflictException(
                    `A bevételezés időközben ${currentReceipt.status} státuszba került, újabb tétel nem rakható el`,
                );
            }

            if (currentReceipt.status === GoodsReceiptStatus.OPEN) {
                await tx.goodsReceipt.update({
                    where: { id },
                    data: { status: GoodsReceiptStatus.IN_PROGRESS },
                });
            }

            if (targetShelf.slotMode === SlotMode.DEDICATED) {
                const otherStock = await tx.stockItem.findFirst({
                    where: {
                        locationId: targetShelf.id,
                        variantId: { not: variant.id },
                        quantity: { gt: 0 },
                    },
                });
                if (otherStock) {
                    throw new ConflictException(
                        'Ez egy DEDICATED (dedikált) tárolóhely, amelyen már található másik termékvariáns',
                    );
                }
            }

            let receiptItem = await tx.goodsReceiptItem.findUnique({
                where: {
                    goodsReceiptId_variantId: {
                        goodsReceiptId: id,
                        variantId: variant.id,
                    },
                },
            });

            if (receiptItem) {
                receiptItem = await tx.goodsReceiptItem.update({
                    where: { id: receiptItem.id },
                    data: {
                        receivedQuantity: { increment: dto.quantity },
                    },
                });
            } else {
                const exchangeRate = Number(currentReceipt.exchangeRate);
                let fallbackUnitCost = 0;
                let fallbackUnitCostHuf = Number(variant.costPrice);
                let linkedPoItemId: string | null = null;

                if (currentReceipt.purchaseOrderId) {
                    const poItem = await tx.purchaseOrderItem.findUnique({
                        where: {
                            purchaseOrderId_variantId: {
                                purchaseOrderId: currentReceipt.purchaseOrderId,
                                variantId: variant.id,
                            },
                        },
                    });
                    if (poItem) {
                        linkedPoItemId = poItem.id;
                        fallbackUnitCost = this.round2(Number(poItem.unitCost));
                        fallbackUnitCostHuf = this.round2(fallbackUnitCost * exchangeRate);
                    } else {
                        fallbackUnitCost =
                            exchangeRate > 0
                                ? this.round2(fallbackUnitCostHuf / exchangeRate)
                                : this.round2(fallbackUnitCostHuf);
                    }
                } else {
                    fallbackUnitCost =
                        exchangeRate > 0
                            ? this.round2(fallbackUnitCostHuf / exchangeRate)
                            : this.round2(fallbackUnitCostHuf);
                }

                receiptItem = await tx.goodsReceiptItem.create({
                    data: {
                        goodsReceiptId: id,
                        purchaseOrderItemId: linkedPoItemId,
                        variantId: variant.id,
                        expectedQuantity: 0,
                        receivedQuantity: dto.quantity,
                        unitCost: fallbackUnitCost,
                        unitCostHuf: fallbackUnitCostHuf,
                        expectedLocationId: targetShelf.id,
                        isUnexpected: true,
                        note: dto.note?.trim() || 'Számlán nem szereplő (váratlan) tétel',
                    },
                });
            }

            const stockItem = await tx.stockItem.upsert({
                where: {
                    variantId_locationId: {
                        variantId: variant.id,
                        locationId: targetShelf.id,
                    },
                },
                create: {
                    variantId: variant.id,
                    locationId: targetShelf.id,
                    quantity: dto.quantity,
                },
                update: {
                    quantity: { increment: dto.quantity },
                },
            });

            const movement = await tx.stockMovement.create({
                data: {
                    type: MovementType.PURCHASE_RECEIPT,
                    variantId: variant.id,
                    locationId: targetShelf.id,
                    quantity: dto.quantity,
                    goodsReceiptId: id,
                    purchaseOrderId: currentReceipt.purchaseOrderId,
                    unitCostHuf: receiptItem.unitCostHuf,
                    note: dto.note?.trim() || `Bevételezés (${currentReceipt.receiptNumber})`,
                    createdByUserId: user.userId,
                },
                include: {
                    location: true,
                    variant: { include: { product: true } },
                    createdByUser: { select: { id: true, name: true, email: true, role: true } },
                },
            });

            return { stockItem, movement };
        });

        const updatedReceipt = await this.findOne(id, user);
        const sanitizedMovement = this.sanitizeMovement(txResult.movement, user);

        return {
            ...updatedReceipt,
            lastMovement: sanitizedMovement,
            stockItem: txResult.stockItem,
        };
    }

    /**
     * Elrakási mozgás sztornózása (undo).
     * CSAK IN_PROGRESS vagy WAITING_FOR_APPROVAL státuszban engedélyezett.
     */
    async undoPutaway(id: string, movementId: string, user: AuthUser) {
        const receipt = await this.prisma.goodsReceipt.findUnique({
            where: { id },
        });
        if (!receipt) {
            throw new NotFoundException('A keresett bevételezés nem található');
        }

        await this.locationAccessService.assertCanAccess(user, receipt.targetLocationId);

        if (
            receipt.status !== GoodsReceiptStatus.IN_PROGRESS &&
            receipt.status !== GoodsReceiptStatus.WAITING_FOR_APPROVAL
        ) {
            throw new BadRequestException(
                `Elrakás sztornózása csak IN_PROGRESS vagy WAITING_FOR_APPROVAL státuszban engedélyezett (jelenlegi: ${receipt.status})`,
            );
        }

        const movement = await this.prisma.stockMovement.findUnique({
            where: { id: movementId },
            include: { reversedBy: true },
        });

        if (!movement || movement.goodsReceiptId !== id) {
            throw new NotFoundException('A megadott elrakási mozgás nem található ezen a bevételezésen');
        }
        if (movement.type !== MovementType.PURCHASE_RECEIPT) {
            throw new BadRequestException('Csak PURCHASE_RECEIPT típusú elrakási mozgás sztornózható');
        }
        if (movement.quantity <= 0 || movement.reversedMovementId !== null) {
            throw new BadRequestException('Sztornó mozgást nem lehet újra sztornózni');
        }
        if (movement.reversedBy) {
            throw new ConflictException('Ezt az elrakási tételt már sztornózták');
        }

        if (
            STAFF_SELF_UNDO_ONLY_ROLES.includes(user.role) &&
            movement.createdByUserId !== user.userId
        ) {
            throw new ForbiddenException(
                'Munkatársként csak a saját magad által rögzített elrakási tételt sztornózhatod',
            );
        }

        await this.locationAccessService.assertCanAccess(user, movement.locationId);

        const reversalMovement = await this.prisma.$transaction(async (tx) => {
            const currentReceipt = await tx.goodsReceipt.findUnique({
                where: { id },
            });
            if (
                !currentReceipt ||
                (currentReceipt.status !== GoodsReceiptStatus.IN_PROGRESS &&
                    currentReceipt.status !== GoodsReceiptStatus.WAITING_FOR_APPROVAL)
            ) {
                throw new ConflictException(
                    'A bevételezés időközben lezárásra került, sztornózás már nem lehetséges',
                );
            }

            const currentMovement = await tx.stockMovement.findUnique({
                where: { id: movementId },
                include: { reversedBy: true },
            });
            if (!currentMovement || currentMovement.reversedBy) {
                throw new ConflictException('Ezt az elrakási tételt már sztornózták');
            }

            const stockItem = await tx.stockItem.findUnique({
                where: {
                    variantId_locationId: {
                        variantId: currentMovement.variantId,
                        locationId: currentMovement.locationId,
                    },
                },
            });

            const currentQty = stockItem?.quantity ?? 0;
            const reservedQty = stockItem?.reservedQuantity ?? 0;
            const remainingQty = currentQty - currentMovement.quantity;

            if (remainingQty < 0 || remainingQty < reservedQty) {
                throw new ConflictException(
                    `A sztornózás nem hajtható végre, mert a polcon lévő szabad készlet (${currentQty - reservedQty} db) kevesebb, mint a sztornózandó mennyiség (${currentMovement.quantity} db)`,
                );
            }

            await tx.stockItem.update({
                where: {
                    variantId_locationId: {
                        variantId: currentMovement.variantId,
                        locationId: currentMovement.locationId,
                    },
                },
                data: {
                    quantity: { decrement: currentMovement.quantity },
                },
            });

            const receiptItem = await tx.goodsReceiptItem.findUnique({
                where: {
                    goodsReceiptId_variantId: {
                        goodsReceiptId: id,
                        variantId: currentMovement.variantId,
                    },
                },
            });

            if (receiptItem) {
                const nextReceivedQty = Math.max(
                    0,
                    receiptItem.receivedQuantity - currentMovement.quantity,
                );
                if (
                    receiptItem.isUnexpected &&
                    receiptItem.expectedQuantity === 0 &&
                    nextReceivedQty === 0
                ) {
                    await tx.goodsReceiptItem.delete({
                        where: { id: receiptItem.id },
                    });
                } else {
                    await tx.goodsReceiptItem.update({
                        where: { id: receiptItem.id },
                        data: { receivedQuantity: nextReceivedQty },
                    });
                }
            }

            return tx.stockMovement.create({
                data: {
                    type: MovementType.PURCHASE_RECEIPT,
                    variantId: currentMovement.variantId,
                    locationId: currentMovement.locationId,
                    quantity: -currentMovement.quantity,
                    goodsReceiptId: id,
                    purchaseOrderId: currentReceipt.purchaseOrderId,
                    unitCostHuf: currentMovement.unitCostHuf,
                    reversedMovementId: currentMovement.id,
                    note: `Sztornó: ${currentMovement.note ?? currentReceipt.receiptNumber}`,
                    createdByUserId: user.userId,
                },
                include: {
                    location: true,
                    variant: { include: { product: true } },
                    createdByUser: { select: { id: true, name: true, email: true, role: true } },
                },
            });
        });

        const updatedReceipt = await this.findOne(id, user);
        return {
            ...updatedReceipt,
            lastMovement: this.sanitizeMovement(reversalMovement, user),
        };
    }

    /**
     * Bevételezés befejezése a raktár részéről.
     * Ha nincs eltérés (receivedQuantity === expectedQuantity && !isUnexpected), azonnal COMPLETED-re zár.
     * Ha van eltérés, WAITING_FOR_APPROVAL státuszba állítja vezetői jóváhagyásra.
     */
    async finish(id: string, user: AuthUser) {
        const receipt = await this.prisma.goodsReceipt.findUnique({
            where: { id },
            include: { items: true },
        });
        if (!receipt) {
            throw new NotFoundException('A keresett bevételezés nem található');
        }

        await this.locationAccessService.assertCanAccess(user, receipt.targetLocationId);

        if (
            receipt.status !== GoodsReceiptStatus.IN_PROGRESS &&
            receipt.status !== GoodsReceiptStatus.OPEN
        ) {
            throw new BadRequestException(
                `A bevételezés nem fejezhető be ebben a státuszban: ${receipt.status}`,
            );
        }

        if (receipt.items.length === 0) {
            throw new BadRequestException('Tételek nélküli bevételezés nem zárható le');
        }

        const hasDiscrepancy = receipt.items.some(
            (item) => item.receivedQuantity !== item.expectedQuantity || item.isUnexpected,
        );

        if (hasDiscrepancy) {
            await this.prisma.goodsReceipt.update({
                where: { id },
                data: { status: GoodsReceiptStatus.WAITING_FOR_APPROVAL },
            });
            return this.findOne(id, user);
        }

        await this.prisma.$transaction(async (tx) => {
            await this.finalizeReceiptClosingInTx(tx, id);
        });

        return this.findOne(id, user);
    }

    /**
     * Vezetői jóváhagyás eltéréses (WAITING_FOR_APPROVAL) bevételezésre.
     */
    async approve(id: string, dto: ApproveGoodsReceiptDto, user: AuthUser) {
        const receipt = await this.prisma.goodsReceipt.findUnique({
            where: { id },
            include: { items: true },
        });
        if (!receipt) {
            throw new NotFoundException('A keresett bevételezés nem található');
        }

        await this.locationAccessService.assertCanAccess(user, receipt.targetLocationId);

        if (receipt.status !== GoodsReceiptStatus.WAITING_FOR_APPROVAL) {
            throw new BadRequestException(
                `Csak WAITING_FOR_APPROVAL státuszú bevételezés hagyható jóvá (jelenlegi: ${receipt.status})`,
            );
        }

        const itemsById = new Map(receipt.items.map((item) => [item.id, item]));
        if (dto.itemCostOverrides && dto.itemCostOverrides.length > 0) {
            for (const override of dto.itemCostOverrides) {
                if (!itemsById.has(override.goodsReceiptItemId)) {
                    throw new BadRequestException(
                        `A megadott tétel (${override.goodsReceiptItemId}) nem ehhez a bevételezéshez tartozik`,
                    );
                }
            }
        }

        const exchangeRate = Number(receipt.exchangeRate);

        await this.prisma.$transaction(async (tx) => {
            if (dto.itemCostOverrides && dto.itemCostOverrides.length > 0) {
                for (const override of dto.itemCostOverrides) {
                    const targetItem = itemsById.get(override.goodsReceiptItemId)!;
                    const unitCost = this.round2(override.unitCost);
                    const unitCostHuf = this.round2(unitCost * exchangeRate);

                    await tx.goodsReceiptItem.update({
                        where: { id: override.goodsReceiptItemId },
                        data: {
                            unitCost,
                            unitCostHuf,
                        },
                    });

                    await tx.stockMovement.updateMany({
                        where: {
                            goodsReceiptId: id,
                            variantId: targetItem.variantId,
                        },
                        data: {
                            unitCostHuf,
                        },
                    });
                }
            }

            await this.finalizeReceiptClosingInTx(tx, id, {
                approvedByUserId: user.userId,
                approvedAt: new Date(),
                discrepancyNote: dto.discrepancyNote?.trim(),
            });
        });

        return this.findOne(id, user);
    }

    /**
     * Bevételezés törlése / visszavonása (CANCELLED).
     * Kizárólag akkor engedélyezett, ha minden tételen receivedQuantity === 0!
     */
    async cancel(id: string, user: AuthUser) {
        const receipt = await this.prisma.goodsReceipt.findUnique({
            where: { id },
            include: { items: true },
        });
        if (!receipt) {
            throw new NotFoundException('A keresett bevételezés nem található');
        }

        await this.locationAccessService.assertCanAccess(user, receipt.targetLocationId);

        if (
            receipt.status === GoodsReceiptStatus.COMPLETED ||
            receipt.status === GoodsReceiptStatus.CANCELLED
        ) {
            throw new BadRequestException(
                `A bevételezés már ${receipt.status} státuszban van, nem törölhető`,
            );
        }

        const totalReceived = receipt.items.reduce((sum, item) => sum + item.receivedQuantity, 0);
        if (totalReceived > 0) {
            throw new BadRequestException('Először sztornózd a berakodott tételeket!');
        }

        await this.prisma.goodsReceipt.update({
            where: { id },
            data: { status: GoodsReceiptStatus.CANCELLED },
        });

        return this.findOne(id, user);
    }

    /**
     * Atomi lezárás (COMPLETED):
     * 1. Konkurencia-védett státuszváltás COMPLETED-re
     * 2. Súlyozott mozgó átlagár (Variant.costPrice) + lastPurchasePrice + lastPurchaseAt számítása
     *    (oldStock = Math.max(0, totalStockAfter - item.receivedQuantity), mert a putaway már növelte a StockItem-et!)
     * 3. VariantMonthlyStat (purchasedQty, purchasedTotalCostHuf) frissítése
     * 4. PurchaseOrderItem.receivedQuantity és PurchaseOrder.status (PARTIALLY_RECEIVED / RECEIVED) szinkronizálása
     */
    private async finalizeReceiptClosingInTx(
        tx: Prisma.TransactionClient,
        id: string,
        approvalMeta?: {
            approvedByUserId?: string;
            approvedAt?: Date;
            discrepancyNote?: string;
        },
    ) {
        const completedAt = approvalMeta?.approvedAt ?? new Date();

        const updated = await tx.goodsReceipt.updateMany({
            where: {
                id,
                status: {
                    in: [
                        GoodsReceiptStatus.OPEN,
                        GoodsReceiptStatus.IN_PROGRESS,
                        GoodsReceiptStatus.WAITING_FOR_APPROVAL,
                    ],
                },
            },
            data: {
                status: GoodsReceiptStatus.COMPLETED,
                completedAt,
                ...(approvalMeta?.approvedByUserId
                    ? {
                          approvedByUserId: approvalMeta.approvedByUserId,
                          approvedAt: completedAt,
                      }
                    : {}),
                ...(approvalMeta?.discrepancyNote !== undefined
                    ? { discrepancyNote: approvalMeta.discrepancyNote || null }
                    : {}),
            },
        });

        if (updated.count !== 1) {
            throw new ConflictException(
                'A bevételezés már lezárásra került vagy nem lezárható állapotban van',
            );
        }

        const receipt = await tx.goodsReceipt.findUnique({
            where: { id },
            include: {
                items: {
                    include: {
                        variant: true,
                    },
                },
            },
        });

        if (!receipt) {
            throw new NotFoundException('A bevételezés nem található');
        }

        const year = completedAt.getFullYear();
        const month = completedAt.getMonth() + 1;

        for (const item of receipt.items) {
            if (item.receivedQuantity <= 0) {
                continue;
            }

            const qty = item.receivedQuantity;
            const newUnitCostHuf = this.round2(Number(item.unitCostHuf));

            const stockAgg = await tx.stockItem.aggregate({
                where: { variantId: item.variantId },
                _sum: { quantity: true },
            });
            const totalStockAfter = stockAgg._sum.quantity ?? 0;
            const oldStock = Math.max(0, totalStockAfter - qty);
            const oldCost = Number(item.variant.costPrice);

            const newCostPrice =
                oldStock <= 0 || oldCost <= 0
                    ? newUnitCostHuf
                    : this.round2((oldStock * oldCost + qty * newUnitCostHuf) / (oldStock + qty));

            await tx.variant.update({
                where: { id: item.variantId },
                data: {
                    costPrice: newCostPrice,
                    lastPurchasePrice: newUnitCostHuf,
                    costCurrency: 'HUF',
                    lastPurchaseAt: completedAt,
                },
            });

            const purchasedTotalCostHufDelta = this.round2(qty * newUnitCostHuf);

            await tx.variantMonthlyStat.upsert({
                where: {
                    variantId_year_month: {
                        variantId: item.variantId,
                        year,
                        month,
                    },
                },
                create: {
                    variantId: item.variantId,
                    productId: item.variant.productId,
                    year,
                    month,
                    purchasedQty: qty,
                    purchasedTotalCostHuf: purchasedTotalCostHufDelta,
                },
                update: {
                    purchasedQty: { increment: qty },
                    purchasedTotalCostHuf: { increment: purchasedTotalCostHufDelta },
                },
            });

            if (receipt.purchaseOrderId) {
                let poItemId = item.purchaseOrderItemId;
                if (!poItemId) {
                    const matchingPoItem = await tx.purchaseOrderItem.findUnique({
                        where: {
                            purchaseOrderId_variantId: {
                                purchaseOrderId: receipt.purchaseOrderId,
                                variantId: item.variantId,
                            },
                        },
                        select: { id: true },
                    });
                    if (matchingPoItem) {
                        poItemId = matchingPoItem.id;
                        await tx.goodsReceiptItem.update({
                            where: { id: item.id },
                            data: { purchaseOrderItemId: poItemId },
                        });
                    }
                }

                if (poItemId) {
                    await tx.purchaseOrderItem.update({
                        where: { id: poItemId },
                        data: {
                            receivedQuantity: { increment: qty },
                        },
                    });
                }
            }
        }

        if (receipt.purchaseOrderId) {
            const po = await tx.purchaseOrder.findUnique({
                where: { id: receipt.purchaseOrderId },
                include: { items: true },
            });

            if (
                po &&
                po.status !== PurchaseOrderStatus.CLOSED &&
                po.status !== PurchaseOrderStatus.CANCELLED &&
                po.items.length > 0
            ) {
                const allReceived = po.items.every(
                    (pi) => pi.receivedQuantity >= (pi.confirmedQuantity ?? pi.orderedQuantity),
                );
                const anyReceived = po.items.some((pi) => pi.receivedQuantity > 0);

                if (allReceived) {
                    await tx.purchaseOrder.update({
                        where: { id: po.id },
                        data: { status: PurchaseOrderStatus.RECEIVED },
                    });
                } else if (anyReceived) {
                    await tx.purchaseOrder.update({
                        where: { id: po.id },
                        data: { status: PurchaseOrderStatus.PARTIALLY_RECEIVED },
                    });
                }
            }
        }
    }

    private async resolveVariantForPutaway(dto: PutawayDto) {
        const hasIdentifier = Boolean(
            dto.variantId?.trim() || dto.barcode?.trim() || dto.sku?.trim(),
        );
        if (!hasIdentifier) {
            throw new BadRequestException(
                'A termék azonosításához variantId, barcode vagy sku megadása kötelező',
            );
        }

        if (dto.variantId?.trim()) {
            const variant = await this.prisma.variant.findUnique({
                where: { id: dto.variantId.trim() },
            });
            if (!variant) {
                throw new NotFoundException('A megadott variantId alapján termékvariáns nem található');
            }
            return variant;
        }

        if (dto.barcode?.trim()) {
            const code = dto.barcode.trim();
            const barcodeRecord = await this.prisma.variantBarcode.findUnique({
                where: { barcode: code },
                include: { variant: true },
            });
            if (barcodeRecord?.variant) {
                return barcodeRecord.variant;
            }
            const bySkuFallback = await this.prisma.variant.findFirst({
                where: { sku: { equals: code, mode: 'insensitive' } },
            });
            if (bySkuFallback) {
                return bySkuFallback;
            }
            throw new NotFoundException(`Nem található termékvariáns ezzel a vonalkóddal: ${code}`);
        }

        const sku = dto.sku!.trim();
        const variant = await this.prisma.variant.findFirst({
            where: { sku: { equals: sku, mode: 'insensitive' } },
        });
        if (!variant) {
            throw new NotFoundException(`Nem található termékvariáns ezzel a cikkszámmal (SKU): ${sku}`);
        }
        return variant;
    }

    private async resolveLocationForPutaway(
        dto: PutawayDto,
        targetLocationId: string,
        expectedLocationId: string | null,
        user: AuthUser,
    ) {
        if (dto.locationId?.trim()) {
            return this.validateShelfLocation(dto.locationId.trim(), targetLocationId, user);
        }

        if (dto.locationName?.trim()) {
            const name = dto.locationName.trim();
            const subtreeLocation = await this.prisma.location.findFirst({
                where: {
                    AND: [
                        this.buildSubtreeLocationWhere(targetLocationId),
                        { name: { equals: name, mode: 'insensitive' } },
                    ],
                },
            });
            if (!subtreeLocation) {
                throw new NotFoundException(
                    `Nem található "${name}" nevű polc/helyszín a bevételezés célhelyszínén belül`,
                );
            }
            return this.validateShelfLocation(subtreeLocation.id, targetLocationId, user);
        }

        const fallbackId = expectedLocationId ?? targetLocationId;
        return this.validateShelfLocation(fallbackId, targetLocationId, user);
    }

    private async validateShelfLocation(
        locationId: string,
        targetLocationId: string,
        user: AuthUser,
    ) {
        await this.locationAccessService.assertCanAccess(user, locationId);

        const location = await this.prisma.location.findUnique({
            where: { id: locationId },
        });
        if (!location) {
            throw new NotFoundException('A megadott célhelyszín (polc/rekesz) nem található');
        }
        if (!location.isActive) {
            throw new BadRequestException('Inaktív helyszínre nem lehet készletet elrakni');
        }

        const inSubtree = await this.isLocationInSubtree(location.id, targetLocationId);
        if (!inSubtree) {
            throw new BadRequestException(
                'A megadott polc/helyszín nem a bevételezés célhelyszínéhez (raktárához/üzletéhez) tartozik',
            );
        }

        return location;
    }

    private async isLocationInSubtree(locationId: string, rootLocationId: string): Promise<boolean> {
        if (locationId === rootLocationId) {
            return true;
        }
        let currentId: string | null = locationId;
        const visited = new Set<string>();
        while (currentId && !visited.has(currentId)) {
            visited.add(currentId);
            if (currentId === rootLocationId) {
                return true;
            }
            const loc: { parentId: string | null } | null = await this.prisma.location.findUnique({
                where: { id: currentId },
                select: { parentId: true },
            });
            currentId = loc?.parentId ?? null;
        }
        return false;
    }

    private async generateUniqueReceiptNumber(): Promise<string> {
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const datePrefix = `GR-${yyyy}${mm}${dd}-`;

        const countToday = await this.prisma.goodsReceipt.count({
            where: {
                receiptNumber: { startsWith: datePrefix },
            },
        });

        for (let attempt = 0; attempt < 20; attempt++) {
            const seq = String(countToday + 1 + attempt).padStart(4, '0');
            const candidate = `${datePrefix}${seq}`;
            const exists = await this.prisma.goodsReceipt.findUnique({
                where: { receiptNumber: candidate },
                select: { id: true },
            });
            if (!exists) {
                return candidate;
            }
        }

        const randomSuffix = Math.floor(1000 + Math.random() * 9000);
        return `${datePrefix}${Date.now().toString().slice(-4)}${randomSuffix}`;
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

    private sanitizeReceipt<
        T extends {
            currency?: unknown;
            exchangeRate?: unknown;
            purchaseOrder?: Record<string, unknown> | null;
            items?: Array<
                Record<string, unknown> & {
                    unitCost?: unknown;
                    unitCostHuf?: unknown;
                    purchaseOrderItem?: Record<string, unknown> | null;
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
    >(receipt: T, user: AuthUser) {
        if (canSeeCostPrice(user.role)) {
            return receipt;
        }

        const base = excludeCostFields(receipt, ['currency', 'exchangeRate'] as const);

        const sanitizedPo = base.purchaseOrder
            ? excludeCostFields(base.purchaseOrder, ['currency', 'exchangeRate'] as const)
            : base.purchaseOrder;

        const sanitizedItems = base.items?.map((item) => {
            const cleanItem = excludeCostFields(item, ['unitCost', 'unitCostHuf'] as const);
            return {
                ...cleanItem,
                ...(cleanItem.variant ? { variant: excludeCostPrice(cleanItem.variant) } : {}),
                ...(cleanItem.purchaseOrderItem
                    ? {
                          purchaseOrderItem: excludeCostFields(cleanItem.purchaseOrderItem, [
                              'unitCost',
                          ] as const),
                      }
                    : {}),
            };
        });

        const sanitizedMovements = base.stockMovements?.map((movement) =>
            this.sanitizeMovement(movement, user),
        );

        return {
            ...base,
            ...(base.purchaseOrder !== undefined ? { purchaseOrder: sanitizedPo } : {}),
            ...(sanitizedItems !== undefined ? { items: sanitizedItems } : {}),
            ...(sanitizedMovements !== undefined ? { stockMovements: sanitizedMovements } : {}),
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
        targetLocation: true,
        supplier: true,
        purchaseOrder: {
            select: {
                id: true,
                orderNumber: true,
                status: true,
                currency: true,
                exchangeRate: true,
                supplierReference: true,
            },
        },
        createdByUser: { select: { id: true, name: true, email: true, role: true } },
        approvedByUser: { select: { id: true, name: true, email: true, role: true } },
        items: {
            include: {
                expectedLocation: true,
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
    } satisfies Prisma.GoodsReceiptInclude;

    private readonly detailInclude = {
        ...this.listInclude,
        items: {
            include: {
                expectedLocation: true,
                purchaseOrderItem: true,
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
    } satisfies Prisma.GoodsReceiptInclude;
}
