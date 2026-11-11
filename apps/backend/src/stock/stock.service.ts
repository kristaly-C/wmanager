import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { LocationAccessService } from "../location/location-access.service";
import { AuthUser } from "../auth/decorators/current-user.decorator";
import { AdjustStockDto } from "./dto/adjust-stock.dto";
import { SlotMode } from "../generated/prisma/enums";


@Injectable()
export class StockService {
    constructor(
        private prisma: PrismaService,
        private locationAccesService: LocationAccessService,
    ){}

    async findAll(user: AuthUser, locationId?: string, variantId?: string){
        if(locationId){
            await this.locationAccesService.assertCanAccess(user, locationId);
        }

        const locationWhere = await this.locationAccesService.accessibleWhere(user);

        return this.prisma.stockItem.findMany({
            where: {
                ...(locationId ? { locationId } : { location: locationWhere }),
                ...(variantId ? { variantId } : {}),
            },
            include: {
                location: true,
                variant: {
                    include: {product: true, variantBarcodes: {
                        orderBy: [{ isPrimary: 'desc'}, { createdAt: 'asc'}],
                    },}
                }
            },
            orderBy: { updatedAt: 'desc'}
        });
    }

    async findMovements(user: AuthUser, locationId?: string, variantId?: string) {
        if(locationId){
            await this.locationAccesService.assertCanAccess(user, locationId)
        }

        const locationWhere = await this.locationAccesService.accessibleWhere(user);

        return this.prisma.stockMovement.findMany({
            where: {
                ...(locationId ? { locationId } : { location: locationWhere }),
                ...(variantId ? { variantId } : {}),   
            },
            include: {
                location: true,
                variant: { include: { product: true}},
                createdByUser: { select: {id: true, name: true, email: true, role: true}},
            },
            orderBy: { createdAt: 'desc'}
        });
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
}