import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { AuthUser } from '../auth/decorators/current-user.decorator';
import { canSeeCostPrice, excludeCostFields } from '../common/cost-price';
import { GoodsReceiptStatus } from '../generated/prisma/enums';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVariantSupplierDto } from './dto/create-variant-supplier.dto';
import { UpdateVariantSupplierDto } from './dto/update-variant-supplier.dto';

const SUPPLIER_SELECT = {
    id: true,
    name: true,
    email: true,
    phone: true,
} as const;

const HIDDEN_SUPPLIER_COST_FIELDS = [
    'purchasePrice',
    'currency',
    'discountPercent',
] as const;

@Injectable()
export class VariantSupplierService {
    constructor(private readonly prisma: PrismaService) {}

    private async assertVariantExists(variantId: string) {
        const variant = await this.prisma.variant.findUnique({
            where: { id: variantId },
            select: {
                id: true,
                sku: true,
                costPrice: true,
                costCurrency: true,
                lastPurchasePrice: true,
                lastPurchaseAt: true,
            },
        });

        if (!variant) {
            throw new NotFoundException(`A megadott variáns nem található: ${variantId}`);
        }

        return variant;
    }

    private formatVariantSupplier<
        T extends {
            purchasePrice: Prisma.Decimal | number;
            discountPercent: Prisma.Decimal | number | null;
        },
    >(row: T) {
        return {
            ...row,
            purchasePrice: Number(row.purchasePrice),
            discountPercent: row.discountPercent !== null ? Number(row.discountPercent) : null,
        };
    }

    async list(variantId: string, user: AuthUser) {
        await this.assertVariantExists(variantId);

        const rows = await this.prisma.variantSupplier.findMany({
            where: { variantId },
            include: {
                supplier: { select: SUPPLIER_SELECT },
            },
            orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        });

        const includeCost = canSeeCostPrice(user.role);
        return rows.map((row) => {
            const formatted = this.formatVariantSupplier(row);
            return includeCost
                ? formatted
                : excludeCostFields(formatted, HIDDEN_SUPPLIER_COST_FIELDS);
        });
    }

    async create(variantId: string, dto: CreateVariantSupplierDto) {
        await this.assertVariantExists(variantId);

        const supplier = await this.prisma.supplier.findUnique({
            where: { id: dto.supplierId },
            select: { id: true },
        });
        if (!supplier) {
            throw new NotFoundException(`A megadott beszállító nem található: ${dto.supplierId}`);
        }

        const existing = await this.prisma.variantSupplier.findUnique({
            where: {
                variantId_supplierId: {
                    variantId,
                    supplierId: dto.supplierId,
                },
            },
            select: { id: true },
        });
        if (existing) {
            throw new ConflictException('Ez a beszállító már hozzá van rendelve ehhez a variánshoz');
        }

        const created = await this.prisma.$transaction(async (tx) => {
            if (dto.isPrimary === true) {
                await tx.variantSupplier.updateMany({
                    where: { variantId, isPrimary: true },
                    data: { isPrimary: false },
                });
            }

            return tx.variantSupplier.create({
                data: {
                    variantId,
                    supplierId: dto.supplierId,
                    supplierSku: dto.supplierSku?.trim() || null,
                    supplierProductName: dto.supplierProductName?.trim() || null,
                    purchasePrice: dto.purchasePrice,
                    currency: (dto.currency ?? 'HUF').trim().toUpperCase(),
                    discountPercent: dto.discountPercent ?? null,
                    orderUnit: dto.orderUnit?.trim() || null,
                    isPrimary: dto.isPrimary ?? false,
                    note: dto.note?.trim() || null,
                },
                include: {
                    supplier: { select: SUPPLIER_SELECT },
                },
            });
        });

        return this.formatVariantSupplier(created);
    }

