<script setup lang="ts">
import { computed } from 'vue'
import type { LocationItem } from '@/api/locations'
import type { StockItemEntry, StockMovementEntry } from '@/api/stock'
import { formatDateTime, formatSignedQuantity, MOVEMENT_TYPE_META } from '@/utils/formatters'
import { getLocationPath, LOCATION_TYPE_META } from '@/utils/locationMeta'

const props = defineProps<{
  stockItems: StockItemEntry[]
  stockMovements: StockMovementEntry[]
  loading: boolean
  locations: LocationItem[]
  canAdjustStock: boolean
  canReportStock: boolean
}>()

const emit = defineEmits<{
  (e: 'adjustStock', locationId?: string | null, variantId?: string | null): void
  (e: 'reportStock', locationId: string, variantId: string, expectedQty: number): void
}>()

const locationById = computed(() => new Map(props.locations.map((l) => [l.id, l])))

const visibleStockItems = computed(() =>
  props.stockItems.filter((item) => item.quantity > 0 || item.reservedQuantity > 0),
)

const totalStockQty = computed(() =>
  props.stockItems.reduce((sum, item) => sum + item.quantity, 0),
)

const totalReservedQty = computed(() =>
  props.stockItems.reduce((sum, item) => sum + item.reservedQuantity, 0),
)

const totalFreeQty = computed(() => totalStockQty.value - totalReservedQty.value)

