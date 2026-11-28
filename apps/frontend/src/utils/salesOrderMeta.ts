import {
  PickTaskStatus,
  Role,
  SalesChannel,
  SalesOrderStatus,
} from '@wmanager/shared-types'
import type { StatusSeverity } from './procurementMeta'

export interface SalesOrderMetaItem {
  label: string
  badgeClass: string
  severity: StatusSeverity
  icon: string
}

export const SALES_ORDER_STATUS_META: Record<SalesOrderStatus, SalesOrderMetaItem> = {
  [SalesOrderStatus.ON_HOLD]: {
    label: 'Felfüggesztve (Hiány)',
    badgeClass: 'bg-orange-50 text-orange-700 border border-orange-200',
    severity: 'warn',
    icon: 'pi pi-exclamation-triangle',
  },
  [SalesOrderStatus.PENDING]: {
    label: 'Kiszedésre vár',
    badgeClass: 'bg-sky-50 text-sky-700 border border-sky-200',
    severity: 'info',
    icon: 'pi pi-clock',
  },
  [SalesOrderStatus.PICKING]: {
    label: 'Kiszedés alatt',
    badgeClass: 'bg-amber-50 text-amber-700 border border-amber-200',
    severity: 'warn',
    icon: 'pi pi-sync',
  },
  [SalesOrderStatus.READY]: {
    label: 'Átadásra kész',
    badgeClass: 'bg-indigo-50 text-indigo-700 border border-indigo-200',
    severity: 'info',
    icon: 'pi pi-box',
  },
  [SalesOrderStatus.COMPLETED]: {
    label: 'Teljesítve',
    badgeClass: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    severity: 'success',
    icon: 'pi pi-check-circle',
  },
  [SalesOrderStatus.CANCELLED]: {
    label: 'Lemondva',
    badgeClass: 'bg-rose-50 text-rose-700 border border-rose-200',
    severity: 'danger',
    icon: 'pi pi-times-circle',
  },
}

export const SALES_ORDER_STATUS_OPTIONS: Array<{ label: string; value: SalesOrderStatus }> = (
  Object.values(SalesOrderStatus) as SalesOrderStatus[]
).map((status) => ({
  label: SALES_ORDER_STATUS_META[status].label,
  value: status,
}))

export const SALES_CHANNEL_META: Record<SalesChannel, SalesOrderMetaItem> = {
  [SalesChannel.WEBSHOP]: {
    label: 'Webshop',
    badgeClass: 'bg-blue-50 text-blue-700 border border-blue-200',
    severity: 'info',
    icon: 'pi pi-globe',
  },
  [SalesChannel.STORE]: {
    label: 'Üzlet (Bolti)',
    badgeClass: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    severity: 'success',
    icon: 'pi pi-shop',
  },
  [SalesChannel.PHONE]: {
    label: 'Telefonos',
    badgeClass: 'bg-purple-50 text-purple-700 border border-purple-200',
    severity: 'secondary',
    icon: 'pi pi-phone',
  },
  [SalesChannel.B2B]: {
    label: 'B2B / Nagyker',
    badgeClass: 'bg-slate-100 text-slate-700 border border-slate-200',
    severity: 'contrast',
    icon: 'pi pi-building',
  },
}

export const SALES_CHANNEL_OPTIONS: Array<{ label: string; value: SalesChannel }> = (
  Object.values(SalesChannel) as SalesChannel[]
).map((channel) => ({
  label: SALES_CHANNEL_META[channel].label,
  value: channel,
}))

export const PICK_TASK_STATUS_META: Record<PickTaskStatus, SalesOrderMetaItem> = {
  [PickTaskStatus.OPEN]: {
    label: 'Szabad feladat',
    badgeClass: 'bg-sky-50 text-sky-700 border border-sky-200',
    severity: 'info',
    icon: 'pi pi-inbox',
  },
  [PickTaskStatus.IN_PROGRESS]: {
    label: 'Szedés alatt',
    badgeClass: 'bg-amber-50 text-amber-700 border border-amber-200',
    severity: 'warn',
    icon: 'pi pi-sync',
  },
  [PickTaskStatus.AWAITING_DROP]: {
    label: 'Leadásra vár',
    badgeClass: 'bg-violet-50 text-violet-700 border border-violet-200',
    severity: 'warn',
    icon: 'pi pi-map-marker',
  },
  [PickTaskStatus.COMPLETED]: {
    label: 'Leadva',
    badgeClass: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    severity: 'success',
    icon: 'pi pi-check-circle',
  },
  [PickTaskStatus.CANCELLED]: {
    label: 'Törölve',
    badgeClass: 'bg-rose-50 text-rose-700 border border-rose-200',
    severity: 'danger',
    icon: 'pi pi-times-circle',
  },
}

export const PICK_TASK_STATUS_OPTIONS: Array<{ label: string; value: PickTaskStatus }> = (
  Object.values(PickTaskStatus) as PickTaskStatus[]
).map((status) => ({
  label: PICK_TASK_STATUS_META[status].label,
  value: status,
}))

export const SALES_ORDER_CREATE_ROLES: readonly Role[] = [
  Role.BOSS,
  Role.ADMIN,
  Role.ORDER_CLERK,
  Role.WAREHOUSE_MANAGER,
  Role.STORE_MANAGER,
  Role.STORE_STAFF,
]

export const SALES_ORDER_MANAGE_ROLES: readonly Role[] = [
  Role.BOSS,
  Role.ADMIN,
  Role.ORDER_CLERK,
  Role.WAREHOUSE_MANAGER,
  Role.STORE_MANAGER,
]

export const SALES_ORDER_COMPLETE_ROLES: readonly Role[] = [
  Role.BOSS,
  Role.ADMIN,
  Role.ORDER_CLERK,
  Role.WAREHOUSE_MANAGER,
  Role.STORE_MANAGER,
  Role.STORE_STAFF,
]

export const SALES_ORDER_MANAGER_ROLES: readonly Role[] = [
  Role.BOSS,
  Role.ADMIN,
  Role.WAREHOUSE_MANAGER,
  Role.STORE_MANAGER,
]

export const PICK_TASK_OPERATOR_ROLES: readonly Role[] = [
  Role.BOSS,
  Role.ADMIN,
  Role.WAREHOUSE_MANAGER,
  Role.STORE_MANAGER,
  Role.WAREHOUSE_STAFF,
  Role.STORE_STAFF,
]

export function canCreateSalesOrder(role?: Role | null): boolean {
  if (!role) return false
  return SALES_ORDER_CREATE_ROLES.includes(role)
}

export function canManageSalesOrder(role?: Role | null): boolean {
  if (!role) return false
  return SALES_ORDER_MANAGE_ROLES.includes(role)
}

export function canCompleteSalesOrder(role?: Role | null): boolean {
  if (!role) return false
  return SALES_ORDER_COMPLETE_ROLES.includes(role)
}

export function canCancelPickedSalesOrder(role?: Role | null): boolean {
  if (!role) return false
  return SALES_ORDER_MANAGER_ROLES.includes(role)
}

export function canOperatePickTasks(role?: Role | null): boolean {
  if (!role) return false
  return PICK_TASK_OPERATOR_ROLES.includes(role)
}
