<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Role } from '@wmanager/shared-types'
import { useAuthStore } from '@/stores/auth'
import { productApi, type ProductListItem } from '@/api/products'
import { variantApi, type VariantItem } from '@/api/variants'
import { brandApi, type BrandItem } from '@/api/brands'
import { categoryApi, type Category } from '@/api/categories'
import { supplierApi, type SupplierItem } from '@/api/suppliers'
import { locationApi, type LocationItem } from '@/api/locations'
import { stockApi, type StockItemEntry, type StockMovementEntry } from '@/api/stock'
import { extractApiError } from '@/utils/locationMeta'
import ProductListSidebar from './ProductListSidebar.vue'
import ProductVariantsSection from './ProductVariantsSection.vue'
import ProductStockSection from './ProductStockSection.vue'
import ProductFormModal from './ProductFormModal.vue'
import VariantFormModal from './VariantFormModal.vue'
import VariantBarcodesModal from './VariantBarcodesModal.vue'
import StockAdjustModal from '@/components/inventory/StockAdjustModal.vue'
import StockReportModal from '@/components/inventory/StockReportModal.vue'
import ConfirmDeleteDialog from '@/components/common/ConfirmDeleteDialog.vue'
import { useToast } from 'primevue/usetoast'

const authStore = useAuthStore()
const toast = useToast()

// Jogosultságok
const canManageCatalog = computed(() => {
  const role = authStore.user?.role
  return role === Role.ADMIN || role === Role.BOSS || role === Role.WAREHOUSE_MANAGER
})

