import { NotFoundException } from '@nestjs/common';

export abstract class BaseService <
  TDelegate extends {
    findMany: (...args: any[]) => any;
    findUnique: (...args: any[]) => any;
    create: (...args: any[]) => any;
    update: (...args: any[]) => any;
    delete: (...args: any[]) => any;
  },
> {
  constructor(protected readonly delegate: TDelegate) {}

  findAll() {
    return this.delegate.findMany();
  }

  async findOne(id: string) {
    const record = await this.delegate.findUnique({ where: { id } });
    if (!record) {
      throw new NotFoundException(`Record with id ${id} not found`);
    }
    return record;
  }

  create(data: Parameters<TDelegate['create']>[0]['data']) {
    return this.delegate.create({ data });
  }

  async update(id: string, data: Parameters<TDelegate['update']>[0]['data']) {
    await this.findOne(id);
    return this.delegate.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.delegate.delete({ where: { id } });
  }
}