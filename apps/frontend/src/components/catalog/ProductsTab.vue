<script setup lang="ts">
import { ref, computed } from 'vue'

interface VariantItem {
  id: string
  sku: string
  color: string
  colorHex: string
  size: string
  costPrice: number
  price: number
  stock: number
}

interface CatalogProduct {
  id: string
  name: string
  brand: string
  category: string
  supplier: string
  manufacturerCode: string
  vatRate: number
  gender: string
  material: string
  isActive: boolean
  variants: VariantItem[]
}

// Kezdeti mintaadatok (következő lépésben bekötjük rá a valódi backend API-t!)
const products = ref<CatalogProduct[]>([
  {
    id: 'p1',
    name: 'Shox Motoros Kesztyű',
    brand: 'Shox',
    category: 'Motoros kesztyűk',
    supplier: 'EuroMotor Kft.',
    manufacturerCode: 'SHX-GL-24',
    vatRate: 27,
    gender: 'Férfi',
    material: 'Marhabőr / Kevlár',
    isActive: true,
    variants: [
      { id: 'v1', sku: 'SHX-GL-BL-M', color: 'Fekete', colorHex: '#1e293b', size: 'M', costPrice: 14500, price: 24990, stock: 8 },
      { id: 'v2', sku: 'SHX-GL-BL-L', color: 'Fekete', colorHex: '#1e293b', size: 'L', costPrice: 14500, price: 24990, stock: 12 },
      { id: 'v3', sku: 'SHX-GL-BL-XL', color: 'Fekete', colorHex: '#1e293b', size: 'XL', costPrice: 14500, price: 24990, stock: 4 },
    ],
  },
  {
    id: 'p2',
    name: 'Alpinestars T-GP Plus Kabát',
    brand: 'Alpinestars',
    category: 'Textil kabátok',
    supplier: 'Alpinestars Europe',
    manufacturerCode: 'ALP-TGP-88',
    vatRate: 27,
    gender: 'Unisex',
    material: ' Cordura 600D',
    isActive: true,
    variants: [
      { id: 'v4', sku: 'ALP-JKT-RD-M', color: 'Piros/Fekete', colorHex: '#ef4444', size: 'M', costPrice: 54000, price: 89900, stock: 0 },
      { id: 'v5', sku: 'ALP-JKT-RD-L', color: 'Piros/Fekete', colorHex: '#ef4444', size: 'L', costPrice: 54000, price: 89900, stock: 5 },
    ],
  },
])

const listSearch = ref('')
const selectedProductId = ref<string>(products.value[0]?.id ?? '')
const activeDetailTab = ref<'info' | 'variants' | 'stock'>('variants')

// Bal oldali lista szűrése
const filteredProducts = computed(() => {
  const q = listSearch.value.trim().toLowerCase()
  if (!q) return products.value
  return products.value.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.manufacturerCode.toLowerCase().includes(q) ||
      p.brand.toLowerCase().includes(q),
  )
})

// A jobb oldalon megjelenített, éppen kiválasztott termék
const selectedProduct = computed(() => {
  return products.value.find((p) => p.id === selectedProductId.value) ?? null
})
</script>

