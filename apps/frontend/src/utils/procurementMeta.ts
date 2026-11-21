import { GoodsReceiptStatus, PurchaseOrderStatus, Role } from '@wmanager/shared-types'

export type StatusSeverity = 'secondary' | 'info' | 'warn' | 'success' | 'danger' | 'contrast'

export interface ProcurementStatusMeta {
  label: string
  badgeClass: string
  severity: StatusSeverity
  icon: string
}

export const COST_PRICE_ROLES: Role[] = [
  Role.BOSS,
  Role.ADMIN,
  Role.WAREHOUSE_MANAGER,
  Role.STORE_MANAGER,
  Role.ORDER_CLERK,
]

export function canSeeCostPrice(role?: Role | null): boolean {
  if (!role) return false
  return COST_PRICE_ROLES.includes(role)
}

export const PURCHASE_ORDER_STATUS_META: Record<PurchaseOrderStatus, ProcurementStatusMeta> = {
  [PurchaseOrderStatus.DRAFT]: {
    label: 'Piszkozat',
    badgeClass: 'bg-slate-100 text-slate-700 border border-slate-200',
    severity: 'secondary',
    icon: 'pi pi-file-edit',
  },
  [PurchaseOrderStatus.ORDERED]: {
    label: 'Megrendelve',
    badgeClass: 'bg-sky-50 text-sky-700 border border-sky-200',
    severity: 'info',
    icon: 'pi pi-send',
  },
  [PurchaseOrderStatus.CONFIRMED]: {
    label: 'Visszaigazolva',
    badgeClass: 'bg-indigo-50 text-indigo-700 border border-indigo-200',
    severity: 'info',
    icon: 'pi pi-verified',
  },
  [PurchaseOrderStatus.PARTIALLY_RECEIVED]: {
    label: 'Részben beérkezett',
    badgeClass: 'bg-amber-50 text-amber-700 border border-amber-200',
    severity: 'warn',
    icon: 'pi pi-clock',
  },
  [PurchaseOrderStatus.RECEIVED]: {
    label: 'Beérkezett',
    badgeClass: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    severity: 'success',
    icon: 'pi pi-check-circle',
  },
  [PurchaseOrderStatus.CLOSED]: {
    label: 'Lezárva',
    badgeClass: 'bg-teal-50 text-teal-700 border border-teal-200',
    severity: 'contrast',
    icon: 'pi pi-lock',
  },
  [PurchaseOrderStatus.CANCELLED]: {
    label: 'Sztornózva',
    badgeClass: 'bg-rose-50 text-rose-700 border border-rose-200',
    severity: 'danger',
    icon: 'pi pi-times-circle',
  },
}

export const GOODS_RECEIPT_STATUS_META: Record<GoodsReceiptStatus, ProcurementStatusMeta> = {
  [GoodsReceiptStatus.OPEN]: {
    label: 'Nyitott',
    badgeClass: 'bg-sky-50 text-sky-700 border border-sky-200',
    severity: 'info',
    icon: 'pi pi-inbox',
  },
  [GoodsReceiptStatus.IN_PROGRESS]: {
    label: 'Folyamatban',
    badgeClass: 'bg-amber-50 text-amber-700 border border-amber-200',
    severity: 'warn',
    icon: 'pi pi-sync',
  },
  [GoodsReceiptStatus.WAITING_FOR_APPROVAL]: {
    label: 'Jóváhagyásra vár',
    badgeClass: 'bg-orange-50 text-orange-700 border border-orange-200',
    severity: 'warn',
    icon: 'pi pi-exclamation-triangle',
  },
  [GoodsReceiptStatus.COMPLETED]: {
    label: 'Lezárva',
    badgeClass: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    severity: 'success',
    icon: 'pi pi-check-circle',
  },
  [GoodsReceiptStatus.CANCELLED]: {
    label: 'Törölve',
    badgeClass: 'bg-rose-50 text-rose-700 border border-rose-200',
    severity: 'danger',
    icon: 'pi pi-times-circle',
  },
}

export const PURCHASE_ORDER_STATUS_OPTIONS: Array<{ label: string; value: PurchaseOrderStatus }> = (
  Object.values(PurchaseOrderStatus) as PurchaseOrderStatus[]
).map((status) => ({
  label: PURCHASE_ORDER_STATUS_META[status].label,
  value: status,
}))

export const GOODS_RECEIPT_STATUS_OPTIONS: Array<{ label: string; value: GoodsReceiptStatus }> = (
  Object.values(GoodsReceiptStatus) as GoodsReceiptStatus[]
).map((status) => ({
  label: GOODS_RECEIPT_STATUS_META[status].label,
  value: status,
}))

export function formatCurrency(
  val: number | string | null | undefined,
  currency?: string | null,
): string {
  if (val === undefined || val === null || val === '') return '—'
  const num = Number(val)
  if (Number.isNaN(num)) return String(val)
  const code = (currency || 'HUF').trim().toUpperCase()
  if (code === 'HUF') {
    return `${num.toLocaleString('hu-HU', { maximumFractionDigits: 2 })} Ft`
  }
  return `${num.toLocaleString('hu-HU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${code}`
}
