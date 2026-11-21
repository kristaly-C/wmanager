<script setup lang="ts">
import { computed } from 'vue'
import type { VariantBarcodeItem, VariantItem } from '@/api/variants'
import { formatPrice, formatWeight } from '@/utils/formatters'

const props = defineProps<{
  variants: VariantItem[]
  loading: boolean
  productImageUrls?: string[]
  canManageCatalog: boolean
  canAdjustStock: boolean
  canSeeCostPrice: boolean
  freeStockByVariantId: Map<string, number>
}>()

const emit = defineEmits<{
  (e: 'createVariant'): void
  (e: 'cloneVariant', variant: VariantItem): void
  (e: 'editVariant', variant: VariantItem): void
  (e: 'deleteVariant', variant: VariantItem): void
  (e: 'openBarcodes', variant: VariantItem): void
  (e: 'adjustStock', variantId: string): void
  (e: 'selectHeroImage', url: string): void
}>()

const SIZE_ORDER: Record<string, number> = {
  XXS: 1,
  XS: 2,
  S: 3,
  M: 4,
  L: 5,
  XL: 6,
  '2XL': 7,
  XXL: 7,
  '3XL': 8,
  XXXL: 8,
  '4XL': 9,
  '5XL': 10,
  UNI: 100,
}

function compareSizes(a?: string | null, b?: string | null): number {
  const normA = (a ?? '').trim().toUpperCase()
  const normB = (b ?? '').trim().toUpperCase()
  const rankA = SIZE_ORDER[normA]
  const rankB = SIZE_ORDER[normB]
  if (rankA !== undefined && rankB !== undefined) return rankA - rankB
  if (rankA !== undefined) return -1
  if (rankB !== undefined) return 1
  return normA.localeCompare(normB, 'hu', { numeric: true })
}

function getVariantFreeStock(variantId: string): number {
  return props.freeStockByVariantId.get(variantId) ?? 0
}

function getVariantThumbnail(variant: VariantItem): string | null {
  return variant.imageUrls?.[0] || props.productImageUrls?.[0] || null
}

function getPrimaryBarcode(variant: VariantItem): VariantBarcodeItem | undefined {
  const list = variant.variantBarcodes ?? []
  return list.find((b) => b.isPrimary) ?? list[0]
}

interface VariantColorGroup {
  key: string
  label: string
  thumbnail: string | null
  templateVariant: VariantItem
  totalFreeStock: number
  variants: VariantItem[]
}

const variantColorGroups = computed<VariantColorGroup[]>(() => {
  const groups = new Map<string, VariantItem[]>()
  for (const v of props.variants) {
    const cleanColors = (v.colors ?? []).map((c) => c.trim()).filter(Boolean)
    const key =
      cleanColors.length > 0
        ? cleanColors.map((c) => c.toLowerCase()).join(' | ')
        : '__no_color__'
    const list = groups.get(key)
    if (list) {
      list.push(v)
    } else {
      groups.set(key, [v])
    }
  }

  return Array.from(groups.entries())
    .map(([key, items]) => {
      const sortedItems = [...items].sort((a, b) => compareSizes(a.size, b.size))
      const first = sortedItems[0]!
      const cleanColors = (first.colors ?? []).map((c) => c.trim()).filter(Boolean)
      const label = cleanColors.length > 0 ? cleanColors.join(', ') : 'Szín nélkül'
      const thumbnail =
        sortedItems.map((item) => getVariantThumbnail(item)).find((url) => url !== null) ?? null
      const totalFreeStock = sortedItems.reduce(
        (sum, item) => sum + getVariantFreeStock(item.id),
        0,
      )
      return {
        key,
        label,
        thumbnail,
        templateVariant: first,
        totalFreeStock,
        variants: sortedItems,
      }
    })
    .sort((a, b) => a.label.localeCompare(b.label, 'hu'))
})
</script>

