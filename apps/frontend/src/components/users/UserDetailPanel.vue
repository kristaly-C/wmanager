<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Role, LocationType } from '@wmanager/shared-types'
import type { UserItem } from '@/api/users'
import type { LocationItem } from '@/api/locations'
import { formatDateTime } from '@/utils/formatters'

export interface RoleMetaItem {
  label: string
  isUnbound: boolean
  permissions: string[]
}

const props = defineProps<{
  user: UserItem
  roleMeta: Record<Role, RoleMetaItem>
  availableLocations: LocationItem[]
  canManage: boolean
  isSelf: boolean
  loading?: boolean
}>()

const emit = defineEmits<{
  (e: 'edit', user: UserItem): void
  (e: 'toggleActive', user: UserItem): void
  (e: 'requestDelete', user: UserItem): void
  (e: 'assignLocation', locationId: string): void
  (e: 'unassignLocation', locationId: string): void
}>()

const selectedLocationToAssign = ref('')

watch(
  () => [props.user.id, props.user.userLocations?.length],
  () => {
    selectedLocationToAssign.value = ''
  },
)

const locationsSummaryLabel = computed(() => {
  if (props.roleMeta[props.user.role]?.isUnbound) {
    return 'Minden raktár'
  }
  const locs = props.user.userLocations?.map((ul) => ul.location?.name).filter(Boolean) ?? []
  if (locs.length === 0) return 'Nincs hozzárendelve'
  return locs.join(', ')
})

function handleAssignClick() {
  if (!selectedLocationToAssign.value) return
  emit('assignLocation', selectedLocationToAssign.value)
}
</script>