    async update(variantId: string, id: string, dto: UpdateVariantSupplierDto) {
        const existing = await this.prisma.variantSupplier.findFirst({
            where: { id, variantId },
            select: { id: true },
        });
        if (!existing) {
            throw new NotFoundException(
                'A megadott beszállítói kapcsolat nem található ennél a variánsnál',
            );
        }

        if (dto.purchasePrice === null || dto.currency === null || dto.isPrimary === null) {
            throw new BadRequestException(
                'A purchasePrice, currency és isPrimary mezők értéke nem lehet null',
            );
        }

        const data: Prisma.VariantSupplierUpdateInput = {};
        if (dto.supplierSku !== undefined) {
            data.supplierSku = dto.supplierSku?.trim() || null;
        }
        if (dto.supplierProductName !== undefined) {
            data.supplierProductName = dto.supplierProductName?.trim() || null;
        }
        if (dto.purchasePrice !== undefined) {
            data.purchasePrice = dto.purchasePrice;
        }
        if (dto.currency !== undefined) {
            data.currency = dto.currency.trim().toUpperCase();
        }
        if (dto.discountPercent !== undefined) {
            data.discountPercent = dto.discountPercent ?? null;
        }
        if (dto.orderUnit !== undefined) {
            data.orderUnit = dto.orderUnit?.trim() || null;
        }
        if (dto.isPrimary !== undefined) {
            data.isPrimary = dto.isPrimary;
        }
        if (dto.note !== undefined) {
            data.note = dto.note?.trim() || null;
        }

        const updated = await this.prisma.$transaction(async (tx) => {
            if (dto.isPrimary === true) {
                await tx.variantSupplier.updateMany({
                    where: { variantId, isPrimary: true, id: { not: id } },
                    data: { isPrimary: false },
                });
            }

            return tx.variantSupplier.update({
                where: { id },
                data,
                include: {
                    supplier: { select: SUPPLIER_SELECT },
                },
            });
        });

        return this.formatVariantSupplier(updated);
    }

    async remove(variantId: string, id: string) {
        const existing = await this.prisma.variantSupplier.findFirst({
            where: { id, variantId },
            select: { id: true },
        });
        if (!existing) {
            throw new NotFoundException(
                'A megadott beszállítói kapcsolat nem található ennél a variánsnál',
            );
        }

        const deleted = await this.prisma.variantSupplier.delete({
            where: { id },
        });

        return this.formatVariantSupplier(deleted);
    }

    async getPurchaseHistory(variantId: string) {
        const variant = await this.assertVariantExists(variantId);

        const [receiptItems, monthlyStats] = await Promise.all([
            this.prisma.goodsReceiptItem.findMany({
                where: {
                    variantId,
                    receivedQuantity: { gt: 0 },
                    goodsReceipt: {
                        status: GoodsReceiptStatus.COMPLETED,
                    },
                },
                include: {
                    goodsReceipt: {
                        select: {
                            id: true,
                            receiptNumber: true,
                            invoiceNumber: true,
                            currency: true,
                            exchangeRate: true,
                            completedAt: true,
                            supplierId: true,
                            supplier: {
                                select: { id: true, name: true },
                            },
                            purchaseOrderId: true,
                            purchaseOrder: {
                                select: { id: true, orderNumber: true, status: true },
                            },
                            targetLocation: {
                                select: { id: true, name: true, type: true },
                            },
                        },
                    },
                },
                orderBy: [
                    { goodsReceipt: { completedAt: 'desc' } },
                    { createdAt: 'desc' },
                ],
            }),
            this.prisma.variantMonthlyStat.findMany({
                where: { variantId },
                orderBy: [{ year: 'desc' }, { month: 'desc' }],
            }),
        ]);

        return {
            variant: {
                id: variant.id,
                sku: variant.sku,
                costPrice: Number(variant.costPrice),
                costCurrency: variant.costCurrency,
                lastPurchasePrice:
                    variant.lastPurchasePrice !== null ? Number(variant.lastPurchasePrice) : null,
                lastPurchaseAt: variant.lastPurchaseAt,
            },
            history: receiptItems.map((item) => ({
                id: item.id,
                goodsReceiptId: item.goodsReceiptId,
                receiptNumber: item.goodsReceipt.receiptNumber,
                invoiceNumber: item.goodsReceipt.invoiceNumber,
                supplierId: item.goodsReceipt.supplierId,
                supplier: item.goodsReceipt.supplier,
                purchaseOrderId: item.goodsReceipt.purchaseOrderId,
                purchaseOrder: item.goodsReceipt.purchaseOrder,
                targetLocation: item.goodsReceipt.targetLocation,
                expectedQuantity: item.expectedQuantity,
                receivedQuantity: item.receivedQuantity,
                unitCost: Number(item.unitCost),
                currency: item.goodsReceipt.currency,
                exchangeRate: Number(item.goodsReceipt.exchangeRate),
                unitCostHuf: Number(item.unitCostHuf),
                isUnexpected: item.isUnexpected,
                completedAt: item.goodsReceipt.completedAt,
            })),
            monthlyStats: monthlyStats.map((stat) => ({
                id: stat.id,
                variantId: stat.variantId,
                productId: stat.productId,
                year: stat.year,
                month: stat.month,
                purchasedQty: stat.purchasedQty,
                purchasedTotalCostHuf: Number(stat.purchasedTotalCostHuf),
                soldQty: stat.soldQty,
                soldRevenueHuf: Number(stat.soldRevenueHuf),
                soldCogsHuf: Number(stat.soldCogsHuf),
                returnedQty: stat.returnedQty,
                adjustmentQty: stat.adjustmentQty,
                updatedAt: stat.updatedAt,
            })),
        };
    }
}
