import { ConflictException, Injectable } from "@nestjs/common";
import { BaseService } from "../common/base.service";
import { PrismaService } from "../prisma/prisma.service";


@Injectable()
export class BrandService extends BaseService<PrismaService['brand']> {
    constructor(private prisma: PrismaService) {
        super(prisma.brand);
    }


    findAll() {
        return super.findAll({ orderBy: { name: 'asc'}});
    }

    async remove(id: string) {
        await this.findOne(id);
        const productCount = await this.prisma.product.count({ where: { brandId: id}});

        if( productCount > 0){
            throw new ConflictException( 'Nem törölhető olyan márka, amelyhez még tartoznak termékek');
        }

        return this.prisma.brand.delete( { where: { id}})
    }
}