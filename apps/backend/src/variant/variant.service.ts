import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { BaseService } from "../common/base.service";
import { PrismaService } from "../prisma/prisma.service";
import { AuthUser } from "../auth/decorators/current-user.decorator";
import { canSeeCostPrice, excludeCostPrice } from "../common/cost-price";
import { BulkCreateVariantsDto } from "./dto/bulk-create-variants.dto";
import { LocationAccessService, LocationScopeContext } from "../location/location-access.service";

export interface FindVariantsOptions {
    search?: string;
    productId?: string;
    skip?: number;
    take?: number;
}

@Injectable()
export class VariantService extends BaseService<PrismaService['variant']> {
    constructor(
        private prisma: PrismaService,
        private locationAccessService: LocationAccessService,
    ) {
        super(prisma.variant);
    }

    private detailInclude() {
        return {
            product: {
                include: {
                    brand: { select: { id: true, name: true } },
                    category: { select: { id: true, name: true } },
                    primarySupplier: { select: { id: true, name: true } },
                },
            },
            variantBarcodes: {
                orderBy: [{ isPrimary: 'desc' as const }, { createdAt: 'asc' as const }],
            },
            stockItems: {
                where: {
                    quantity: { gt: 0 },
                },
                include: {
                    location: {
                        select: { id: true, name: true, type: true, parentId: true },
                    },
                },
            },
        };
    }

    private formatVariantForUser<
        T extends {
            costPrice?: unknown;
            stockItems: Array<{
                id: string;
                locationId: string;
                variantId: string;
                quantity: number;
                reservedQuantity: number;
                minStockLevel: number | null;
                maxStockLevel: number | null;
                createdAt: Date;
                updatedAt: Date;
                location: {
                    id: string;
                    name: string;
                    type: import('../generated/prisma/enums').LocationType;
                    parentId: string | null;
                };
            }>;
        },
    >(variant: T, user: AuthUser, scope: LocationScopeContext) {
        const scopedStockItems = this.locationAccessService.scopeStockItems(
            variant.stockItems,
            scope,
            (root) => ({
                id: root.id,
                name: root.name,
                type: root.type,
                parentId: root.parentId,
            }),
        );
        const withScopedStock = {
            ...variant,
            stockItems: scopedStockItems,
        };
        if (canSeeCostPrice(user.role)) {
            return withScopedStock;
        }
        return excludeCostPrice(withScopedStock);
    }

    async findAllForUser(user: AuthUser, options?: FindVariantsOptions) {
        const q = options?.search?.trim();
        const scope = await this.locationAccessService.getScopeContext(user);
        const variants = await this.prisma.variant.findMany({
            where: {
                ...(options?.productId ? { productId: options.productId } : {}),
                ...(q
                    ? {
                          OR: [
                              { sku: { contains: q, mode: 'insensitive' } },
                              {
                                  variantBarcodes: {
                                      some: { barcode: { contains: q, mode: 'insensitive' } },
                                  },
                              },
                              { product: { name: { contains: q, mode: 'insensitive' } } },
                              { product: { manufacturerCode: { contains: q, mode: 'insensitive' } } },
                              { product: { model: { contains: q, mode: 'insensitive' } } },
                              { product: { brand: { name: { contains: q, mode: 'insensitive' } } } },
                          ],
                      }
                    : {}),
            },
            include: this.detailInclude(),
            ...(options?.skip !== undefined ? { skip: options.skip } : {}),
            ...(options?.take !== undefined ? { take: options.take } : {}),
            orderBy: { createdAt: 'desc' },
        });
        return variants.map((v) => this.formatVariantForUser(v, user, scope));
    }

    async findOneForUser(id: string, user: AuthUser) {
        const scope = await this.locationAccessService.getScopeContext(user);
        const variant = await this.prisma.variant.findUnique({
            where: { id },
            include: this.detailInclude(),
        });

        if (!variant) {
            throw new NotFoundException(`Record with id ${id} not found`);
        }
        return this.formatVariantForUser(variant, user, scope);
    }

