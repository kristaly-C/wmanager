import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { BaseService } from '../common/base.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UserModel } from '../generated/prisma/models';
import { UpdateUserDto } from './dto/update-user.dto';
import { AuthUser } from '../auth/decorators/current-user.decorator';
import { Role } from '../generated/prisma/enums';


@Injectable()
export class UserService extends BaseService<PrismaService['user']> {
  constructor(private prisma: PrismaService) {
    super(prisma.user);
  }

  async createUser(data: CreateUserDto, actor: AuthUser) {
    this.assertCanManage(actor, data.role)
    this.assertRoleAssignable(data.role)
    const passwordHash = await bcrypt.hash(data.password, 10);
    const { password, ...rest } = data;

    const user = await super.create({ ...rest, passwordHash });
    return this.excludePassword(user);
  
  }

  async findAll(args?: Parameters<PrismaService['user']['findMany']>[0]) {
    const users = await super.findAll(args);
    return users.map((u: UserModel) => this.excludePassword(u));
  }

  async findOne(id: string) {
    const user = await super.findOne(id);
    return this.excludePassword(user);
  }

  async removeUser(id: string, actor: AuthUser) {
    if (actor.userId === id) {
      throw new ConflictException('Saját fiók nem törölhető');
    }
    const pickedUser = await this.findOne(id);
    this.assertCanManage(actor, pickedUser.role);
    if (pickedUser.role === Role.ADMIN && pickedUser.isActive) {
      const numberOfAdmins = await this.prisma.user.count({
        where: { role: Role.ADMIN, isActive: true },
      });
      if (numberOfAdmins < 2) {
        throw new ConflictException('Cannot delete the last ADMIN user');
      }
    }
    if (pickedUser.role === Role.BOSS) {
      throw new ConflictException('Cannot delete the BOSS');
    }
    const removed = await this.prisma.user.delete({ where: { id } });
    return this.excludePassword(removed);
  }


  async updateUser(id: string, data: UpdateUserDto, actor: AuthUser) {
    const target = await this.findOne(id);

    this.assertCanManage(actor, target.role);

    if (actor.userId === id) {
      if (data.role && data.role !== target.role) {
        throw new ConflictException('Saját szerepkör nem módosítható');
      }
      if (data.isActive === false) {
        throw new ConflictException('Saját fiók nem tiltható le');
      }
    }

    if (data.role) {
      this.assertCanManage(actor, data.role);
    }

    if (data.role === Role.BOSS && target.role !== Role.BOSS) {
      this.assertRoleAssignable(data.role);
    }

    if (target.role === Role.BOSS && data.role && data.role !== Role.BOSS) {
      throw new ConflictException('Cannot change the role of a BOSS');
    }

    if (target.role === Role.BOSS && data.isActive === false) {
      throw new ConflictException('BOSS fiók nem tiltható le');
    }

    const isDemotingAdmin = target.role === Role.ADMIN && data.role && data.role !== Role.ADMIN;
    const isDeactivatingAdmin = target.role === Role.ADMIN && data.isActive === false;
    if (target.isActive && (isDemotingAdmin || isDeactivatingAdmin)) {
      const numberOfAdmins = await this.prisma.user.count({
        where: { role: Role.ADMIN, isActive: true },
      });
      if (numberOfAdmins < 2) {
        throw new ConflictException('Az utolsó aktív ADMIN nem fokozható le és nem tiltható le');
      }
    }

    const updated = await this.prisma.user.update({ where: { id }, data });
    return this.excludePassword(updated);
  }

  private excludePassword(user: { passwordHash: string; qrToken?: string | null; [key: string]: any}) {
    const { passwordHash, qrToken, ...rest } = user;
    return rest;
  }

  public assertCanManage(actor: AuthUser, targetRole: Role){
    const protectedRoles: Role[] = [Role.ADMIN, Role.BOSS];
    if (protectedRoles.includes(targetRole) && actor.role !== Role.BOSS) {
      throw new ForbiddenException('Only a BOSS can manage ADMIN and BOSS accounts');
    }
  }

  private assertRoleAssignable(role: Role){
    if( role === Role.BOSS){
      throw new ForbiddenException('BOSS fiók csak a telepítéskor (seed) hozható létre');
    }
  }
}