<template>
  <div class="space-y-3">
    <div v-if="props.canManageCatalog" class="flex justify-end">
      <button
        type="button"
        @click="emit('createVariant')"
        class="text-xs font-semibold text-orange-600 hover:text-orange-700 flex items-center gap-1 cursor-pointer"
      >
        <i class="pi pi-plus text-[10px]"></i>
        <span>Új variáns hozzáadása</span>
      </button>
    </div>

    <div v-if="props.loading" class="py-8 text-center text-xs text-slate-400">
      <i class="pi pi-spin pi-spinner mr-1.5"></i> Variánsok betöltése...
    </div>

    <div
      v-else-if="props.variants.length === 0"
      class="py-8 text-center bg-slate-50/60 rounded-2xl border border-dashed border-slate-200 text-xs text-slate-400"
    >
      Ehhez a termékhez még nem tartozik variáns.
    </div>

    <div v-else class="space-y-4">
      <div
        v-for="group in variantColorGroups"
        :key="group.key"
        class="rounded-2xl border border-slate-200/80 bg-white overflow-hidden"
      >
        <!-- Színváltozat csoportfejléc -->
        <div
          class="bg-slate-50/80 border-b border-slate-100 px-4 py-3 flex items-center justify-between gap-3"
        >
          <div class="flex items-center gap-3 min-w-0">
            <button
              v-if="group.thumbnail"
              type="button"
              @click="emit('selectHeroImage', group.thumbnail)"
              :title="`Kép megtekintése: ${group.label}`"
              class="shrink-0 cursor-pointer rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500/40"
            >
              <img
                :src="group.thumbnail"
                :alt="group.label"
                class="w-11 h-11 rounded-xl aspect-square object-contain bg-white border border-slate-200 hover:border-orange-400 transition"
              />
            </button>
            <div
              v-else
              class="w-11 h-11 rounded-xl bg-slate-100 border border-slate-200/80 flex items-center justify-center text-slate-400 shrink-0"
            >
              <i class="pi pi-palette text-sm"></i>
            </div>

            <div class="min-w-0">
              <p class="text-sm font-bold text-slate-900 truncate">{{ group.label }}</p>
              <p class="text-xs text-slate-500">
                {{ group.variants.length }} méret ·
                <span
                  :class="
                    group.totalFreeStock > 0
                      ? 'font-semibold text-emerald-700'
                      : 'text-slate-500'
                  "
                >
                  {{ group.totalFreeStock }} db szabad
                </span>
              </p>
            </div>
          </div>

          <button
            v-if="props.canManageCatalog"
            type="button"
            @click="emit('cloneVariant', group.templateVariant)"
            class="h-8 px-3 rounded-xl bg-orange-50 hover:bg-orange-100 border border-orange-200 text-orange-700 text-xs font-semibold flex items-center gap-1.5 shrink-0 cursor-pointer transition"
          >
            <i class="pi pi-plus text-[10px]"></i>
            <span>+ Méret ehhez</span>
          </button>
        </div>

        <!-- Kompakt 5 oszlopos táblázat a csoporton belül -->
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr
                class="text-[11px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100 bg-white"
              >
                <th class="py-2.5 pl-4 pr-3">Méret &amp; Cikkszám</th>
                <th class="py-2.5 px-3 text-right">Árak</th>
                <th class="py-2.5 px-3">Vonalkód</th>
                <th class="py-2.5 px-3 text-right">Készlet</th>
                <th
                  v-if="props.canManageCatalog || props.canAdjustStock"
                  class="py-2.5 pl-3 pr-4 text-right"
                >
                  Műveletek
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 text-sm">
              <tr
                v-for="v in group.variants"
                :key="v.id"
                class="hover:bg-slate-50/70 transition"
              >
                <!-- 1. Méret & Cikkszám (+ súly és Inaktív jelvény) -->
                <td class="py-3 pl-4 pr-3">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span
                      class="inline-flex items-center justify-center min-w-8 px-2 py-0.5 rounded-lg bg-slate-900 text-white text-xs font-bold"
                    >
                      {{ v.size || '—' }}
                    </span>
                    <span class="font-mono text-xs font-semibold text-slate-800">
                      {{ v.sku }}
                    </span>
                    <span
                      v-if="!v.isActive"
                      class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500"
                    >
                      Inaktív
                    </span>
                  </div>
                  <p
                    v-if="v.weight !== undefined && v.weight !== null"
                    class="text-[11px] text-slate-400 mt-1"
                  >
                    Súly: {{ formatWeight(v.weight) }}
                  </p>
                </td>

                <!-- 2. Árak (Bruttó, Nettó, Beszerzési) -->
                <td class="py-3 px-3 text-right whitespace-nowrap">
                  <div class="font-bold text-slate-900 text-sm">
                    {{ formatPrice(v.grossPrice) }}
                  </div>
                  <div class="text-[11px] text-slate-500 mt-0.5">
                    <span>Nettó: {{ formatPrice(v.netPrice) }}</span>
                    <span v-if="props.canSeeCostPrice"> · Besz: {{ formatPrice(v.costPrice) }}</span>
                  </div>
                </td>

                <!-- 3. Vonalkód -->
                <td class="py-3 px-3 whitespace-nowrap">
                  <button
                    type="button"
                    @click="emit('openBarcodes', v)"
                    class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-orange-50 text-xs font-semibold text-slate-700 hover:text-orange-700 cursor-pointer transition"
                    title="Vonalkódok kezelése"
                  >
                    <i class="pi pi-barcode text-xs"></i>
                    <span v-if="getPrimaryBarcode(v)" class="font-mono max-w-[120px] truncate">
                      {{ getPrimaryBarcode(v)?.barcode }}
                    </span>
                    <span v-else class="text-slate-400">Nincs</span>
                    <span
                      class="px-1.5 py-0.2 rounded bg-white text-[10px] font-bold text-slate-600"
                    >
                      {{ v.variantBarcodes?.length ?? 0 }}
                    </span>
                  </button>
                </td>

                <!-- 4. Készlet -->
                <td class="py-3 px-3 text-right whitespace-nowrap">
                  <span
                    class="inline-flex items-center text-[11px] font-bold px-2.5 py-0.5 rounded-full"
                    :class="
                      getVariantFreeStock(v.id) > 0
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-slate-100 text-slate-500'
                    "
                  >
                    {{ getVariantFreeStock(v.id) }} db
                  </span>
                </td>

                <!-- 5. Műveletek (max 3 kompakt gomb) -->
                <td
                  v-if="props.canManageCatalog || props.canAdjustStock"
                  class="py-3 pl-3 pr-4 text-right whitespace-nowrap"
                >
                  <div class="inline-flex items-center gap-1">
                    <button
                      v-if="props.canAdjustStock"
                      type="button"
                      @click="emit('adjustStock', v.id)"
                      class="w-7 h-7 rounded-lg border border-slate-200 hover:bg-emerald-50 hover:border-emerald-200 text-slate-600 hover:text-emerald-700 flex items-center justify-center cursor-pointer transition"
                      title="Gyors készletfelvitel / korrekció"
                    >
                      <i class="pi pi-box text-[11px]"></i>
                    </button>
                    <template v-if="props.canManageCatalog">
                      <button
                        type="button"
                        @click="emit('editVariant', v)"
                        class="w-7 h-7 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 flex items-center justify-center cursor-pointer transition"
                        title="Variáns szerkesztése"
                      >
                        <i class="pi pi-pencil text-[11px]"></i>
                      </button>
                      <button
                        type="button"
                        @click="emit('deleteVariant', v)"
                        class="w-7 h-7 rounded-lg border border-rose-200 hover:bg-rose-50 text-rose-600 flex items-center justify-center cursor-pointer transition"
                        title="Variáns törlése"
                      >
                        <i class="pi pi-trash text-[11px]"></i>
                      </button>
                    </template>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>