const canAdjustStock = computed(() => {
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

const canReportStock = computed(() => canAdjustStock.value)

const COST_PRICE_ROLES: Role[] = [
  Role.BOSS,
  Role.ADMIN,
  Role.WAREHOUSE_MANAGER,
  Role.STORE_MANAGER,
  Role.ORDER_CLERK,
]

const canSeeCostPrice = computed(() => {
  const role = authStore.user?.role
  if (!role || !COST_PRICE_ROLES.includes(role)) return false
  if (variants.value.length > 0 && variants.value.every((v) => v.costPrice === undefined)) {
    return false
  }
  return true
})

// Törzsadatok a szűrőkhöz és az űrlaphoz
const brands = ref<BrandItem[]>([])
const categories = ref<Category[]>([])
const suppliers = ref<SupplierItem[]>([])
const locations = ref<LocationItem[]>([])

// Bal oldali terméklista állapotai (szerveroldali szűrés és lapozás)
const products = ref<ProductListItem[]>([])
const totalProducts = ref(0)
const loadingProducts = ref(false)

const searchInput = ref('')
const debouncedSearch = ref('')
const categoryFilter = ref('')
const brandFilter = ref('')
const currentPage = ref(1)
const pageSize = 15

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let activeAbortController: AbortController | null = null

// Jobb oldali kiválasztott termék és variánsai
const selectedProductId = ref<string>('')
const selectedHeroImage = ref<string | null>(null)
const activeDetailTab = ref<'info' | 'variants' | 'stock'>('variants')

const variants = ref<VariantItem[]>([])
const loadingVariants = ref(false)

// Készlet és készletmozgások állapota a kiválasztott termékhez
const stockItems = ref<StockItemEntry[]>([])
const stockMovements = ref<StockMovementEntry[]>([])
const loadingStock = ref(false)
let stockAbortController: AbortController | null = null

// Modal állapot – Gyors készletfelvitel / korrekció
const isStockAdjustModalOpen = ref(false)
const adjustInitialLocationId = ref<string | null>(null)
const adjustInitialVariantId = ref<string | null>(null)

// Modal állapot – Hiány / eltérés jelentése
const isStockReportModalOpen = ref(false)
const reportInitialLocationId = ref<string | null>(null)
const reportInitialVariantId = ref<string | null>(null)
const reportInitialExpectedQty = ref<number | null>(null)

// Modal állapotok – Termék
const isProductModalOpen = ref(false)
const productModalMode = ref<'create' | 'edit'>('create')
const editingProduct = ref<ProductListItem | null>(null)
const isDeleteProductOpen = ref(false)
const deletingProduct = ref(false)

// Modal állapotok – Variáns
const isVariantModalOpen = ref(false)
const variantModalMode = ref<'create' | 'edit'>('create')
const editingVariant = ref<VariantItem | null>(null)
const cloningVariant = ref<VariantItem | null>(null)
const variantToDelete = ref<VariantItem | null>(null)
const isDeleteVariantOpen = ref(false)
const deletingVariant = ref(false)

// Modal állapotok – Vonalkódok
const isBarcodesModalOpen = ref(false)
const barcodeModalVariant = ref<VariantItem | null>(null)

const selectedProduct = computed(
  () => products.value.find((p) => p.id === selectedProductId.value) ?? null,
)

interface HeroGalleryItem {
  url: string
  label: string
}

const distinctColorwayImages = computed<HeroGalleryItem[]>(() => {
  const items: HeroGalleryItem[] = []
  const seenUrls = new Set<string>()

  for (const v of variants.value) {
    const url = v.imageUrls?.[0]?.trim()
    if (!url || seenUrls.has(url)) continue
    seenUrls.add(url)
    const colorLabel = v.colors?.length ? v.colors.join(' / ') : v.sku
    items.push({ url, label: colorLabel })
  }

  for (const rawUrl of selectedProduct.value?.imageUrls ?? []) {
    const url = rawUrl.trim()
    if (!url || seenUrls.has(url)) continue
    seenUrls.add(url)
    items.push({ url, label: selectedProduct.value?.name || 'Termékkép' })
  }

  return items
})

const activeHeroImage = computed<string | null>(() => {
  if (
    selectedHeroImage.value &&
    distinctColorwayImages.value.some((item) => item.url === selectedHeroImage.value)
  ) {
    return selectedHeroImage.value
  }
  return (
    distinctColorwayImages.value[0]?.url ||
    selectedProduct.value?.imageUrls?.[0] ||
    null
  )
})

const totalPages = computed(() => Math.max(1, Math.ceil(totalProducts.value / pageSize)))

const paginationRangeText = computed(() => {
  if (totalProducts.value === 0) return '0 / 0 termék'
  const start = (currentPage.value - 1) * pageSize + 1
  const end = Math.min(currentPage.value * pageSize, totalProducts.value)
  return `${start}–${end} / ${totalProducts.value} termék`
})

const hasActiveFilters = computed(() =>
  Boolean(debouncedSearch.value || categoryFilter.value || brandFilter.value),
)

const sortedBrands = computed(() =>
  [...brands.value].sort((a, b) => a.name.localeCompare(b.name, 'hu')),
)

const categoryById = computed(() => new Map(categories.value.map((c) => [c.id, c])))

function formatCategoryPath(categoryId?: string | null, fallbackName?: string): string {
  if (!categoryId) return fallbackName ?? '—'
  const parts: string[] = []
  const seen = new Set<string>()
  let current = categoryById.value.get(categoryId)
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    parts.unshift(current.name)
    current = current.parentId ? categoryById.value.get(current.parentId) : undefined
  }
  return parts.length > 0 ? parts.join(' › ') : (fallbackName ?? '—')
}

const sortedCategories = computed(() =>
  categories.value
    .map((c) => ({
      id: c.id,
      label: formatCategoryPath(c.id, c.name),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'hu')),
)

const freeStockByVariantId = computed(() => {
  const map = new Map<string, number>()
  for (const item of stockItems.value) {
    const free = item.quantity - item.reservedQuantity
    map.set(item.variantId, (map.get(item.variantId) ?? 0) + free)
  }
  return map
})

const totalFreeQty = computed(() =>
  stockItems.value.reduce((sum, item) => sum + (item.quantity - item.reservedQuantity), 0),
)

function isCanceledError(err: unknown): boolean {
  const e = err as { code?: string; name?: string }
  return e?.code === 'ERR_CANCELED' || e?.name === 'CanceledError' || e?.name === 'AbortError'
}

async function loadLookups() {
  try {
    const [brandsRes, categoriesRes, suppliersRes, locationsRes] = await Promise.all([
      brandApi.getAll(),
      categoryApi.getAll(),
      supplierApi.getAll(),
      locationApi.getAll(),
    ])
    brands.value = brandsRes.data
    categories.value = categoriesRes.data
    suppliers.value = suppliersRes.data
    locations.value = locationsRes.data
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Törzsadat hiba',
      detail: extractApiError(err, 'Nem sikerült betölteni a márkákat és kategóriákat.'),
      life: 4000,
    })
  }
}

