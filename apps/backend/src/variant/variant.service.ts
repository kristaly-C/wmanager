import { Injectable } from "@nestjs/common";
import { BaseService } from "../common/base.service";
import { PrismaService } from "../prisma/prisma.service";



@Injectable()
export class VariantService extends BaseService<PrismaService['variant']> {
    constructor(private prisma: PrismaService) {
        super(prisma.variant);
    }
}