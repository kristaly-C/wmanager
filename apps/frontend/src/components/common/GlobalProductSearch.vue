<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { Role } from '@wmanager/shared-types'
import { useAuthStore } from '@/stores/auth'
import {
  useSearchStore,
  type QuickProductInfo,
  type QuickStockBreakdown,
} from '@/stores/search'
import { variantApi, type VariantItem } from '@/api/variants'
import { locationApi, type LocationItem } from '@/api/locations'
import { extractApiError, getLocationPath } from '@/utils/locationMeta'
import StockReportModal from '@/components/inventory/StockReportModal.vue'
import Dialog from 'primevue/dialog'

const authStore = useAuthStore()
const searchStore = useSearchStore()

const canReportStock = computed(() => {
  const role = authStore.user?.role
  return (
    role === Role.ADMIN ||
    role === Role.BOSS ||
    role === Role.WAREHOUSE_MANAGER ||
    role === Role.STORE_MANAGER ||
    role === Role.WAREHOUSE_STAFF ||
    role === Role.STORE_STAFF
  )
})

const isStockReportModalOpen = ref(false)
const reportInitialVariantId = ref<string | null>(null)
const reportInitialLocationId = ref<string | null>(null)
const reportInitialExpectedQty = ref<number | null>(null)
const searchQuery = ref('')
const selectedIndex = ref(0)
const copiedSku = ref<string | null>(null)
const searchInput = ref<HTMLInputElement | null>(null)

const rawResults = ref<VariantItem[]>([])
const searchLoading = ref(false)
const searchError = ref<string | null>(null)

const rawSiblingVariants = ref<VariantItem[]>([])
const loadingSiblings = ref(false)

const allLocations = ref<LocationItem[]>([])
let locationsLoaded = false
let locationsPromise: Promise<void> | null = null

let searchTimer: ReturnType<typeof setTimeout> | null = null
let latestSearchSeq = 0
let latestSiblingsSeq = 0
let lastCompletedQuery = ''
let hasSearchedOnce = false

const locationById = computed(() => new Map(allLocations.value.map((l) => [l.id, l])))

function isExternalBreakdownLocation(locationId: string): boolean {
  const loc = locationById.value.get(locationId)
  if (loc && loc.isAssigned === false) return true
  const activeId = searchStore.activeProductSheet?.id
  if (activeId) {
    const raw =
      rawSiblingVariants.value.find((v) => v.id === activeId) ??
      rawResults.value.find((v) => v.id === activeId)
    const si = raw?.stockItems?.find((s) => s.locationId === locationId)
    if (si?.isExternalLocation) return true
  }
  return false
}

async function openStockReportFromSheet(row: QuickStockBreakdown) {
  const active = searchStore.activeProductSheet
  if (!active) return
  await ensureLocationsLoaded()
  reportInitialVariantId.value = active.id
  reportInitialLocationId.value = row.locationId
  reportInitialExpectedQty.value = row.totalQty
  isStockReportModalOpen.value = true
}

function onStockReportSaved() {
  const productId = searchStore.activeProductSheet?.productId
  if (productId) {
    void fetchSiblingVariants(productId)
  }
}

async function ensureLocationsLoaded() {
  if (locationsLoaded) return
  if (locationsPromise) return locationsPromise

  locationsPromise = locationApi
    .getAll()
    .then((res) => {
      allLocations.value = res.data
      locationsLoaded = true
    })
    .catch(() => {
      // Helyszín betöltési hiba esetén a stockItem.location.name fallback marad használatban
    })
    .finally(() => {
      locationsPromise = null
    })

  return locationsPromise
}

