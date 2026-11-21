import { Role } from '../generated/prisma/enums';

export const COST_PRICE_ROLES: Role[] = [
    Role.BOSS,
    Role.ADMIN,
    Role.WAREHOUSE_MANAGER,
    Role.STORE_MANAGER,
    Role.ORDER_CLERK,
];

export const VARIANT_COST_FIELDS = [
    'costPrice',
    'lastPurchasePrice',
    'costCurrency',
    'lastPurchaseAt',
] as const;

export const COST_SENSITIVE_FIELDS = [
    'costPrice',
    'lastPurchasePrice',
    'costCurrency',
    'lastPurchaseAt',
    'purchasePrice',
    'currency',
    'discountPercent',
    'unitCost',
    'unitCostHuf',
    'exchangeRate',
] as const;

export type VariantCostField = (typeof VARIANT_COST_FIELDS)[number];
export type CostSensitiveField = (typeof COST_SENSITIVE_FIELDS)[number];

export function canSeeCostPrice(role: Role): boolean {
    return COST_PRICE_ROLES.includes(role);
}

export function excludeCostPrice<
    T extends {
        costPrice?: unknown;
        lastPurchasePrice?: unknown;
        costCurrency?: unknown;
        lastPurchaseAt?: unknown;
    },
>(variant: T): Omit<T, VariantCostField> {
    const {
        costPrice,
        lastPurchasePrice,
        costCurrency,
        lastPurchaseAt,
        ...rest
    } = variant;
    return rest;
}

export function excludeUnitCostHuf<T extends { unitCostHuf?: unknown }>(
    movement: T,
): Omit<T, 'unitCostHuf'> {
    const { unitCostHuf, ...rest } = movement;
    return rest;
}

export function excludeCostFields<
    T extends object,
    K extends string = CostSensitiveField,
>(
    obj: T,
    fields: readonly K[] = COST_SENSITIVE_FIELDS as unknown as readonly K[],
): Omit<T, K> {
    const clone = { ...(obj as Record<string, unknown>) };
    for (const field of fields) {
        delete clone[field];
    }
    return clone as Omit<T, K>;
}