<template>
  <!-- OSZTOTT NÉZET (Master-Detail Grid: Bal 4 oszlop, Jobb 8 oszlop) -->
  <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
    
    <!-- 1. BAL OLDALI KÁRTYA: Kereső + Új gomb + Szellős Terméklista -->
    <div class="lg:col-span-4 bg-white rounded-3xl border border-white shadow-sm p-4 flex flex-col h-[calc(100vh-190px)] min-h-[520px]">
      
      <!-- Kereső + Új termék gomb -->
      <div class="flex items-center gap-2 mb-4">
        <div class="relative flex-1">
          <i class="pi pi-search absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
          <input
            v-model="listSearch"
            type="text"
            placeholder="Szűrés a listában..."
            class="w-full bg-slate-100/80 rounded-xl py-2 pl-9 pr-3 text-sm text-slate-800 placeholder-slate-400 outline-none focus:ring-2 focus:ring-orange-500/20"
          />
        </div>
        <button
          type="button"
          class="bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold px-3.5 py-2.5 rounded-xl flex items-center gap-1.5 shrink-0 cursor-pointer transition shadow-sm"
        >
          <i class="pi pi-plus text-xs"></i>
          <span>Új termék</span>
        </button>
      </div>

      <!-- Görgethető terméklista (csak a legfontosabb 2 adattal, hogy ne legyen zsúfolt!) -->
      <div class="flex-1 overflow-y-auto space-y-1.5 pr-1">
        <div
          v-for="product in filteredProducts"
          :key="product.id"
          @click="selectedProductId = product.id"
          class="p-3 rounded-2xl flex items-center justify-between gap-3 cursor-pointer transition-all border"
          :class="
            selectedProductId === product.id
              ? 'bg-orange-50/60 border-orange-300 shadow-xs'
              : 'bg-transparent border-transparent hover:bg-slate-50'
          "
        >
          <div class="flex items-center gap-3 min-w-0">
            <div class="w-11 h-11 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400 shrink-0">
              <i class="pi pi-box text-lg"></i>
            </div>
            <div class="min-w-0">
              <p class="font-bold text-sm text-slate-900 truncate">{{ product.name }}</p>
              <p class="text-xs text-slate-400 truncate">
                {{ product.brand }} · <span class="font-mono">{{ product.manufacturerCode }}</span>
              </p>
            </div>
          </div>

          <span class="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 shrink-0">
            {{ product.variants.length }} variáns
          </span>
        </div>
      </div>
    </div>

    <!-- 2. JOBB OLDALI KÁRTYA: A kiválasztott termék szellős adatlapja -->
    <div
      v-if="selectedProduct"
      class="lg:col-span-8 bg-white rounded-3xl border border-white shadow-sm p-6 sm:p-8 space-y-6"
    >
      <!-- Felső fejléc: Terméknév + Státusz + Szerkesztés gomb -->
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <h1 class="text-2xl font-bold text-slate-900">{{ selectedProduct.name }}</h1>
          <span
            class="text-xs font-bold px-2.5 py-1 rounded-full"
            :class="selectedProduct.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'"
          >
            {{ selectedProduct.isActive ? 'Aktív' : 'Inaktív' }}
          </span>
        </div>

        <div class="flex items-center gap-2">
          <button
            type="button"
            class="px-4 py-2 rounded-xl border border-slate-200 hover:border-slate-300 text-sm font-semibold text-slate-700 flex items-center gap-2 cursor-pointer transition"
          >
            <i class="pi pi-pencil text-xs"></i>
            <span>Szerkesztés</span>
          </button>
          <button
            type="button"
            class="w-9 h-9 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-500 flex items-center justify-center cursor-pointer transition"
            title="További műveletek"
          >
            <i class="pi pi-ellipsis-h"></i>
          </button>
        </div>
      </div>

      <!-- Hero szekció: Balra nagy termékkép helye, Jobbra 4 tiszta információs kártya -->
      <div class="grid grid-cols-1 sm:grid-cols-12 gap-6 items-center">
        <div class="sm:col-span-5 aspect-4/3 rounded-2xl bg-slate-100/80 flex flex-col items-center justify-center text-slate-400">
          <i class="pi pi-image text-4xl mb-2"></i>
          <span class="text-xs">Termékkép</span>
        </div>

        <div class="sm:col-span-7 grid grid-cols-2 gap-3">
          <div class="p-3.5 rounded-2xl bg-slate-50/80">
            <span class="block text-[11px] font-bold uppercase tracking-wider text-slate-400">Márka</span>
            <span class="text-base font-bold text-slate-900 mt-0.5 block">{{ selectedProduct.brand }}</span>
          </div>
          <div class="p-3.5 rounded-2xl bg-slate-50/80">
            <span class="block text-[11px] font-bold uppercase tracking-wider text-slate-400">Kategória</span>
            <span class="text-base font-bold text-slate-900 mt-0.5 block">{{ selectedProduct.category }}</span>
          </div>
          <div class="p-3.5 rounded-2xl bg-slate-50/80">
            <span class="block text-[11px] font-bold uppercase tracking-wider text-slate-400">Gyártói kód</span>
            <span class="text-base font-bold font-mono text-slate-900 mt-0.5 block">{{ selectedProduct.manufacturerCode }}</span>
          </div>
          <div class="p-3.5 rounded-2xl bg-slate-50/80">
            <span class="block text-[11px] font-bold uppercase tracking-wider text-slate-400">ÁFA kulcs</span>
            <span class="text-base font-bold text-slate-900 mt-0.5 block">{{ selectedProduct.vatRate }}%</span>
          </div>
        </div>
      </div>

      <!-- Belső 3 Fül (Alapadatok | Variánsok & Árak | Készlet & Mozgások) -->
      <div class="border-b border-slate-100 flex items-center gap-6">
        <button
          type="button"
          @click="activeDetailTab = 'info'"
          class="pb-3 text-sm font-semibold border-b-2 transition cursor-pointer"
          :class="activeDetailTab === 'info' ? 'border-orange-500 text-slate-900' : 'border-transparent text-slate-400 hover:text-slate-700'"
        >
          Alapadatok
        </button>
        <button
          type="button"
          @click="activeDetailTab = 'variants'"
          class="pb-3 text-sm font-semibold border-b-2 transition cursor-pointer"
          :class="activeDetailTab === 'variants' ? 'border-orange-500 text-slate-900' : 'border-transparent text-slate-400 hover:text-slate-700'"
        >
          Variánsok & Árak ({{ selectedProduct.variants.length }})
        </button>
        <button
          type="button"
          @click="activeDetailTab = 'stock'"
          class="pb-3 text-sm font-semibold border-b-2 transition cursor-pointer"
          :class="activeDetailTab === 'stock' ? 'border-orange-500 text-slate-900' : 'border-transparent text-slate-400 hover:text-slate-700'"
        >
          Készlet & Mozgások
        </button>
      </div>

      <!-- FÜL 1: ALAPADATOK -->
      <div v-if="activeDetailTab === 'info'" class="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
        <div>
          <span class="text-xs text-slate-400 block">Elsődleges beszállító</span>
          <span class="text-sm font-semibold text-slate-800">{{ selectedProduct.supplier }}</span>
        </div>
        <div>
          <span class="text-xs text-slate-400 block">Nem</span>
          <span class="text-sm font-semibold text-slate-800">{{ selectedProduct.gender }}</span>
        </div>
        <div>
          <span class="text-xs text-slate-400 block">Anyagösszetétel</span>
          <span class="text-sm font-semibold text-slate-800">{{ selectedProduct.material }}</span>
        </div>
      </div>

      <!-- FÜL 2: VARIÁNSOK & ÁRAK -->
      <div v-else-if="activeDetailTab === 'variants'" class="space-y-3">
        <div class="flex justify-end">
          <button
            type="button"
            class="text-xs font-semibold text-orange-600 hover:text-orange-700 flex items-center gap-1 cursor-pointer"
          >
            <i class="pi pi-plus text-[10px]"></i>
            <span>Új variáns hozzáadása</span>
          </button>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="text-[11px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100">
                <th class="pb-3">Méret</th>
                <th class="pb-3">Cikkszám (SKU)</th>
                <th class="pb-3">Szín</th>
                <th class="pb-3 text-right">Beszerzési ár</th>
                <th class="pb-3 text-right">Eladási ár</th>
                <th class="pb-3 text-right">Készlet</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 text-sm">
              <tr v-for="v in selectedProduct.variants" :key="v.id" class="hover:bg-slate-50/70 transition">
                <td class="py-3.5 font-bold text-slate-900">{{ v.size }}</td>
                <td class="py-3.5 font-mono text-slate-600">{{ v.sku }}</td>
                <td class="py-3.5">
                  <span class="inline-flex items-center gap-2 text-slate-700">
                    <span class="w-3 h-3 rounded-full border border-slate-300" :style="{ backgroundColor: v.colorHex }"></span>
                    {{ v.color }}
                  </span>
                </td>
                <td class="py-3.5 text-right text-slate-500">{{ v.costPrice.toLocaleString('hu-HU') }} Ft</td>
                <td class="py-3.5 text-right font-bold text-slate-900">{{ v.price.toLocaleString('hu-HU') }} Ft</td>
                <td class="py-3.5 text-right">
                  <span
                    class="inline-block text-xs font-bold px-2.5 py-1 rounded-lg"
                    :class="v.stock > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'"
                  >
                    {{ v.stock }} db
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- FÜL 3: KÉSZLET & MOZGÁSOK -->
      <div v-else class="py-6 text-center text-sm text-slate-400">
        Itt jelennek majd meg a raktárankénti/polconkénti készletek és az utolsó készletmozgások.
      </div>
    </div>

  </div>
</template>