function mapVariantToQuickInfo(v: VariantItem): QuickProductInfo {
  const stockItems = v.stockItems ?? []
  const stockBreakdown: QuickStockBreakdown[] = stockItems.map((si) => {
    const path = getLocationPath(si.locationId, locationById.value)
    const locationName =
      path.length > 0 ? path.map((p) => p.name).join(' › ') : (si.location?.name ?? si.locationId)
    return {
      locationId: si.locationId,
      locationName,
      totalQty: si.quantity,
      reservedQty: si.reservedQuantity,
      freeQty: si.quantity - si.reservedQuantity,
    }
  })

  const freeStock = stockBreakdown.reduce((sum, item) => sum + item.freeQty, 0)
  const firstLocationName = stockItems[0]?.location?.name
  const shelf = firstLocationName
    ? stockItems.length > 1
      ? `${firstLocationName} (+${stockItems.length - 1} hely)`
      : firstLocationName
    : 'Nincs polcon'

  const variantLabel = [...(v.colors ?? []), v.size].filter(Boolean).join(' · ')
  const barcode =
    v.variantBarcodes?.find((b) => b.isPrimary)?.barcode ?? v.variantBarcodes?.[0]?.barcode ?? '—'

  return {
    id: v.id,
    productId: v.productId,
    name: v.product?.name ?? v.sku,
    variantLabel,
    sku: v.sku,
    barcode,
    grossPrice: Number(v.grossPrice ?? 0),
    netPrice: Number(v.netPrice ?? 0),
    freeStock,
    shelf,
    imageUrl: v.imageUrls?.[0] ?? v.product?.imageUrls?.[0] ?? null,
    brandName: v.product?.brand?.name,
    categoryName: v.product?.category?.name,
    supplierName: v.product?.primarySupplier?.name,
    manufacturerCode: v.product?.manufacturerCode,
    model: v.product?.model,
    material: v.product?.material ?? null,
    description: v.product?.description ?? null,
    stockBreakdown,
  }
}

const results = computed<QuickProductInfo[]>(() =>
  rawResults.value.map((v) => mapVariantToQuickInfo(v)),
)

const siblingVariants = computed<QuickProductInfo[]>(() =>
  rawSiblingVariants.value.map((v) => mapVariantToQuickInfo(v)),
)

async function fetchVariants(query: string, openOnEnter = false) {
  const trimmed = query.trim()
  const seq = ++latestSearchSeq
  searchLoading.value = true
  searchError.value = null

  try {
    const res = await variantApi.getAll({
      search: trimmed || undefined,
      take: 25,
    })
    if (seq !== latestSearchSeq) return

    rawResults.value = res.data
    lastCompletedQuery = trimmed
    hasSearchedOnce = true
    selectedIndex.value = 0

    if (openOnEnter && trimmed && res.data.length > 0) {
      const exactBarcodeIdx = res.data.findIndex((v) =>
        v.variantBarcodes?.some((b) => b.barcode === trimmed),
      )
      if (exactBarcodeIdx >= 0) {
        selectedIndex.value = exactBarcodeIdx
        const target = results.value[exactBarcodeIdx]
        if (target) searchStore.openProductSheet(target)
      } else if (res.data.length === 1 && results.value[0]) {
        searchStore.openProductSheet(results.value[0])
      }
    }
  } catch (err) {
    if (seq !== latestSearchSeq) return
    searchError.value = extractApiError(err, 'Nem sikerült lekérni a termékeket.')
  } finally {
    if (seq === latestSearchSeq) {
      searchLoading.value = false
    }
  }
}

async function fetchSiblingVariants(productId: string) {
  const seq = ++latestSiblingsSeq
  loadingSiblings.value = true

  try {
    const [, res] = await Promise.all([
      ensureLocationsLoaded(),
      variantApi.getAll({ productId, take: 50 }),
    ])
    if (seq !== latestSiblingsSeq) return

    rawSiblingVariants.value = res.data

    const activeId = searchStore.activeProductSheet?.id
    if (searchStore.isProductSheetOpen && activeId) {
      const freshActive = siblingVariants.value.find((item) => item.id === activeId)
      if (freshActive) {
        searchStore.openProductSheet(freshActive)
      }
    }
  } catch {
    if (seq !== latestSiblingsSeq) return
    rawSiblingVariants.value = []
  } finally {
    if (seq === latestSiblingsSeq) {
      loadingSiblings.value = false
    }
  }
}

watch(
  () => searchStore.isSearchOpen,
  (isOpen) => {
    if (isOpen) {
      void ensureLocationsLoaded()
      void fetchVariants(searchQuery.value, false)
      void nextTick(() => {
        searchInput.value?.focus()
      })
    } else if (searchTimer !== null) {
      clearTimeout(searchTimer)
      searchTimer = null
    }
  },
)