async function loadProducts(preferProductId?: string) {
  if (activeAbortController) {
    activeAbortController.abort()
  }
  const controller = new AbortController()
  activeAbortController = controller

  loadingProducts.value = true
  try {
    const skip = (currentPage.value - 1) * pageSize
    const res = await productApi.getAll(
      {
        search: debouncedSearch.value || undefined,
        categoryId: categoryFilter.value || undefined,
        brandId: brandFilter.value || undefined,
        skip,
        take: pageSize,
      },
      controller.signal,
    )

    products.value = res.data.items
    totalProducts.value = res.data.total

    const targetId = preferProductId || selectedProductId.value
    if (targetId && products.value.some((p) => p.id === targetId)) {
      selectedProductId.value = targetId
    } else {
      selectedProductId.value = products.value[0]?.id ?? ''
    }
  } catch (err) {
    if (isCanceledError(err)) return
    toast.add({
      severity: 'error',
      summary: 'Betöltési hiba',
      detail: extractApiError(err, 'Nem sikerült betölteni a terméklistát.'),
      life: 4000,
    })
  } finally {
    if (activeAbortController === controller) {
      loadingProducts.value = false
    }
  }
}

async function loadVariants(productId: string) {
  if (!productId) {
    variants.value = []
    return
  }
  loadingVariants.value = true
  try {
    const res = await variantApi.getAll({ productId })
    variants.value = res.data
    // Szinkronban tartjuk a bal oldali lista variáns-számlálóját
    const prod = products.value.find((p) => p.id === productId)
    if (prod) {
      prod._count = { variants: res.data.length }
    }
    if (barcodeModalVariant.value) {
      const updated = res.data.find((v) => v.id === barcodeModalVariant.value?.id)
      if (updated) {
        barcodeModalVariant.value = updated
      }
    }
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Variánsok betöltési hiba',
      detail: extractApiError(err, 'Nem sikerült betölteni a termék variánsait.'),
      life: 4000,
    })
  } finally {
    loadingVariants.value = false
  }
}

// ~300 ms debounce a szöveges keresőre
watch(searchInput, (val) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    const trimmed = val.trim()
    if (debouncedSearch.value !== trimmed) {
      debouncedSearch.value = trimmed
      currentPage.value = 1
      void loadProducts()
    }
  }, 300)
})

function triggerImmediateSearch() {
  if (debounceTimer) clearTimeout(debounceTimer)
  const trimmed = searchInput.value.trim()
  debouncedSearch.value = trimmed
  currentPage.value = 1
  void loadProducts()
}

// Kategória vagy márka szűrő váltásakor page = 1 reset
watch([categoryFilter, brandFilter], () => {
  currentPage.value = 1
  void loadProducts()
})

async function loadProductStock(productId: string) {
  if (stockAbortController) {
    stockAbortController.abort()
  }
  if (!productId) {
    stockItems.value = []
    stockMovements.value = []
    return
  }

  const controller = new AbortController()
  stockAbortController = controller
  loadingStock.value = true

  try {
    const [stockRes, movementsRes] = await Promise.all([
      stockApi.getAll({ productId, take: 100 }, controller.signal),
      stockApi.getMovements({ productId, take: 15 }, controller.signal),
    ])
    stockItems.value = stockRes.data.items
    stockMovements.value = movementsRes.data.items
  } catch (err) {
    if (isCanceledError(err)) return
    toast.add({
      severity: 'error',
      summary: 'Készlet betöltési hiba',
      detail: extractApiError(err, 'Nem sikerült betölteni a termék készletadatait.'),
      life: 4000,
    })
  } finally {
    if (stockAbortController === controller) {
      loadingStock.value = false
    }
  }
}

// Kiválasztott termék változásakor variánsok és készletadatok lekérése
watch(selectedProductId, (newId) => {
  selectedHeroImage.value = null
  if (newId) {
    void loadVariants(newId)
    void loadProductStock(newId)
  } else {
    variants.value = []
    stockItems.value = []
    stockMovements.value = []
  }
})

