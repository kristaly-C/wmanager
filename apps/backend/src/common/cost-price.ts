import { Role } from '../generated/prisma/enums';

export const COST_PRICE_ROLES: Role[] = [
    Role.BOSS,
    Role.ADMIN,
    Role.WAREHOUSE_MANAGER,
    Role.STORE_MANAGER,
    Role.ORDER_CLERK,
];

export function canSeeCostPrice(role: Role): boolean {
    return COST_PRICE_ROLES.includes(role);
}

export function excludeCostPrice<T extends { costPrice?: unknown }>(
    variant: T,
): Omit<T, 'costPrice'> {
    const { costPrice, ...rest } = variant;
    return rest;
}