watch(searchQuery, (val) => {
  selectedIndex.value = 0
  if (!searchStore.isSearchOpen) return

  if (searchTimer !== null) {
    clearTimeout(searchTimer)
  }
  searchTimer = setTimeout(() => {
    searchTimer = null
    void fetchVariants(val, false)
  }, 300)
})

// Ha változik a keresés vagy a nyilakkal lépegetünk, frissítjük a globálisan kijelölt terméket
watch(
  [results, selectedIndex, () => searchStore.isSearchOpen],
  () => {
    if (!searchStore.isSearchOpen) return
    if (results.value.length > 0) {
      const current = results.value[selectedIndex.value] ?? results.value[0]
      searchStore.setHighlightedProduct(current ?? null)
    } else if (!searchLoading.value) {
      searchStore.setHighlightedProduct(null)
    }
  },
  { immediate: true },
)

watch(
  [() => searchStore.isProductSheetOpen, () => searchStore.activeProductSheet?.productId],
  ([isOpen, productId], [wasOpen, prevProductId]) => {
    if (!isOpen || !productId) {
      if (!isOpen) {
        rawSiblingVariants.value = []
      }
      return
    }
    if (!wasOpen || productId !== prevProductId) {
      rawSiblingVariants.value = []
      void fetchSiblingVariants(productId)
    }
  },
)

// SKU másolása vágólapra (HTTP / nem-HTTPS környezetben is működő fallbackkel)
async function copySku(sku: string) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(sku)
    } else {
      const textArea = document.createElement('textarea')
      textArea.value = sku
      textArea.style.position = 'fixed'
      textArea.style.left = '-9999px'
      document.body.appendChild(textArea)
      textArea.focus()
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
    }
    copiedSku.value = sku
    setTimeout(() => {
      if (copiedSku.value === sku) {
        copiedSku.value = null
      }
    }, 1500)
  } catch (err) {
    console.error('Nem sikerült a vágólapra másolni:', err)
  }
}

// Billentyűzet figyelő: Ctrl+K (Kereső), F5 (Termék Törzslap bárhonnan!), Nyilak (Lépegetés)
function handleKeydown(e: KeyboardEvent) {
  // 1. Ctrl + K -> Kereső nyitás/zárás
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    if (searchStore.isSearchOpen) {
      searchStore.closeSearch()
    } else {
      searchStore.openSearch()
    }
    return
  }

  if (e.key === 'Escape') {
    if (isStockReportModalOpen.value) {
      e.preventDefault()
      isStockReportModalOpen.value = false
      return
    }
    if (searchStore.isProductSheetOpen) {
      e.preventDefault()
      searchStore.closeProductSheet()
      void nextTick(() => {
        searchInput.value?.focus()
      })
      return
    }
    if (searchStore.isSearchOpen) {
      e.preventDefault()
      searchStore.closeSearch()
      return
    }
  }

  // 2. F5 -> Bárhol vagyunk, ha van kijelölt termék, megnyitja a Termék Törzslap ablakot!
  if (e.key === 'F5') {
    if (searchStore.highlightedProduct) {
      e.preventDefault() // Megakadályozza a böngésző oldalfrissítését!
      searchStore.openProductSheet(searchStore.highlightedProduct)
    }
    return
  }

  // 3. Ha a kereső nyitva van: Enter és Fel / Le nyilak kezelése
  if (searchStore.isSearchOpen && !searchStore.isProductSheetOpen) {
    if (e.key === 'Enter') {
      e.preventDefault()
      const trimmed = searchQuery.value.trim()
      if (
        searchTimer !== null ||
        !hasSearchedOnce ||
        trimmed !== lastCompletedQuery ||
        searchLoading.value
      ) {
        if (searchTimer !== null) {
          clearTimeout(searchTimer)
          searchTimer = null
        }
        void fetchVariants(searchQuery.value, true)
      } else {
        const picked = results.value[selectedIndex.value] ?? results.value[0]
        if (picked) {
          searchStore.openProductSheet(picked)
        }
      }
      return
    }

    const count = results.value.length
    if (count === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      selectedIndex.value = (selectedIndex.value + 1) % count
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      selectedIndex.value = (selectedIndex.value - 1 + count) % count
    }
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
  if (searchTimer !== null) {
    clearTimeout(searchTimer)
    searchTimer = null
  }
})
</script>