<template>
  <div class="space-y-4">
    <!-- 1. Kártya: Felhasználó adatai -->
    <div class="bg-[#f8f9f7] border border-white rounded-[16px] p-6 shadow-xs space-y-5">
      <div class="flex items-center justify-between">
        <h3 class="text-[18px] font-semibold text-[#171918]">Felhasználó adatai</h3>

        <div v-if="canManage" class="flex items-center gap-1">
          <button
            type="button"
            @click="emit('toggleActive', user)"
            :disabled="loading || isSelf"
            class="text-xs px-2.5 py-1 rounded-lg border border-[#e8eae6] bg-white hover:bg-slate-50 text-[#686f6a] hover:text-[#171918] cursor-pointer transition disabled:opacity-40"
            :title="user.isActive ? 'Fiók felfüggesztése' : 'Fiók aktiválása'"
          >
            {{ user.isActive ? 'Tiltás' : 'Aktiválás' }}
          </button>
          <button
            v-if="user.role !== Role.BOSS && !isSelf"
            type="button"
            @click="emit('requestDelete', user)"
            class="text-xs p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 cursor-pointer transition"
            title="Felhasználó törlése"
          >
            <i class="pi pi-trash text-xs"></i>
          </button>
        </div>
      </div>

      <!-- Szerepkör ikon + Név + Aktív jelvény -->
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-3.5 min-w-0">
          <div class="bg-[#fff0e5] rounded-[14px] size-[52px] flex items-center justify-center shrink-0">
            <i class="pi pi-shield text-[22px] text-[#f46714]"></i>
          </div>
          <div class="min-w-0">
            <p class="text-[21px] font-semibold text-[#171918] leading-tight truncate">
              {{ user.name }}
            </p>
            <p class="text-[12px] text-[#686f6a] mt-0.5 truncate">
              {{ roleMeta[user.role]?.label ?? user.role }} ·
              {{ locationsSummaryLabel }}
            </p>
          </div>
        </div>

        <span
          class="inline-flex items-center px-2.5 py-1 rounded-[7px] text-[11px] font-medium shrink-0"
          :class="
            user.isActive
              ? 'bg-[#e5f0e8] text-[#298653]'
              : 'bg-[#eaeee8] text-[#686f6a]'
          "
        >
          {{ user.isActive ? 'Aktív' : 'Inaktív' }}
        </span>
      </div>

      <div class="h-px bg-[#e8eae6]"></div>

      <!-- Adatmezők -->
      <div class="space-y-3.5">
        <div>
          <span class="block text-[11px] text-[#686f6a]">E-mail</span>
          <span class="block text-[13px] text-[#171918] mt-0.5">{{ user.email }}</span>
        </div>

        <div>
          <span class="block text-[11px] text-[#686f6a]">Hozzárendelt raktár / üzlet</span>
          <div
            v-if="roleMeta[user.role]?.isUnbound"
            class="text-[13px] text-[#171918] mt-0.5"
          >
            Minden raktár és üzlet (globális szerepkör)
          </div>
          <div v-else class="mt-1.5 space-y-2">
            <!-- Hozzárendelt raktárak chipjei eltávolítás gombbal -->
            <div class="flex flex-wrap gap-1.5">
              <span
                v-if="!user.userLocations || user.userLocations.length === 0"
                class="text-[12px] text-amber-700 bg-[#fff0d9] px-2.5 py-1 rounded-[7px]"
              >
                Nincs még raktár vagy üzlet hozzárendelve
              </span>
              <span
                v-for="ul in user.userLocations"
                :key="ul.id"
                class="inline-flex items-center gap-1.5 bg-white border border-[#e8eae6] px-2.5 py-1 rounded-[8px] text-[12px] text-[#171918]"
              >
                <span>{{ ul.location?.name }}</span>
                <button
                  v-if="canManage"
                  type="button"
                  @click="emit('unassignLocation', ul.locationId)"
                  :disabled="loading"
                  class="text-[#686f6a] hover:text-rose-600 cursor-pointer disabled:opacity-40"
                  title="Hozzárendelés eltávolítása"
                >
                  <i class="pi pi-times text-[10px]"></i>
                </button>
              </span>
            </div>

            <!-- Gyors raktár/bolt hozzárendelés -->
            <div
              v-if="canManage && availableLocations.length > 0"
              class="flex items-center gap-2 pt-1"
            >
              <select
                v-model="selectedLocationToAssign"
                class="flex-1 h-[34px] bg-white border border-[#e8eae6] rounded-[8px] px-2.5 text-[12px] text-[#171918] outline-none"
              >
                <option value="">+ Raktár vagy üzlet hozzáadása...</option>
                <option
                  v-for="loc in availableLocations"
                  :key="loc.id"
                  :value="loc.id"
                >
                  {{ loc.name }} ({{ loc.type === LocationType.WAREHOUSE ? 'Raktár' : 'Üzlet' }})
                </option>
              </select>
              <button
                v-if="selectedLocationToAssign"
                type="button"
                @click="handleAssignClick"
                :disabled="loading"
                class="h-[34px] px-3 rounded-[8px] bg-[#171918] text-white text-xs font-medium cursor-pointer disabled:opacity-50"
              >
                Hozzáadás
              </button>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2 pt-1">
          <div>
            <span class="block text-[11px] text-[#686f6a]">Regisztrálva</span>
            <span class="block text-[13px] text-[#171918] mt-0.5">
              {{ formatDateTime(user.createdAt) }}
            </span>
          </div>
          <div>
            <span class="block text-[11px] text-[#686f6a]">Utolsó jelszócsere</span>
            <span class="block text-[13px] text-[#171918] mt-0.5">
              {{ user.passwordChangedAt ? formatDateTime(user.passwordChangedAt) : 'Alapértelmezett' }}
            </span>
          </div>
        </div>
      </div>

      <!-- Hozzáférés szerkesztése gomb -->
      <button
        v-if="canManage"
        type="button"
        @click="emit('edit', user)"
        class="w-full h-[44px] bg-[#171918] hover:bg-[#2a2d2b] border border-white rounded-[11px] px-4 text-[13px] font-medium text-white flex items-center justify-between transition cursor-pointer"
      >
        <span>Hozzáférés szerkesztése</span>
        <i class="pi pi-arrow-right text-xs"></i>
      </button>
    </div>

    <!-- 2. Kártya: Hozzáférés és biztonság -->
    <div class="bg-[#f8f9f7] border border-white rounded-[16px] p-6 shadow-xs space-y-4">
      <div>
        <h3 class="text-[17px] font-semibold text-[#171918]">Hozzáférés és biztonság</h3>
        <p class="text-[12px] text-[#686f6a] mt-0.5">
          {{ roleMeta[user.role]?.label }} jogosultságok
        </p>
      </div>

      <div class="space-y-2.5">
        <div
          v-for="perm in roleMeta[user.role]?.permissions ?? []"
          :key="perm"
          class="flex items-start gap-2.5 text-[12px] text-[#171918]"
        >
          <i class="pi pi-check text-xs text-[#298653] mt-0.5 shrink-0"></i>
          <span>{{ perm }}</span>
        </div>
      </div>

      <div class="h-px bg-[#e8eae6]"></div>

      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <i class="pi pi-lock text-[18px] text-[#f46714]"></i>
          <div>
            <p class="text-[12px] font-medium text-[#171918]">Helyszínalapú hozzáférés-védelem</p>
            <p class="text-[11px] text-[#686f6a]">
              {{
                roleMeta[user.role]?.isUnbound
                  ? 'Minden telephelyre érvényes jogosultság'
                  : 'Csak a hozzárendelt raktár/bolt hierarchiát éri el'
              }}
            </p>
          </div>
        </div>
        <span class="bg-[#e5f0e8] text-[#298653] text-[11px] font-medium px-2.5 py-1 rounded-[7px] shrink-0">
          RBAC
        </span>
      </div>
    </div>
  </div>
</template>