function goToPage(page: number) {
  if (page < 1 || page > totalPages.value || page === currentPage.value) return
  currentPage.value = page
  void loadProducts()
}

function resetFilters() {
  if (debounceTimer) clearTimeout(debounceTimer)
  searchInput.value = ''
  debouncedSearch.value = ''
  categoryFilter.value = ''
  brandFilter.value = ''
  currentPage.value = 1
  void loadProducts()
}

// Termék CRUD műveletek
function openCreateProduct() {
  productModalMode.value = 'create'
  editingProduct.value = null
  isProductModalOpen.value = true
}

function openEditProduct() {
  if (!selectedProduct.value) return
  productModalMode.value = 'edit'
  editingProduct.value = selectedProduct.value
  isProductModalOpen.value = true
}

async function onProductSaved(saved: ProductListItem) {
  await loadProducts(saved.id)
}

async function confirmDeleteProduct() {
  if (!selectedProduct.value) return
  deletingProduct.value = true
  try {
    const deletedName = selectedProduct.value.name
    await productApi.remove(selectedProduct.value.id)
    toast.add({
      severity: 'success',
      summary: 'Termék törölve',
      detail: `„${deletedName}” eltávolítva a katalógusból.`,
      life: 3500,
    })
    isDeleteProductOpen.value = false
    selectedProductId.value = ''
    await loadProducts()
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Nem törölhető',
      detail: extractApiError(
        err,
        'A termék nem törölhető (ellenőrizd, hogy tartoznak-e hozzá variánsok).',
      ),
      life: 5000,
    })
  } finally {
    deletingProduct.value = false
  }
}

// Variáns CRUD műveletek
function openCreateVariant() {
  if (!selectedProduct.value) return
  variantModalMode.value = 'create'
  editingVariant.value = null
  cloningVariant.value = null
  isVariantModalOpen.value = true
}

function openCloneVariant(variant: VariantItem) {
  if (!selectedProduct.value) return
  variantModalMode.value = 'create'
  editingVariant.value = null
  cloningVariant.value = variant
  isVariantModalOpen.value = true
}

function openEditVariant(variant: VariantItem) {
  variantModalMode.value = 'edit'
  editingVariant.value = variant
  cloningVariant.value = null
  isVariantModalOpen.value = true
}

async function onVariantSaved() {
  if (!selectedProduct.value) return
  await loadVariants(selectedProduct.value.id)
}

function promptDeleteVariant(variant: VariantItem) {
  variantToDelete.value = variant
  isDeleteVariantOpen.value = true
}

async function confirmDeleteVariant() {
  if (!variantToDelete.value || !selectedProduct.value) return
  deletingVariant.value = true
  try {
    const sku = variantToDelete.value.sku
    await variantApi.remove(variantToDelete.value.id)
    toast.add({
      severity: 'success',
      summary: 'Variáns törölve',
      detail: `„${sku}” variáns eltávolítva.`,
      life: 3500,
    })
    isDeleteVariantOpen.value = false
    variantToDelete.value = null
    await loadVariants(selectedProduct.value.id)
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Törlési hiba',
      detail: extractApiError(err, 'Nem sikerült törölni a variánst.'),
      life: 5000,
    })
  } finally {
    deletingVariant.value = false
  }
}

// Vonalkód modal megnyitása
function openBarcodesModal(variant: VariantItem) {
  barcodeModalVariant.value = variant
  isBarcodesModalOpen.value = true
}

async function onBarcodesUpdated() {
  if (!selectedProduct.value) return
  await loadVariants(selectedProduct.value.id)
}

// Gyors készletfelvitel / korrekció modal
function openStockAdjustModal(locationId: string | null = null, variantId: string | null = null) {
  adjustInitialLocationId.value = locationId
  adjustInitialVariantId.value =
    variantId ?? (variants.value.length === 1 ? (variants.value[0]?.id ?? null) : null)
  isStockAdjustModalOpen.value = true
}

function openStockReportModal(locationId: string, variantId: string, expectedQty: number) {
  reportInitialLocationId.value = locationId
  reportInitialVariantId.value = variantId
  reportInitialExpectedQty.value = expectedQty
  isStockReportModalOpen.value = true
}

async function onStockAdjusted() {
  if (!selectedProduct.value) return
  await loadProductStock(selectedProduct.value.id)
}

