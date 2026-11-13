import { LocationType, SlotMode } from '@wmanager/shared-types'
import type { LocationItem } from '@/api/locations'

export interface LocationTypeMeta {
  label: string
  pluralLabel: string
  childType: LocationType | null
  childButtonLabel: string | null
  icon: string
  badgeClass: string
  iconBgClass: string
  allowedParentTypes: LocationType[]
}

export const LOCATION_TYPE_META: Record<LocationType, LocationTypeMeta> = {
  [LocationType.WAREHOUSE]: {
    label: 'Raktár',
    pluralLabel: 'Raktárak',
    childType: LocationType.ZONE,
    childButtonLabel: '+ Zóna',
    icon: 'pi pi-warehouse',
    badgeClass: 'bg-slate-900 text-white',
    iconBgClass: 'bg-slate-900 text-white',
    allowedParentTypes: [],
  },
  [LocationType.STORE]: {
    label: 'Üzlet',
    pluralLabel: 'Üzletek',
    childType: LocationType.ZONE,
    childButtonLabel: '+ Zóna',
    icon: 'pi pi-shop',
    badgeClass: 'bg-orange-50 text-orange-700 border border-orange-200',
    iconBgClass: 'bg-orange-500 text-white',
    allowedParentTypes: [],
  },
  [LocationType.ZONE]: {
    label: 'Zóna',
    pluralLabel: 'Zónák',
    childType: LocationType.SHELF,
    childButtonLabel: '+ Polc',
    icon: 'pi pi-th-large',
    badgeClass: 'bg-blue-50 text-blue-700 border border-blue-200',
    iconBgClass: 'bg-blue-50 text-blue-600 border border-blue-200',
    allowedParentTypes: [LocationType.WAREHOUSE, LocationType.STORE],
  },
  [LocationType.SHELF]: {
    label: 'Polc',
    pluralLabel: 'Polcok',
    childType: LocationType.BIN,
    childButtonLabel: '+ Rekesz',
    icon: 'pi pi-bars',
    badgeClass: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    iconBgClass: 'bg-emerald-50 text-emerald-600 border border-emerald-200',
    allowedParentTypes: [LocationType.ZONE],
  },
  [LocationType.BIN]: {
    label: 'Rekesz',
    pluralLabel: 'Rekeszek',
    childType: null,
    childButtonLabel: null,
    icon: 'pi pi-inbox',
    badgeClass: 'bg-purple-50 text-purple-700 border border-purple-200',
    iconBgClass: 'bg-purple-50 text-purple-600 border border-purple-200',
    allowedParentTypes: [LocationType.SHELF],
  },
}

export const SLOT_MODE_META: Record<
  SlotMode,
  { label: string; shortLabel: string; description: string; badgeClass: string }
> = {
  [SlotMode.DEDICATED]: {
    label: 'Dedikált (1 variáns)',
    shortLabel: 'Dedikált',
    description: 'Egyszerre csak egyetlen termékvariánsból tárolható rajta készlet.',
    badgeClass: 'bg-amber-50 text-amber-700 border border-amber-200',
  },
  [SlotMode.MIXED]: {
    label: 'Vegyes (több variáns)',
    shortLabel: 'Vegyes',
    description: 'Többféle termékvariáns is elhelyezhető ugyanazon a pozíción.',
    badgeClass: 'bg-teal-50 text-teal-700 border border-teal-200',
  },
}

export function supportsSlotMode(type: LocationType): boolean {
  return type === LocationType.ZONE || type === LocationType.SHELF || type === LocationType.BIN
}

export function getLocationPath(
  locationId: string,
  byId: Map<string, LocationItem>,
): LocationItem[] {
  const path: LocationItem[] = []
  const seen = new Set<string>()
  let current = byId.get(locationId)
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    path.unshift(current)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return path
}

export function extractApiError(err: unknown, fallback: string): string {
  const responseErr = err as { response?: { data?: { message?: string | string[] } } }
  const msg = responseErr?.response?.data?.message
  if (Array.isArray(msg)) return msg.join(', ')
  if (typeof msg === 'string' && msg.trim()) return msg
  return fallback
}