<template>
  <!-- 1. GLOBÁLIS KERESŐ ABLAK (Ctrl + K) -->
  <Dialog
    v-model:visible="searchStore.isSearchOpen"
    modal
    dismissableMask
    :closeOnEscape="false"
    position="top"
    :showHeader="false"
    :draggable="false"
    class="w-[95vw] max-w-3xl !rounded-3xl !overflow-hidden !border !border-slate-200 !shadow-2xl !mt-16"
    contentClass="!p-0"
  >
    <div class="bg-white flex flex-col max-h-[75vh]">
      <!-- FELSŐ KERESŐSÁV -->
      <div class="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
        <i
          :class="
            searchLoading
              ? 'pi pi-spin pi-spinner text-orange-500 text-lg'
              : 'pi pi-search text-orange-500 text-lg'
          "
        ></i>
        <input
          v-model="searchQuery"
          type="text"
          autofocus
          placeholder="Keress terméknévre, cikkszámra (SKU), márkára, modellre vagy csippants vonalkódot..."
          class="w-full text-base text-slate-900 placeholder-slate-400 bg-transparent outline-none"
          ref="searchInput"
        />
        <button
          v-if="searchQuery"
          type="button"
          @click="searchQuery = ''"
          class="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
          title="Keresés törlése"
        >
          <i class="pi pi-times text-sm"></i>
        </button>
        <span
          @click="searchStore.closeSearch()"
          class="text-[11px] font-mono bg-slate-100 hover:bg-slate-200 px-2.5 py-1 rounded-lg text-slate-500 cursor-pointer shrink-0 transition"
        >
          ESC
        </span>
      </div>

      <!-- TALÁLATI LISTA -->
      <div class="flex-1 overflow-y-auto p-5 space-y-2.5 bg-slate-50/50">
        <div
          class="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-400 px-1"
        >
          <span>Találatok ({{ results.length }})</span>
          <span>Készlet &amp; Polchely</span>
        </div>

        <div
          v-if="searchError"
          class="rounded-xl bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 text-sm"
        >
          {{ searchError }}
        </div>

        <div
          v-else-if="searchLoading && results.length === 0"
          class="text-center py-8 text-sm text-slate-400"
        >
          Termékek keresése...
        </div>

        <div
          v-else-if="!searchLoading && results.length === 0"
          class="text-center py-8 text-sm text-slate-400"
        >
          Nincs találat a megadott keresésre.
        </div>

        <!-- Találati kártyák -->
        <div
          v-for="(item, index) in results"
          :key="item.id"
          @click="selectedIndex = index"
          @dblclick="searchStore.openProductSheet(item)"
          class="bg-white rounded-2xl p-4 transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-2"
          :class="
            selectedIndex === index
              ? 'border-orange-500 shadow-md bg-orange-50/10'
              : 'border-slate-200/80 hover:border-slate-300 shadow-sm'
          "
        >
          <!-- Bal oldal: Termék adatai + SKU másolás gomb -->
          <div class="flex items-start gap-4">
            <div
              class="w-12 h-12 aspect-square rounded-xl border border-slate-100 flex items-center justify-center text-slate-400 shrink-0 overflow-hidden"
              :class="item.imageUrl ? 'bg-white' : 'bg-slate-100'"
            >
              <img
                v-if="item.imageUrl"
                :src="item.imageUrl"
                :alt="item.name"
                class="w-full h-full object-contain bg-white"
              />
              <i v-else class="pi pi-image text-xl"></i>
            </div>
            <div>
              <div class="flex flex-wrap items-center gap-2">
                <h3 class="font-bold text-slate-900">{{ item.name }}</h3>
                <span
                  v-if="item.variantLabel"
                  class="text-xs font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700"
                >
                  {{ item.variantLabel }}
                </span>
              </div>

              <div class="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-xs text-slate-500">
                <!-- SKU + Másolás ikon (@click.stop, hogy ne nyissa meg a kártyát!) -->
                <span class="inline-flex items-center gap-1.5 bg-slate-100 px-2 py-0.5 rounded-md">
                  <span>SKU:</span>
                  <b class="font-mono text-slate-800">{{ item.sku }}</b>
                  <button
                    type="button"
                    @click.stop="copySku(item.sku)"
                    class="ml-0.5 text-slate-400 hover:text-orange-600 transition cursor-pointer"
                    title="SKU másolása vágólapra"
                  >
                    <i
                      :class="
                        copiedSku === item.sku
                          ? 'pi pi-check text-emerald-600 font-bold'
                          : 'pi pi-copy'
                      "
                      class="text-xs"
                    ></i>
                  </button>
                </span>

                <span>Vonalkód: <b class="font-mono text-slate-700">{{ item.barcode }}</b></span>
                <span>Bruttó ár: <b class="text-slate-800">{{ item.grossPrice.toLocaleString('hu-HU') }} Ft</b></span>
              </div>
            </div>
          </div>

          <!-- Jobb oldal: Polcok és készletek -->
          <div class="flex items-center gap-2.5 self-end sm:self-center shrink-0">
            <div
              class="text-right px-3 py-1.5 rounded-xl border"
              :class="
                item.freeStock > 0
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                  : 'bg-rose-50 border-rose-200 text-rose-700'
              "
            >
              <span class="block text-[10px] font-bold uppercase opacity-75">Szabad készlet</span>
              <span class="text-sm font-black">{{ item.freeStock }} db</span>
            </div>
            <div class="text-right px-3 py-1.5 rounded-xl bg-orange-50 border border-orange-200">
              <span class="block text-[10px] font-bold uppercase text-orange-600">Polchely</span>
              <span class="text-sm font-black font-mono text-orange-700">{{ item.shelf }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- ALSÓ LÁBLÉC (Gyorsbillentyű tippek) -->
      <div
        class="px-5 py-3 bg-white border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400"
      >
        <div class="flex items-center gap-4">
          <span>
            <kbd class="px-1.5 py-0.5 bg-slate-100 rounded text-slate-600 font-mono">↑</kbd>
            <kbd class="px-1.5 py-0.5 bg-slate-100 rounded text-slate-600 font-mono">↓</kbd>
            Lépegetés
          </span>
          <span>
            <kbd class="px-1.5 py-0.5 bg-slate-100 rounded text-slate-600 font-mono">F5</kbd>
            vagy
            <kbd class="px-1.5 py-0.5 bg-slate-100 rounded text-slate-600 font-mono">↵</kbd>
            Termék Törzslap
          </span>
          <span>
            <kbd class="px-1.5 py-0.5 bg-slate-100 rounded text-slate-600 font-mono">ESC</kbd>
            Bezárás
          </span>
        </div>
        <span class="hidden sm:inline">Dupla kattintás vagy F5 a törzslaphoz</span>
      </div>
    </div>
  </Dialog>

  <!-- 2. LEBEGŐ TERMÉK TÖRZSLAP ABLAK (F5 megnyomására nyílik meg bárhonnan, elnavigálás nélkül!) -->
  <Dialog
    v-model:visible="searchStore.isProductSheetOpen"
    modal
    dismissableMask
    :closeOnEscape="false"
    :header="
      searchStore.activeProductSheet
        ? `Termék Törzslap — ${searchStore.activeProductSheet.name}`
        : 'Termék Törzslap'
    "
    class="w-[95vw] max-w-4xl !rounded-3xl"
  >
    <div v-if="searchStore.activeProductSheet" class="space-y-5 pt-2">
      <!-- Felső összefoglaló sáv -->
      <div
        class="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-2xl bg-slate-50 border border-slate-200"
      >
        <div class="flex items-center gap-4">
          <div
            class="w-20 h-20 aspect-square rounded-2xl border border-slate-200 flex items-center justify-center text-slate-400 shrink-0 overflow-hidden"
            :class="searchStore.activeProductSheet.imageUrl ? 'bg-white' : 'bg-slate-100'"
          >
            <img
              v-if="searchStore.activeProductSheet.imageUrl"
              :src="searchStore.activeProductSheet.imageUrl"
              :alt="searchStore.activeProductSheet.name"
              class="w-full h-full object-contain bg-white"
            />
            <i v-else class="pi pi-image text-2xl"></i>
          </div>

          <div>
            <span class="text-xs font-bold uppercase text-orange-600">Kiválasztott variáns</span>
            <h2 class="text-xl font-bold text-slate-900 mt-0.5">
              {{ searchStore.activeProductSheet.name }}
              <span v-if="searchStore.activeProductSheet.variantLabel" class="text-slate-600">
                ({{ searchStore.activeProductSheet.variantLabel }})
              </span>
            </h2>
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500 mt-1 font-mono">
              <span class="inline-flex items-center gap-1.5">
                SKU: <b class="text-slate-800">{{ searchStore.activeProductSheet.sku }}</b>
                <button
                  type="button"
                  @click="copySku(searchStore.activeProductSheet.sku)"
                  class="text-slate-400 hover:text-orange-600 transition cursor-pointer"
                  title="SKU másolása vágólapra"
                >
                  <i
                    :class="
                      copiedSku === searchStore.activeProductSheet.sku
                        ? 'pi pi-check text-emerald-600 font-bold'
                        : 'pi pi-copy'
                    "
                    class="text-xs"
                  ></i>
                </button>
              </span>
              <span>·</span>
              <span>EAN: <b class="text-slate-800">{{ searchStore.activeProductSheet.barcode }}</b></span>
            </div>
          </div>
        </div>

        <div class="flex gap-3 shrink-0">
          <div class="px-4 py-2 rounded-xl bg-white border border-slate-200 text-right">
            <span class="block text-xs text-slate-400">Bruttó ár</span>
            <span class="text-lg font-black text-slate-900">
              {{ searchStore.activeProductSheet.grossPrice.toLocaleString('hu-HU') }} Ft
            </span>
            <span class="block text-[11px] text-slate-400 mt-0.5">
              Nettó: {{ searchStore.activeProductSheet.netPrice.toLocaleString('hu-HU', { maximumFractionDigits: 2 }) }} Ft
            </span>
          </div>
          <div
            class="px-4 py-2 rounded-xl border text-right"
            :class="
              searchStore.activeProductSheet.freeStock > 0
                ? 'bg-emerald-50 border-emerald-200'
                : 'bg-rose-50 border-rose-200'
            "
          >
            <span
              class="block text-xs"
              :class="
                searchStore.activeProductSheet.freeStock > 0
                  ? 'text-emerald-600'
                  : 'text-rose-600'
              "
            >
              Szabad készlet
            </span>
            <span
              class="text-lg font-black"
              :class="
                searchStore.activeProductSheet.freeStock > 0
                  ? 'text-emerald-700'
                  : 'text-rose-700'
              "
            >
              {{ searchStore.activeProductSheet.freeStock }} db
            </span>
          </div>
        </div>
      </div>

      <!-- Készlet eloszlás és Termék alapadatok -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="p-4 rounded-2xl border border-slate-200 bg-white">
          <h3 class="font-bold text-slate-900 mb-3">Készlet eloszlás (Polcok)</h3>
          <div
            v-if="
              searchStore.activeProductSheet.stockBreakdown &&
              searchStore.activeProductSheet.stockBreakdown.length > 0
            "
            class="divide-y divide-slate-100"
          >
            <div
              v-for="row in searchStore.activeProductSheet.stockBreakdown"
              :key="row.locationId"
              class="flex items-center justify-between gap-3 py-2.5 text-sm"
            >
              <span class="font-medium text-slate-800">{{ row.locationName }}</span>
              <div class="flex flex-wrap items-center justify-end gap-1.5 shrink-0 text-xs">
                <span
                  class="font-bold px-2 py-0.5 rounded-md"
                  :class="
                    row.freeQty > 0
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-rose-50 text-rose-700'
                  "
                >
                  {{ row.freeQty }} db szabad
                </span>
                <span
                  class="font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600"
                >
                  {{ row.reservedQty }} db foglalt
                </span>
                <button
                  v-if="canReportStock && !isExternalBreakdownLocation(row.locationId)"
                  type="button"
                  @click="openStockReportFromSheet(row)"
                  class="px-2 py-0.5 rounded-md border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-800 font-semibold inline-flex items-center gap-1 cursor-pointer transition"
                  title="Hiány / eltérés jelentése ezen a pozíción"
                >
                  <i class="pi pi-exclamation-triangle text-[10px]"></i>
                  <span>Hiány jelentése</span>
                </button>
              </div>
            </div>
          </div>
          <p v-else class="text-sm text-slate-400 py-3">
            Jelenleg nincs készleten egyetlen pozíción sem.
          </p>
        </div>

        <div class="p-4 rounded-2xl border border-slate-200 bg-white">
          <h3 class="font-bold text-slate-900 mb-3">Termék alapadatok</h3>
          <dl class="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
            <div>
              <dt class="text-xs text-slate-400">Márka</dt>
              <dd class="font-semibold text-slate-800">
                {{ searchStore.activeProductSheet.brandName || '—' }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-slate-400">Kategória</dt>
              <dd class="font-semibold text-slate-800">
                {{ searchStore.activeProductSheet.categoryName || '—' }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-slate-400">Beszállító</dt>
              <dd class="font-semibold text-slate-800">
                {{ searchStore.activeProductSheet.supplierName || '—' }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-slate-400">Gyártói kód</dt>
              <dd class="font-mono font-semibold text-slate-800">
                {{ searchStore.activeProductSheet.manufacturerCode || '—' }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-slate-400">Modell</dt>
              <dd class="font-semibold text-slate-800">
                {{ searchStore.activeProductSheet.model || '—' }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-slate-400">Anyag</dt>
              <dd class="font-semibold text-slate-800">
                {{ searchStore.activeProductSheet.material || '—' }}
              </dd>
            </div>
          </dl>
          <div
            v-if="searchStore.activeProductSheet.description"
            class="mt-3 pt-3 border-t border-slate-100"
          >
            <span class="text-xs text-slate-400 block mb-1">Termékleírás</span>
            <p class="text-xs text-slate-700 whitespace-pre-line leading-relaxed max-h-32 overflow-y-auto">
              {{ searchStore.activeProductSheet.description }}
            </p>
          </div>
        </div>
      </div>

      <!-- További méretek / variánsok -->
      <div class="p-4 rounded-2xl border border-slate-200 bg-white">
        <div class="flex items-center justify-between mb-3">
          <h3 class="font-bold text-slate-900">További méretek / variánsok ebből a termékből</h3>
          <span v-if="loadingSiblings" class="text-xs text-slate-400 flex items-center gap-1.5">
            <i class="pi pi-spin pi-spinner text-xs"></i> Betöltés...
          </span>
        </div>

        <div
          v-if="!loadingSiblings && siblingVariants.length === 0"
          class="text-sm text-slate-400 py-2"
        >
          Nincs további variáns.
        </div>

        <div v-else class="flex flex-wrap gap-2">
          <button
            v-for="sibling in siblingVariants"
            :key="sibling.id"
            type="button"
            @click="searchStore.openProductSheet(sibling)"
            class="px-3 py-2 rounded-xl border text-left transition cursor-pointer flex items-center gap-3"
            :class="
              sibling.id === searchStore.activeProductSheet.id
                ? 'border-orange-500 bg-orange-50 text-orange-950 shadow-sm'
                : 'border-slate-200 bg-slate-50/70 hover:border-orange-300 hover:bg-orange-50/40 text-slate-800'
            "
          >
            <div>
              <div class="text-xs font-bold">
                {{ sibling.variantLabel || sibling.sku }}
              </div>
              <div class="text-[11px] font-mono text-slate-500">
                {{ sibling.sku }}
              </div>
            </div>
            <span
              class="text-xs font-black px-2 py-0.5 rounded-md"
              :class="
                sibling.freeStock > 0
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-rose-100 text-rose-700'
              "
            >
              {{ sibling.freeStock }} db
            </span>
          </button>
        </div>
      </div>
    </div>
  </Dialog>

  <!-- 3. HIÁNY / ELTÉRÉS JELENTÉSE MODAL (F5 Termék Törzslapból indítva) -->
  <StockReportModal
    v-model:visible="isStockReportModalOpen"
    :initial-variant-id="reportInitialVariantId"
    :initial-location-id="reportInitialLocationId"
    :initial-expected-qty="reportInitialExpectedQty"
    :all-locations="allLocations"
    @saved="onStockReportSaved"
  />
</template>