    async bulkCreate(dto: BulkCreateVariantsDto) {
        const product = await this.prisma.product.findUnique({
            where: { id: dto.productId },
            select: { id: true },
        });
        if (!product) {
            throw new BadRequestException('A megadott termék nem létezik');
        }

        const seenSkus = new Set<string>();
        const seenBarcodes = new Set<string>();

        const normalizedItems = dto.items.map((item) => {
            const sku = item.sku.trim();
            const size = item.size.trim();
            const colors = item.colors.map((c) => c.trim()).filter((c) => c.length > 0);
            const primaryBarcode = item.primaryBarcode?.trim() || undefined;

            if (!sku || !size) {
                throw new BadRequestException('Az SKU és a méret megadása minden tételnél kötelező');
            }
            if (colors.length === 0) {
                throw new BadRequestException('Minden variánshoz legalább egy színt meg kell adni');
            }

            const skuKey = sku.toUpperCase();
            if (seenSkus.has(skuKey)) {
                throw new BadRequestException(`Duplikált SKU a kérésben: ${sku}`);
            }
            seenSkus.add(skuKey);

            if (primaryBarcode) {
                if (seenBarcodes.has(primaryBarcode)) {
                    throw new BadRequestException(`Duplikált vonalkód a kérésben: ${primaryBarcode}`);
                }
                seenBarcodes.add(primaryBarcode);
            }

            return {
                sku,
                size,
                colors,
                weight: item.weight,
                price: item.price,
                costPrice: item.costPrice,
                imageUrls: item.imageUrls?.map((u) => u.trim()).filter((u) => u.length > 0) ?? [],
                isActive: item.isActive ?? true,
                primaryBarcode,
            };
        });

        const skus = normalizedItems.map((i) => i.sku);
        const existingSkus = await this.prisma.variant.findMany({
            where: { sku: { in: skus } },
            select: { sku: true },
        });
        if (existingSkus.length > 0) {
            throw new ConflictException(
                `Az alábbi SKU(k) már foglaltak: ${existingSkus.map((e) => e.sku).join(', ')}`,
            );
        }

        const barcodes = normalizedItems
            .map((i) => i.primaryBarcode)
            .filter((b): b is string => Boolean(b));
        if (barcodes.length > 0) {
            const existingBarcodes = await this.prisma.variantBarcode.findMany({
                where: { barcode: { in: barcodes } },
                select: { barcode: true },
            });
            if (existingBarcodes.length > 0) {
                throw new ConflictException(
                    `Az alábbi vonalkód(ok) már foglaltak: ${existingBarcodes.map((e) => e.barcode).join(', ')}`,
                );
            }
        }

        const created = await this.prisma.$transaction(async (tx) => {
            const results = [];
            for (const item of normalizedItems) {
                const variant = await tx.variant.create({
                    data: {
                        productId: dto.productId,
                        sku: item.sku,
                        size: item.size,
                        colors: item.colors,
                        weight: item.weight,
                        price: item.price,
                        costPrice: item.costPrice,
                        imageUrls: item.imageUrls,
                        isActive: item.isActive,
                        variantBarcodes: item.primaryBarcode
                            ? {
                                  create: {
                                      barcode: item.primaryBarcode,
                                      isPrimary: true,
                                  },
                              }
                            : undefined,
                    },
                    include: {
                        variantBarcodes: {
                            orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
                        },
                    },
                });
                results.push(variant);
            }
            return results;
        });

        return {
            createdCount: created.length,
            items: created,
        };
    }

    override async remove(id: string) {
        await this.findOne(id);
        const stockCount = await this.prisma.stockItem.count({
            where: { variantId: id, quantity: { gt: 0 } },
        });
        if (stockCount > 0) {
            throw new ConflictException('Nem törölhető olyan variáns, amelyből még van raktárkészlet');
        }
        return this.prisma.variant.delete({ where: { id } });
    }
}
