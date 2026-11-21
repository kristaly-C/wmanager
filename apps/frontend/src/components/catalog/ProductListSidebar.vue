<script setup lang="ts">
import type { BrandItem } from '@/api/brands'
import type { ProductListItem } from '@/api/products'

const props = defineProps<{
  products: ProductListItem[]
  totalProducts: number
  loading: boolean
  selectedProductId: string
  searchInput: string
  categoryFilter: string
  brandFilter: string
  categories: { id: string; label: string }[]
  brands: BrandItem[]
  currentPage: number
  totalPages: number
  paginationRangeText: string
  canManageCatalog: boolean
  hasActiveFilters: boolean
}>()

const emit = defineEmits<{
  (e: 'update:searchInput', value: string): void
  (e: 'update:categoryFilter', value: string): void
  (e: 'update:brandFilter', value: string): void
  (e: 'selectProduct', id: string): void
  (e: 'pageChange', page: number): void
  (e: 'immediateSearch'): void
  (e: 'resetFilters'): void
  (e: 'createProduct'): void
}>()

function onSearchInput(event: Event) {
  emit('update:searchInput', (event.target as HTMLInputElement).value)
}

function onCategoryChange(event: Event) {
  emit('update:categoryFilter', (event.target as HTMLSelectElement).value)
}

function onBrandChange(event: Event) {
  emit('update:brandFilter', (event.target as HTMLSelectElement).value)
}
</script>

<template>
  <div
    class="lg:col-span-4 lg:sticky lg:top-6 bg-white rounded-3xl border border-white shadow-sm p-4 flex flex-col h-[calc(100vh-190px)] lg:h-[calc(100vh-3rem)] min-h-[520px]"
  >
    <!-- Kereső + Új termék gomb -->
    <div class="flex items-center gap-2 mb-2.5">
      <div class="relative flex-1">
        <i
          class="pi pi-search absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs"
        ></i>
        <input
          :value="props.searchInput"
          type="text"
          placeholder="Név, kód, SKU vagy vonalkód..."
          @input="onSearchInput"
          @keydown.enter.prevent="emit('immediateSearch')"
          class="w-full bg-slate-100/80 rounded-xl py-2 pl-9 pr-3 text-sm text-slate-800 placeholder-slate-400 outline-none focus:ring-2 focus:ring-orange-500/20"
        />
      </div>
      <button
        v-if="props.canManageCatalog"
        type="button"
        @click="emit('createProduct')"
        class="bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold px-3.5 py-2.5 rounded-xl flex items-center gap-1.5 shrink-0 cursor-pointer transition shadow-sm"
      >
        <i class="pi pi-plus text-xs"></i>
        <span>Új termék</span>
      </button>
    </div>

    <!-- Kategória és Márka szűrők -->
    <div class="grid grid-cols-2 gap-2 mb-3">
      <select
        :value="props.categoryFilter"
        @change="onCategoryChange"
        class="h-8 rounded-xl bg-slate-100/80 px-2.5 text-xs text-slate-700 outline-none focus:ring-2 focus:ring-orange-500/20"
      >
        <option value="">Minden kategória</option>
        <option v-for="c in props.categories" :key="c.id" :value="c.id">
          {{ c.label }}
        </option>
      </select>

      <select
        :value="props.brandFilter"
        @change="onBrandChange"
        class="h-8 rounded-xl bg-slate-100/80 px-2.5 text-xs text-slate-700 outline-none focus:ring-2 focus:ring-orange-500/20"
      >
        <option value="">Minden márka</option>
        <option v-for="b in props.brands" :key="b.id" :value="b.id">
          {{ b.name }}
        </option>
      </select>
    </div>

    <!-- Görgethető terméklista -->
    <div class="flex-1 overflow-y-auto space-y-1.5 pr-1">
      <div
        v-if="props.loading && props.products.length === 0"
        class="py-12 text-center text-xs text-slate-400"
      >
        <i class="pi pi-spin pi-spinner mr-1.5"></i> Termékek betöltése...
      </div>

      <div
        v-else-if="props.products.length === 0"
        class="py-10 px-4 text-center space-y-2 text-xs text-slate-400"
      >
        <i class="pi pi-inbox text-2xl block text-slate-300"></i>
        <p>Nincs a szűrésnek megfelelő termék.</p>
        <button
          v-if="props.hasActiveFilters"
          type="button"
          @click="emit('resetFilters')"
          class="text-orange-600 hover:underline font-semibold cursor-pointer"
        >
          Szűrők törlése
        </button>
      </div>

      <div
        v-else
        v-for="product in props.products"
        :key="product.id"
        @click="emit('selectProduct', product.id)"
        class="p-3 rounded-2xl flex items-center justify-between gap-3 cursor-pointer transition-all border"
        :class="
          props.selectedProductId === product.id
            ? 'bg-orange-50/60 border-orange-300 shadow-xs'
            : 'bg-transparent border-transparent hover:bg-slate-50'
        "
      >
        <div class="flex items-center gap-3 min-w-0">
          <div
            class="w-11 h-11 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400 shrink-0 overflow-hidden"
          >
            <img
              v-if="product.imageUrls?.[0]"
              :src="product.imageUrls[0]"
              :alt="product.name"
              class="w-full h-full object-cover"
            />
            <i v-else class="pi pi-box text-lg"></i>
          </div>
          <div class="min-w-0">
            <p class="font-bold text-sm text-slate-900 truncate">{{ product.name }}</p>
            <p class="text-xs text-slate-400 truncate">
              {{ product.brand?.name ?? '—' }}
              <template v-if="product.manufacturerCode">
                · <span class="font-mono">{{ product.manufacturerCode }}</span>
              </template>
            </p>
          </div>
        </div>

        <span
          class="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 shrink-0"
        >
          {{ product._count?.variants ?? 0 }} variáns
        </span>
      </div>
    </div>

    <!-- Alsó lapozó (Paginator) -->
    <div
      class="pt-3 mt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500"
    >
      <span>{{ props.paginationRangeText }}</span>
      <div class="flex items-center gap-1.5">
        <button
          type="button"
          :disabled="props.currentPage <= 1 || props.loading"
          @click="emit('pageChange', props.currentPage - 1)"
          class="h-7 px-2.5 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 text-slate-700 font-semibold cursor-pointer transition"
        >
          Előző
        </button>
        <span class="px-1.5 font-semibold text-slate-700">
          {{ props.currentPage }} / {{ props.totalPages }}
        </span>
        <button
          type="button"
          :disabled="props.currentPage >= props.totalPages || props.loading"
          @click="emit('pageChange', props.currentPage + 1)"
          class="h-7 px-2.5 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 text-slate-700 font-semibold cursor-pointer transition"
        >
          Következő
        </button>
      </div>
    </div>
  </div>
</template>
