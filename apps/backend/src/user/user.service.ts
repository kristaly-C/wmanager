import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { BaseService } from '../common/base.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UserModel } from '../generated/prisma/models';

@Injectable()
export class UserService extends BaseService<PrismaService['user']> {
  constructor(prisma: PrismaService) {
    super(prisma.user);
  }

  async createUser(data: CreateUserDto) {
    const passwordHash = await bcrypt.hash(data.password, 10);
    const { password, ...rest } = data;

    const user = await super.create({ ...rest, passwordHash });
    return this.excludePassword(user);
  
  }

  async findAll() {
    const users = await super.findAll();
    return users.map((u: UserModel) => this.excludePassword(u));
  }

  async findOne(id: string) {
    const user = await super.findOne(id);
    return this.excludePassword(user);
  }

  private excludePassword(user: { passwordHash: string; [key: string]: any}) {
    const { passwordHash, ...rest } = user;
    return rest;
  }
}