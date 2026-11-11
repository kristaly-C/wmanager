import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateVariantBarcodeDto } from "./dto/create-variant-barcode.dto";
import { UpdateVariantBarcodeDto } from "./dto/update-variant-barcode.dto";

@Injectable()
export class VariantBarcodeService {
    constructor(private prisma: PrismaService) {}


    private async assertVariantExists(variantId: string) {
        const variant = await this.prisma.variant.findUnique({
            where: { id: variantId},
            select: { id: true}
        });

        if(!variant){
            throw new NotFoundException(`Variant with id ${variantId} not found`);
        }
    }

    async list(variantId: string) {
        await this.assertVariantExists(variantId);
        return this.prisma.variantBarcode.findMany({
            where: { variantId },
            orderBy: [{ isPrimary: 'desc'}, {createdAt: 'asc'}],
        });
    }

    async create(variantId: string, dto: CreateVariantBarcodeDto){
        await this.assertVariantExists(variantId);

        return this.prisma.$transaction(async (tx) => {
            if(dto.isPrimary) {
                await tx.variantBarcode.updateMany({
                    where: { variantId, isPrimary: true},
                    data: { isPrimary: false},
                });
            }

            return tx.variantBarcode.create({
                data: {
                    variantId,
                    barcode: dto.barcode,
                    isPrimary: dto.isPrimary ?? false,
                    note: dto.note,
                },
            });
        });
    }


    async update(variantId: string, barcodeId: string, dto: UpdateVariantBarcodeDto){
        const existing = await this.prisma.variantBarcode.findUnique({
            where: {id: barcodeId},
        });

        if(!existing || existing.variantId !== variantId) {
            throw new NotFoundException('A megadott vonalkód nem található ennél a variánsnál');
        }

        return this.prisma.$transaction(async (tx) => {
            if(dto.isPrimary){
                await tx.variantBarcode.updateMany({
                    where: { variantId, isPrimary: true, id: { not: barcodeId}},
                    data: { isPrimary: false},
                });
            }

            return tx.variantBarcode.update({
                where: { id: barcodeId},
                data: dto,
            });
        });
    }

    async remove(variantId: string, barcodeId: string) {
        const existing = await this.prisma.variantBarcode.findUnique({
            where: { id: barcodeId},
        });

        if(!existing || existing.variantId !== variantId){
            throw new NotFoundException('A megadott vonalkód nem található ennél a variánsnál');
        }

        return this.prisma.variantBarcode.delete({
            where: { id: barcodeId},
        });
    }
}