function formatLocationBreadcrumb(location: LocationItem): string {
  const path = getLocationPath(location.id, locationById.value)
  if (path.length > 0) {
    return path.map((loc) => loc.name).join(' › ')
  }
  return location.name
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-xs text-slate-500">
        A termék aktuális készlete tárhelyek szerint és az utolsó 15 készletmozgás.
      </p>
      <button
        v-if="props.canAdjustStock"
        type="button"
        @click="emit('adjustStock', null, null)"
        class="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition shadow-sm"
      >
        <i class="pi pi-plus text-[11px]"></i>
        <span>Készlet felvitele / korrekció</span>
      </button>
    </div>

    <div
      v-if="props.loading && props.stockItems.length === 0 && props.stockMovements.length === 0"
      class="py-10 text-center text-xs text-slate-400"
    >
      <i class="pi pi-spin pi-spinner mr-1.5"></i> Készletadatok betöltése...
    </div>

    <template v-else>
      <!-- 3 Összesítő mini-kártya -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div class="p-4 rounded-2xl bg-slate-50/80 border border-slate-100">
          <span class="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Összes készlet
          </span>
          <span class="text-xl font-bold text-slate-900 mt-1 block">
            {{ totalStockQty.toLocaleString('hu-HU') }} db
          </span>
        </div>
        <div class="p-4 rounded-2xl bg-slate-50/80 border border-slate-100">
          <span class="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Foglalt készlet
          </span>
          <span class="text-xl font-bold text-amber-700 mt-1 block">
            {{ totalReservedQty.toLocaleString('hu-HU') }} db
          </span>
        </div>
        <div class="p-4 rounded-2xl bg-emerald-50/60 border border-emerald-100">
          <span class="block text-[11px] font-bold uppercase tracking-wider text-emerald-700">
            Elérhető (szabad)
          </span>
          <span
            class="text-xl font-bold mt-1 block"
            :class="totalFreeQty > 0 ? 'text-emerald-700' : 'text-slate-600'"
          >
            {{ totalFreeQty.toLocaleString('hu-HU') }} db
          </span>
        </div>
      </div>

      <!-- Pozíció szerinti készlet táblázat -->
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-bold text-slate-900">Pozíció szerinti készlet</h3>
          <span class="text-xs font-semibold text-slate-400">
            {{ visibleStockItems.length }} pozíció
          </span>
        </div>

        <div
          v-if="visibleStockItems.length === 0"
          class="py-8 px-4 text-center bg-slate-50/60 rounded-2xl border border-dashed border-slate-200 space-y-2"
        >
          <i class="pi pi-inbox text-2xl text-slate-300 block"></i>
          <p class="text-xs text-slate-500">
            Ennek a terméknek jelenleg minden pozíción 0 db a készlete.
          </p>
          <button
            v-if="props.canAdjustStock"
            type="button"
            @click="emit('adjustStock', null, null)"
            class="text-xs font-semibold text-orange-600 hover:underline cursor-pointer"
          >
            + Kezdeti készlet felvitele
          </button>
        </div>

        <div v-else class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr
                class="text-[11px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100"
              >
                <th class="pb-3 pr-3">Pozíció</th>
                <th class="pb-3 pr-3">Variáns</th>
                <th class="pb-3 pr-3 text-right">Összes</th>
                <th class="pb-3 pr-3 text-right">Foglalt</th>
                <th class="pb-3 pr-3 text-right">Elérhető</th>
                <th v-if="props.canAdjustStock || props.canReportStock" class="pb-3 text-right">
                  Művelet
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 text-sm">
              <tr
                v-for="item in visibleStockItems"
                :key="item.id"
                class="hover:bg-slate-50/70 transition"
              >
                <td class="py-3 pr-3">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="font-semibold text-slate-800 text-xs">
                      {{ formatLocationBreadcrumb(item.location) }}
                    </span>
                    <span
                      class="text-[10px] font-bold px-2 py-0.5 rounded-full"
                      :class="LOCATION_TYPE_META[item.location.type].badgeClass"
                    >
                      {{ LOCATION_TYPE_META[item.location.type].label }}
                    </span>
                    <span
                      v-if="item.isExternalLocation"
                      class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200"
                    >
                      Másik telephely (összesített)
                    </span>
                  </div>
                </td>
                <td class="py-3 pr-3 text-xs text-slate-700">
                  <template v-if="item.variant.size">
                    <span class="font-bold text-slate-900">{{ item.variant.size }}</span>
                    <span class="text-slate-400 mx-1">·</span>
                  </template>
                  <template v-if="item.variant.colors.length > 0">
                    <span>{{ item.variant.colors.join(', ') }}</span>
                    <span class="text-slate-400 mx-1">·</span>
                  </template>
                  <span class="font-mono text-slate-500">{{ item.variant.sku }}</span>
                </td>
                <td class="py-3 pr-3 text-right font-semibold text-slate-800 whitespace-nowrap">
                  {{ item.quantity }} db
                </td>
                <td class="py-3 pr-3 text-right text-amber-700 whitespace-nowrap">
                  {{ item.reservedQuantity }} db
                </td>
                <td class="py-3 pr-3 text-right whitespace-nowrap">
                  <span
                    class="inline-block text-xs font-bold px-2 py-0.5 rounded-full"
                    :class="
                      item.quantity - item.reservedQuantity > 0
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-rose-50 text-rose-600'
                    "
                  >
                    {{ item.quantity - item.reservedQuantity }} db
                  </span>
                </td>
                <td
                  v-if="props.canAdjustStock || props.canReportStock"
                  class="py-3 text-right whitespace-nowrap"
                >
                  <div v-if="!item.isExternalLocation" class="inline-flex items-center gap-1.5">
                    <button
                      v-if="props.canAdjustStock"
                      type="button"
                      @click="emit('adjustStock', item.locationId, item.variantId)"
                      class="px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-100 text-[11px] font-semibold text-slate-700 cursor-pointer transition"
                    >
                      Áthelyezés / Korrekció
                    </button>
                    <button
                      v-if="props.canReportStock"
                      type="button"
                      @click="emit('reportStock', item.locationId, item.variantId, item.quantity)"
                      class="px-2.5 py-1 rounded-lg border border-amber-200 bg-amber-50/70 hover:bg-amber-100 text-[11px] font-semibold text-amber-800 inline-flex items-center gap-1 cursor-pointer transition"
                      title="Hiány / eltérés jelentése ezen a pozíción"
                    >
                      <i class="pi pi-exclamation-triangle text-[10px]"></i>
                      <span>Hiány jelentése</span>
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Legutóbbi készletmozgások -->
      <div class="space-y-3 pt-2 border-t border-slate-100">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-bold text-slate-900">Legutóbbi készletmozgások</h3>
          <span class="text-xs font-semibold text-slate-400">
            Utolsó {{ props.stockMovements.length }} mozgás
          </span>
        </div>

        <div
          v-if="props.stockMovements.length === 0"
          class="py-6 px-4 text-center bg-slate-50/60 rounded-2xl border border-dashed border-slate-200 text-xs text-slate-400"
        >
          Még nincs rögzített készletmozgás ehhez a termékhez.
        </div>

        <div v-else class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr
                class="text-[11px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100"
              >
                <th class="pb-3 pr-3">Időpont</th>
                <th class="pb-3 pr-3">Típus</th>
                <th class="pb-3 pr-3">Variáns</th>
                <th class="pb-3 pr-3">Pozíció</th>
                <th class="pb-3 pr-3 text-right">Mennyiség</th>
                <th class="pb-3 pr-3">Rögzítette</th>
                <th class="pb-3">Megjegyzés</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 text-xs">
              <tr
                v-for="m in props.stockMovements"
                :key="m.id"
                class="hover:bg-slate-50/70 transition"
              >
                <td class="py-3 pr-3 text-slate-500 whitespace-nowrap">
                  {{ formatDateTime(m.createdAt) }}
                </td>
                <td class="py-3 pr-3 whitespace-nowrap">
                  <span
                    class="inline-block text-[11px] font-bold px-2 py-0.5 rounded-full"
                    :class="MOVEMENT_TYPE_META[m.type].badgeClass"
                  >
                    {{ MOVEMENT_TYPE_META[m.type].label }}
                  </span>
                </td>
                <td class="py-3 pr-3 whitespace-nowrap">
                  <span class="font-mono text-slate-700">{{ m.variant.sku }}</span>
                  <span v-if="m.variant.size" class="text-slate-400 ml-1">({{ m.variant.size }})</span>
                </td>
                <td class="py-3 pr-3 text-slate-700">
                  {{ m.location.name }}
                </td>
                <td
                  class="py-3 pr-3 text-right font-bold whitespace-nowrap"
                  :class="
                    m.quantity > 0
                      ? 'text-emerald-700'
                      : m.quantity < 0
                        ? 'text-rose-600'
                        : 'text-slate-600'
                  "
                >
                  {{ formatSignedQuantity(m.quantity) }}
                </td>
                <td class="py-3 pr-3 text-slate-600 whitespace-nowrap">
                  {{ m.createdByUser?.name ?? '—' }}
                </td>
                <td class="py-3 text-slate-500 max-w-[200px] truncate" :title="m.note ?? ''">
                  {{ m.note || '—' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>
