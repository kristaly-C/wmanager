import { MovementType } from '@wmanager/shared-types'

export function formatPrice(val: number | string | null | undefined): string {
  if (val === undefined || val === null || val === '') return '—'
  const num = Number(val)
  if (Number.isNaN(num)) return String(val)
  return `${num.toLocaleString('hu-HU')} Ft`
}

export function formatWeight(val: number | string | null | undefined): string {
  if (val === undefined || val === null || val === '') return '—'
  const num = Number(val)
  if (Number.isNaN(num)) return String(val)
  return `${num.toLocaleString('hu-HU')} kg`
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('hu-HU', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatSignedQuantity(qty: number): string {
  return qty > 0 ? `+${qty} db` : `${qty} db`
}

export const MOVEMENT_TYPE_META: Record<MovementType, { label: string; badgeClass: string }> = {
  [MovementType.INITIAL_STOCK]: {
    label: 'Kezdeti készlet',
    badgeClass: 'bg-sky-50 text-sky-700 border border-sky-200',
  },
  [MovementType.PURCHASE_RECEIPT]: {
    label: 'Bevételezés',
    badgeClass: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  },
  [MovementType.SALE]: {
    label: 'Eladás',
    badgeClass: 'bg-rose-50 text-rose-700 border border-rose-200',
  },
  [MovementType.TRANSFER_OUT]: {
    label: 'Transzfer ki',
    badgeClass: 'bg-orange-50 text-orange-700 border border-orange-200',
  },
  [MovementType.TRANSFER_IN]: {
    label: 'Transzfer be',
    badgeClass: 'bg-indigo-50 text-indigo-700 border border-indigo-200',
  },
  [MovementType.STOCKTAKE_ADJUSTMENT]: {
    label: 'Leltárkorrekció',
    badgeClass: 'bg-purple-50 text-purple-700 border border-purple-200',
  },
  [MovementType.RETURN_RESTOCK]: {
    label: 'Visszáru visszavét',
    badgeClass: 'bg-teal-50 text-teal-700 border border-teal-200',
  },
  [MovementType.MANUAL_CORRECTION]: {
    label: 'Kézi korrekció',
    badgeClass: 'bg-amber-50 text-amber-700 border border-amber-200',
  },
}
