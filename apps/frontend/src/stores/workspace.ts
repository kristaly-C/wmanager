import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { Role } from '@wmanager/shared-types'
import { useAuthStore } from './auth'

// 1. TÍPUSOK (TypeScript interfészek)
export type WorkspaceId = 'warehouse' | 'office' | 'support' | 'management'

export interface NavItem {
  label: string
  icon: string
  to: string
}

export interface WorkspaceConfig {
  id: WorkspaceId
  label: string
  icon: string
  allowedRoles: Role[]
  navItems: NavItem[]
}

// 2. KONFIGURÁCIÓ: A 4 munkaterület és a felső "kapszula" menüpontjaik
export const WORKSPACES: WorkspaceConfig[] = [
  {
    id: 'warehouse',
    label: 'Raktár',
    icon: 'pi pi-box',
    allowedRoles: [Role.ADMIN, Role.BOSS, Role.WAREHOUSE_MANAGER, Role.WAREHOUSE_STAFF],
    navItems: [
      { label: 'Áttekintés', icon: 'pi pi-home', to: '/' },
      { label: 'Készlet & Térkép', icon: 'pi pi-box', to: '/inventory' },
      { label: 'Be- és Kiszállítás', icon: 'pi pi-truck', to: '/shipments' },
      { label: 'Leltár', icon: 'pi pi-check-square', to: '/stocktakes' },
    ],
  },
  {
    id: 'office',
    label: 'Iroda & Beszerzés',
    icon: 'pi pi-briefcase',
    allowedRoles: [Role.ADMIN, Role.BOSS, Role.ORDER_CLERK, Role.WAREHOUSE_MANAGER, Role.STORE_MANAGER],
    navItems: [
      { label: 'Áttekintés', icon: 'pi pi-home', to: '/' },
      { label: 'Katalógus', icon: 'pi pi-tags', to: '/categories' }, // Később '/catalog' al-fülekkel
      { label: 'Beszerzés', icon: 'pi pi-shopping-cart', to: '/purchase-orders' },
      { label: 'Áruszétosztás', icon: 'pi pi-arrows-h', to: '/transfers' },
    ],
  },
  {
    id: 'support',
    label: 'Ügyfélszolgálat',
    icon: 'pi pi-headphones',
    allowedRoles: [Role.ADMIN, Role.BOSS, Role.RMA_CLERK, Role.ORDER_CLERK, Role.STORE_MANAGER, Role.STORE_STAFF],
    navItems: [
      { label: 'Áttekintés', icon: 'pi pi-home', to: '/' },
      { label: 'Rendelések', icon: 'pi pi-shopping-bag', to: '/orders' },
      { label: 'Visszáru (RMA)', icon: 'pi pi-replay', to: '/returns' },
      { label: 'Készletinfó', icon: 'pi pi-search', to: '/stock-lookup' },
    ],
  },
  {
    id: 'management',
    label: 'Vezetői',
    icon: 'pi pi-chart-line',
    allowedRoles: [Role.ADMIN, Role.BOSS],
    navItems: [
      { label: 'Pénzügy & KPI', icon: 'pi pi-chart-line', to: '/' },
      { label: 'Audit Napló', icon: 'pi pi-history', to: '/movements' },
      { label: 'Felhasználók', icon: 'pi pi-users', to: '/users' },
    ],
  },
]

// 3. A PINIA STORE DEFINIÁLÁSA
export const useWorkspaceStore = defineStore('workspace', () => {
  const authStore = useAuthStore()

  // STATE: Az elmentett munkaterület azonosítója (ha nincs, 'warehouse' az alapértelmezett)
  const savedWorkspace = localStorage.getItem('activeWorkspace') as WorkspaceId | null
  const activeWorkspaceId = ref<WorkspaceId>(savedWorkspace || 'warehouse')

  // GETTER 1: Mely munkaterületekhez van joga a belépett felhasználónak?
  const availableWorkspaces = computed(() => {
    const userRole = authStore.user?.role
    if (!userRole) return []

    return WORKSPACES.filter((ws) => ws.allowedRoles.includes(userRole))
  })

  // GETTER 2: Az aktuálisan aktív munkaterület objektuma
  const activeWorkspace = computed(() => {
    // Megkeressük a kiválasztottat az elérhetőek között
    const found = availableWorkspaces.value.find((ws) => ws.id === activeWorkspaceId.value)
    // Ha a usernek nincs joga a localStorage-ban maradt munkaterülethez, visszaadjuk az első elérhetőt
    return found ?? availableWorkspaces.value[0] ?? null
  })

  // ACTION: Munkaterület váltása
  function setWorkspace(id: WorkspaceId) {
    activeWorkspaceId.value = id
    localStorage.setItem('activeWorkspace', id)
  }

  return {
    activeWorkspaceId,
    availableWorkspaces,
    activeWorkspace,
    setWorkspace,
  }
})