onMounted(async () => {
  await Promise.all([loadLookups(), loadProducts()])
})

onBeforeUnmount(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (activeAbortController) activeAbortController.abort()
  if (stockAbortController) stockAbortController.abort()
})
</script>

<template>
  <!-- OSZTOTT NÉZET (Master-Detail Grid: Bal 4 oszlop, Jobb 8 oszlop) -->
  <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
    <!-- 1. BAL OLDALI KÁRTYA -->
    <ProductListSidebar
      v-model:search-input="searchInput"
      v-model:category-filter="categoryFilter"
      v-model:brand-filter="brandFilter"
      :products="products"
      :total-products="totalProducts"
      :loading="loadingProducts"
      :selected-product-id="selectedProductId"
      :categories="sortedCategories"
      :brands="sortedBrands"
      :current-page="currentPage"
      :total-pages="totalPages"
      :pagination-range-text="paginationRangeText"
      :can-manage-catalog="canManageCatalog"
      :has-active-filters="hasActiveFilters"
      @select-product="selectedProductId = $event"
      @page-change="goToPage"
      @immediate-search="triggerImmediateSearch"
      @reset-filters="resetFilters"
      @create-product="openCreateProduct"
    />

    <!-- 2. JOBB OLDALI KÁRTYA: A kiválasztott termék szellős adatlapja -->
    <div
      v-if="selectedProduct"
      class="lg:col-span-8 bg-white rounded-3xl border border-white shadow-sm p-6 sm:p-8 space-y-6"
    >
      <!-- Felső fejléc: Terméknév + Státusz + Szerkesztés / Törlés gombok -->
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div class="flex flex-wrap items-center gap-2.5">
          <h1 class="text-2xl font-bold text-slate-900">{{ selectedProduct.name }}</h1>
          <span
            class="text-xs font-bold px-2.5 py-1 rounded-full"
            :class="
              selectedProduct.isActive
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-slate-100 text-slate-500'
            "
          >
            {{ selectedProduct.isActive ? 'Aktív' : 'Inaktív' }}
          </span>
          <span
            v-if="selectedProduct.isPurchasable === false"
            class="text-xs font-bold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200"
          >
            Nem vásárolható
          </span>
        </div>

        <div v-if="canManageCatalog" class="flex items-center gap-2">
          <button
            type="button"
            @click="openEditProduct"
            class="px-4 py-2 rounded-xl border border-slate-200 hover:border-slate-300 text-sm font-semibold text-slate-700 flex items-center gap-2 cursor-pointer transition"
          >
            <i class="pi pi-pencil text-xs"></i>
            <span>Szerkesztés</span>
          </button>
          <button
            type="button"
            @click="isDeleteProductOpen = true"
            class="w-9 h-9 rounded-xl border border-rose-200 hover:bg-rose-50 text-rose-600 flex items-center justify-center cursor-pointer transition"
            title="Termék törlése"
          >
            <i class="pi pi-trash text-xs"></i>
          </button>
        </div>
      </div>

      <!-- Kiemelt figyelmeztetés (Fontos) -->
      <div
        v-if="selectedProduct.importantNote"
        class="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-xs text-amber-900"
      >
        <i class="pi pi-exclamation-triangle text-amber-600 text-sm mt-0.5 shrink-0"></i>
        <div>
          <span class="font-bold uppercase tracking-wider text-[10px] text-amber-700 block">
            Fontos megjegyzés
          </span>
          <p class="font-medium mt-0.5 whitespace-pre-line">{{ selectedProduct.importantNote }}</p>
        </div>
      </div>

      <!-- Hero szekció: Balra nagy termékkép + színváltozat galéria, Jobbra 4 információs kártya -->
      <div class="grid grid-cols-1 sm:grid-cols-12 gap-6 items-center">
        <div class="sm:col-span-4 space-y-2.5">
          <div
            class="aspect-square rounded-2xl border border-slate-100 flex flex-col items-center justify-center text-slate-400 overflow-hidden"
            :class="activeHeroImage ? 'bg-white' : 'bg-slate-100/80'"
          >
            <img
              v-if="activeHeroImage"
              :src="activeHeroImage"
              :alt="selectedProduct.name"
              class="w-full h-full object-contain bg-white"
            />
            <template v-else>
              <i class="pi pi-image text-4xl mb-2"></i>
              <span class="text-xs">Nincs termékkép</span>
            </template>
          </div>

          <div
            v-if="distinctColorwayImages.length > 1"
            class="flex items-start gap-2 overflow-x-auto pb-1"
          >
            <button
              v-for="imgItem in distinctColorwayImages"
              :key="imgItem.url"
              type="button"
              @click="selectedHeroImage = imgItem.url"
              :title="imgItem.label"
              class="group flex flex-col items-center gap-1 w-12 shrink-0 cursor-pointer"
            >
              <div
                class="w-12 h-12 aspect-square rounded-xl overflow-hidden border-2 bg-white transition"
                :class="
                  activeHeroImage === imgItem.url
                    ? 'border-orange-500 ring-2 ring-orange-500/20'
                    : 'border-slate-200 group-hover:border-slate-300 opacity-80 group-hover:opacity-100'
                "
              >
                <img
                  :src="imgItem.url"
                  :alt="imgItem.label"
                  class="w-full h-full aspect-square object-contain bg-white"
                />
              </div>
              <span
                class="w-full text-[10px] leading-tight text-center truncate transition"
                :class="
                  activeHeroImage === imgItem.url
                    ? 'font-bold text-orange-700'
                    : 'font-medium text-slate-500'
                "
              >
                {{ imgItem.label }}
              </span>
            </button>
          </div>
        </div>

        <div class="sm:col-span-8 grid grid-cols-2 gap-3">
          <div class="p-3.5 rounded-2xl bg-slate-50/80">
            <span class="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Márka
            </span>
            <span class="text-base font-bold text-slate-900 mt-0.5 block">
              {{ selectedProduct.brand?.name ?? '—' }}
            </span>
          </div>
          <div class="p-3.5 rounded-2xl bg-slate-50/80">
            <span class="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Kategória
            </span>
            <span class="text-base font-bold text-slate-900 mt-0.5 block">
              {{ formatCategoryPath(selectedProduct.categoryId, selectedProduct.category?.name) }}
            </span>
          </div>
          <div class="p-3.5 rounded-2xl bg-slate-50/80">
            <span class="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Gyártói kód
            </span>
            <span class="text-base font-bold font-mono text-slate-900 mt-0.5 block">
              {{ selectedProduct.manufacturerCode || '—' }}
            </span>
          </div>
          <div class="p-3.5 rounded-2xl bg-slate-50/80">
            <span class="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
              ÁFA kulcs
            </span>
            <span class="text-base font-bold text-slate-900 mt-0.5 block">
              {{ Number(selectedProduct.vatRate) }}%
            </span>
          </div>
        </div>
      </div>

      <!-- Belső 3 Fül (Alapadatok | Variánsok & Árak | Készlet & Mozgások) -->
      <div class="border-b border-slate-100 flex items-center gap-6">
        <button
          type="button"
          @click="activeDetailTab = 'info'"
          class="pb-3 text-sm font-semibold border-b-2 transition cursor-pointer"
          :class="
            activeDetailTab === 'info'
              ? 'border-orange-500 text-slate-900'
              : 'border-transparent text-slate-400 hover:text-slate-700'
          "
        >
          Alapadatok
        </button>
        <button
          type="button"
          @click="activeDetailTab = 'variants'"
          class="pb-3 text-sm font-semibold border-b-2 transition cursor-pointer"
          :class="
            activeDetailTab === 'variants'
              ? 'border-orange-500 text-slate-900'
              : 'border-transparent text-slate-400 hover:text-slate-700'
          "
        >
          Variánsok & Árak ({{ variants.length }})
        </button>
        <button
          type="button"
          @click="activeDetailTab = 'stock'"
          class="pb-3 text-sm font-semibold border-b-2 transition cursor-pointer flex items-center gap-1.5"
          :class="
            activeDetailTab === 'stock'
              ? 'border-orange-500 text-slate-900'
              : 'border-transparent text-slate-400 hover:text-slate-700'
          "
        >
          <span>Készlet & Mozgások</span>
          <span
            class="text-[11px] font-bold px-2 py-0.5 rounded-full"
            :class="
              totalFreeQty > 0
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-slate-100 text-slate-500'
            "
          >
            {{ totalFreeQty }} db
          </span>
        </button>
      </div>

      <!-- FÜL 1: ALAPADATOK -->
      <div v-if="activeDetailTab === 'info'" class="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
        <div>
          <span class="text-xs text-slate-400 block">Elsődleges beszállító</span>
          <span class="text-sm font-semibold text-slate-800">
            {{ selectedProduct.primarySupplier?.name ?? '—' }}
          </span>
        </div>
        <div>
          <span class="text-xs text-slate-400 block">Modell</span>
          <span class="text-sm font-semibold text-slate-800">{{ selectedProduct.model || '—' }}</span>
        </div>
        <div>
          <span class="text-xs text-slate-400 block">Nem</span>
          <span class="text-sm font-semibold text-slate-800">{{ selectedProduct.gender || '—' }}</span>
        </div>
        <div>
          <span class="text-xs text-slate-400 block">Mennyiségi egység</span>
          <span class="text-sm font-semibold text-slate-800">{{ selectedProduct.unit || 'DB' }}</span>
        </div>
        <div>
          <span class="text-xs text-slate-400 block">VTSZ kód</span>
          <span class="text-sm font-mono font-semibold text-slate-800">
            {{ selectedProduct.vtszCode || '—' }}
          </span>
        </div>
        <div>
          <span class="text-xs text-slate-400 block">Származási ország</span>
          <span class="text-sm font-mono font-semibold text-slate-800">
            {{ selectedProduct.originCountry || '—' }}
          </span>
        </div>
        <div>
          <span class="text-xs text-slate-400 block">Szezon</span>
          <span class="text-sm font-semibold text-slate-800">
            {{ selectedProduct.season || '—' }}
          </span>
        </div>
        <div>
          <span class="text-xs text-slate-400 block">Vásárolható / Gyáriszámos</span>
          <span class="text-sm font-semibold text-slate-800">
            {{ selectedProduct.isPurchasable === false ? 'Nem vásárolható' : 'Vásárolható' }} ·
            {{ selectedProduct.isSerialized ? 'Gyáriszámos' : 'Nem gyáriszámos' }}
          </span>
        </div>
        <div>
          <span class="text-xs text-slate-400 block">Anyagösszetétel</span>
          <span class="text-sm font-semibold text-slate-800">
            {{ selectedProduct.material || '—' }}
          </span>
        </div>
        <div>
          <span class="text-xs text-slate-400 block">Felhasználási terület</span>
          <span class="text-sm font-semibold text-slate-800">
            {{ selectedProduct.usageArea || '—' }}
          </span>
        </div>
        <div class="sm:col-span-2">
          <span class="text-xs text-slate-400 block">Funkcionalitás / Jellemzők</span>
          <span class="text-sm font-semibold text-slate-800">
            {{ selectedProduct.functionality || '—' }}
          </span>
        </div>
        <div class="sm:col-span-3 pt-2 border-t border-slate-100">
          <span class="text-xs text-slate-400 block mb-1">Termékleírás</span>
          <p
            v-if="selectedProduct.description"
            class="text-sm text-slate-700 whitespace-pre-line leading-relaxed bg-slate-50/70 rounded-2xl p-3.5 border border-slate-100"
          >
            {{ selectedProduct.description }}
          </p>
          <span v-else class="text-sm font-semibold text-slate-400">—</span>
        </div>
      </div>

      <!-- FÜL 2: VARIÁNSOK & ÁRAK -->
      <ProductVariantsSection
        v-else-if="activeDetailTab === 'variants'"
        :variants="variants"
        :loading="loadingVariants"
        :product-image-urls="selectedProduct.imageUrls"
        :can-manage-catalog="canManageCatalog"
        :can-adjust-stock="canAdjustStock"
        :can-see-cost-price="canSeeCostPrice"
        :free-stock-by-variant-id="freeStockByVariantId"
        @create-variant="openCreateVariant"
        @clone-variant="openCloneVariant"
        @edit-variant="openEditVariant"
        @delete-variant="promptDeleteVariant"
        @open-barcodes="openBarcodesModal"
        @adjust-stock="openStockAdjustModal(null, $event)"
        @select-hero-image="selectedHeroImage = $event"
      />

      <!-- FÜL 3: KÉSZLET & MOZGÁSOK -->
      <ProductStockSection
        v-else
        :stock-items="stockItems"
        :stock-movements="stockMovements"
        :loading="loadingStock"
        :locations="locations"
        :can-adjust-stock="canAdjustStock"
        :can-report-stock="canReportStock"
        @adjust-stock="openStockAdjustModal"
        @report-stock="openStockReportModal"
      />
    </div>

    <!-- Ha nincs kiválasztott termék -->
    <div
      v-else
      class="lg:col-span-8 bg-white rounded-3xl border border-white shadow-sm p-12 text-center space-y-2 text-slate-400"
    >
      <i class="pi pi-box text-3xl text-slate-300 block"></i>
      <p class="text-sm font-semibold text-slate-600">Nincs kiválasztott termék</p>
      <p class="text-xs">Válassz egy terméket a bal oldali listából a részletek megtekintéséhez.</p>
    </div>

    <!-- Termék Létrehozó / Szerkesztő Modal -->
    <ProductFormModal
      v-model:visible="isProductModalOpen"
      :mode="productModalMode"
      :editing-product="editingProduct"
      :brands="brands"
      :categories="categories"
      :suppliers="suppliers"
      @saved="onProductSaved"
    />

    <!-- Termék Törlés Megerősítő Dialog -->
    <ConfirmDeleteDialog
      v-model:visible="isDeleteProductOpen"
      header="Termék törlése"
      :item-name="selectedProduct?.name"
      warning-note="Csak olyan termék törölhető, amelyhez már nem tartoznak variánsok."
      :loading="deletingProduct"
      @confirm="confirmDeleteProduct"
    >
      <p v-if="selectedProduct" class="text-sm text-slate-600">
        Biztosan törölni szeretnéd a(z)
        <strong class="text-slate-900">„{{ selectedProduct.name }}”</strong> terméket?
      </p>
    </ConfirmDeleteDialog>

    <!-- Variáns Létrehozó / Szerkesztő Modal -->
    <VariantFormModal
      v-if="selectedProduct"
      v-model:visible="isVariantModalOpen"
      :mode="variantModalMode"
      :product-id="selectedProduct.id"
      :product-name="selectedProduct.name"
      :manufacturerCode="selectedProduct.manufacturerCode"
      :vat-rate="Number(selectedProduct.vatRate ?? 27)"
      :existingSkus="variants.map((v) => v.sku)"
      :editing-variant="editingVariant"
      :templateVariant="cloningVariant"
      @saved="onVariantSaved"
    />

    <!-- Variáns Törlés Megerősítő Dialog -->
    <ConfirmDeleteDialog
      v-model:visible="isDeleteVariantOpen"
      header="Variáns törlése"
      :item-name="variantToDelete?.sku"
      confirm-label="Variáns törlése"
      :loading="deletingVariant"
      @confirm="confirmDeleteVariant"
    >
      <p v-if="variantToDelete" class="text-sm text-slate-600">
        Biztosan törölni szeretnéd a(z)
        <strong class="font-mono text-slate-900">{{ variantToDelete.sku }}</strong>
        <template v-if="variantToDelete.size"> ({{ variantToDelete.size }})</template>
        variánst?
      </p>
    </ConfirmDeleteDialog>

    <!-- Variáns Vonalkódok Modal -->
    <VariantBarcodesModal
      v-model:visible="isBarcodesModalOpen"
      :variant="barcodeModalVariant"
      :can-manage="canManageCatalog"
      @updated="onBarcodesUpdated"
    />

    <!-- Gyors készletfelvitel / korrekció Modal -->
    <StockAdjustModal
      v-model:visible="isStockAdjustModalOpen"
      :initial-location-id="adjustInitialLocationId"
      :initial-variant-id="adjustInitialVariantId"
      :all-locations="locations"
      @saved="onStockAdjusted"
    />

    <!-- Hiány / eltérés jelentése Modal -->
    <StockReportModal
      v-model:visible="isStockReportModalOpen"
      :initial-variant-id="reportInitialVariantId"
      :initial-location-id="reportInitialLocationId"
      :initial-expected-qty="reportInitialExpectedQty"
      :all-locations="locations"
      @saved="onStockAdjusted"
    />
  </div>
</template>
