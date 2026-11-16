import { ConflictException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { BaseService } from "../common/base.service";


@Injectable()
export class SupplierService extends BaseService<PrismaService['supplier']> {
  constructor(private prisma: PrismaService) {
    super(prisma.supplier);
  }

  findAll() {
    return super.findAll({ orderBy: { name: 'asc' } });
  }

  async remove(id: string) {
    await this.findOne(id);
    const productCount = await this.prisma.product.count({ where: { primarySupplierId: id } });

    if (productCount > 0) {
      throw new ConflictException('Nem törölhető olyan beszállító, amelyhez még tartoznak termékek');
    }

    return this.prisma.supplier.delete({ where: { id } });
  }
}