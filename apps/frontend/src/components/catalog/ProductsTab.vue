<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { MovementType, Role } from '@wmanager/shared-types'
import { useAuthStore } from '@/stores/auth'
import { productApi, type ProductListItem } from '@/api/products'
import { variantApi, type VariantBarcodeItem, type VariantItem } from '@/api/variants'
import { brandApi, type BrandItem } from '@/api/brands'
import { categoryApi, type Category } from '@/api/categories'
import { supplierApi, type SupplierItem } from '@/api/suppliers'
import { locationApi, type LocationItem } from '@/api/locations'
import { stockApi, type StockItemEntry, type StockMovementEntry } from '@/api/stock'
import { extractApiError, getLocationPath, LOCATION_TYPE_META } from '@/utils/locationMeta'
import ProductFormModal from './ProductFormModal.vue'
import VariantFormModal from './VariantFormModal.vue'
import VariantBarcodesModal from './VariantBarcodesModal.vue'
import StockAdjustModal from '@/components/inventory/StockAdjustModal.vue'
import StockReportModal from '@/components/inventory/StockReportModal.vue'
import Dialog from 'primevue/dialog'
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

function getVariantThumbnail(variant: VariantItem): string | null {
  return variant.imageUrls?.[0] || selectedProduct.value?.imageUrls?.[0] || null
}

const totalPages = computed(() => Math.max(1, Math.ceil(totalProducts.value / pageSize)))

const paginationRangeText = computed(() => {
  if (totalProducts.value === 0) return '0 / 0 termék'
  const start = (currentPage.value - 1) * pageSize + 1
  const end = Math.min(currentPage.value * pageSize, totalProducts.value)
  return `${start}–${end} / ${totalProducts.value} termék`
})

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
      name: c.name,
      label: formatCategoryPath(c.id, c.name),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'hu')),
)

const locationById = computed(() => new Map(locations.value.map((l) => [l.id, l])))

const freeStockByVariantId = computed(() => {
  const map = new Map<string, number>()
  for (const item of stockItems.value) {
    const free = item.quantity - item.reservedQuantity
    map.set(item.variantId, (map.get(item.variantId) ?? 0) + free)
  }
  return map
})

function getVariantFreeStock(variantId: string): number {
  return freeStockByVariantId.value.get(variantId) ?? 0
}

const visibleStockItems = computed(() =>
  stockItems.value.filter((item) => item.quantity > 0 || item.reservedQuantity > 0),
)

const totalStockQty = computed(() =>
  stockItems.value.reduce((sum, item) => sum + item.quantity, 0),
)

const totalReservedQty = computed(() =>
  stockItems.value.reduce((sum, item) => sum + item.reservedQuantity, 0),
)

const totalFreeQty = computed(() => totalStockQty.value - totalReservedQty.value)

const MOVEMENT_TYPE_META: Record<MovementType, { label: string; badgeClass: string }> = {
  [MovementType.INITIAL_STOCK]: {
    label: 'Kezdeti felvitel',
    badgeClass: 'bg-blue-50 text-blue-700 border border-blue-200',
  },
  [MovementType.PURCHASE_RECEIPT]: {
    label: 'Bevételezés',
    badgeClass: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  },
  [MovementType.SALE]: {
    label: 'Eladás',
    badgeClass: 'bg-orange-50 text-orange-700 border border-orange-200',
  },
  [MovementType.TRANSFER_OUT]: {
    label: 'Átmozgatás ki',
    badgeClass: 'bg-amber-50 text-amber-700 border border-amber-200',
  },
  [MovementType.TRANSFER_IN]: {
    label: 'Átmozgatás be',
    badgeClass: 'bg-teal-50 text-teal-700 border border-teal-200',
  },
  [MovementType.STOCKTAKE_ADJUSTMENT]: {
    label: 'Leltárkorrekció',
    badgeClass: 'bg-purple-50 text-purple-700 border border-purple-200',
  },
  [MovementType.RETURN_RESTOCK]: {
    label: 'Visszáru készletre',
    badgeClass: 'bg-indigo-50 text-indigo-700 border border-indigo-200',
  },
  [MovementType.MANUAL_CORRECTION]: {
    label: 'Kézi korrekció',
    badgeClass: 'bg-slate-100 text-slate-700 border border-slate-200',
  },
}

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

function getPrimaryBarcode(variant: VariantItem): VariantBarcodeItem | undefined {
  const list = variant.variantBarcodes ?? []
  return list.find((b) => b.isPrimary) ?? list[0]
}

function formatLocationBreadcrumb(location: LocationItem): string {
  const path = getLocationPath(location.id, locationById.value)
  if (path.length > 0) {
    return path.map((loc) => loc.name).join(' › ')
  }
  return location.name
}

function formatMovementDate(iso: string): string {
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

function formatSignedQuantity(qty: number): string {
  return qty > 0 ? `+${qty} db` : `${qty} db`
}

function formatPrice(val: number | string | undefined): string {
  if (val === undefined || val === null) return '—'
  const num = Number(val)
  if (Number.isNaN(num)) return String(val)
  return `${num.toLocaleString('hu-HU')} Ft`
}

function formatWeight(val: number | string | undefined): string {
  if (val === undefined || val === null) return '—'
  const num = Number(val)
  if (Number.isNaN(num)) return String(val)
  return `${num.toLocaleString('hu-HU')} kg`
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
    <!-- 1. BAL OLDALI KÁRTYA: Kereső + Szűrők + Új gomb + Szerveroldali Terméklista + Lapozó -->
    <div
      class="lg:col-span-4 bg-white rounded-3xl border border-white shadow-sm p-4 flex flex-col h-[calc(100vh-190px)] min-h-[560px]"
    >
      <!-- Kereső + Új termék gomb -->
      <div class="flex items-center gap-2 mb-2.5">
        <div class="relative flex-1">
          <i
            class="pi pi-search absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs"
          ></i>
          <input
            v-model="searchInput"
            type="text"
            placeholder="Név, kód, SKU vagy vonalkód..."
            @keydown.enter.prevent="triggerImmediateSearch"
            class="w-full bg-slate-100/80 rounded-xl py-2 pl-9 pr-3 text-sm text-slate-800 placeholder-slate-400 outline-none focus:ring-2 focus:ring-orange-500/20"
          />
        </div>
        <button
          v-if="canManageCatalog"
          type="button"
          @click="openCreateProduct"
          class="bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold px-3.5 py-2.5 rounded-xl flex items-center gap-1.5 shrink-0 cursor-pointer transition shadow-sm"
        >
          <i class="pi pi-plus text-xs"></i>
          <span>Új termék</span>
        </button>
      </div>

      <!-- Kategória és Márka szűrők -->
      <div class="grid grid-cols-2 gap-2 mb-3">
        <select
          v-model="categoryFilter"
          class="h-8 rounded-xl bg-slate-100/80 px-2.5 text-xs text-slate-700 outline-none focus:ring-2 focus:ring-orange-500/20"
        >
          <option value="">Minden kategória</option>
          <option v-for="c in sortedCategories" :key="c.id" :value="c.id">
            {{ c.label }}
          </option>
        </select>

        <select
          v-model="brandFilter"
          class="h-8 rounded-xl bg-slate-100/80 px-2.5 text-xs text-slate-700 outline-none focus:ring-2 focus:ring-orange-500/20"
        >
          <option value="">Minden márka</option>
          <option v-for="b in sortedBrands" :key="b.id" :value="b.id">
            {{ b.name }}
          </option>
        </select>
      </div>

      <!-- Görgethető terméklista -->
      <div class="flex-1 overflow-y-auto space-y-1.5 pr-1">
        <div
          v-if="loadingProducts && products.length === 0"
          class="py-12 text-center text-xs text-slate-400"
        >
          <i class="pi pi-spin pi-spinner mr-1.5"></i> Termékek betöltése...
        </div>

        <div
          v-else-if="products.length === 0"
          class="py-10 px-4 text-center space-y-2 text-xs text-slate-400"
        >
          <i class="pi pi-inbox text-2xl block text-slate-300"></i>
          <p>Nincs a szűrésnek megfelelő termék.</p>
          <button
            v-if="debouncedSearch || categoryFilter || brandFilter"
            type="button"
            @click="resetFilters"
            class="text-orange-600 hover:underline font-semibold cursor-pointer"
          >
            Szűrők törlése
          </button>
        </div>

        <div
          v-else
          v-for="product in products"
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
                {{ product.brand?.name ?? '—' }} ·
                <span class="font-mono">{{ product.manufacturerCode }}</span>
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
        <span>{{ paginationRangeText }}</span>
        <div class="flex items-center gap-1.5">
          <button
            type="button"
            :disabled="currentPage <= 1 || loadingProducts"
            @click="goToPage(currentPage - 1)"
            class="h-7 px-2.5 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 text-slate-700 font-semibold cursor-pointer transition"
          >
            Előző
          </button>
          <span class="px-1.5 font-semibold text-slate-700">
            {{ currentPage }} / {{ totalPages }}
          </span>
          <button
            type="button"
            :disabled="currentPage >= totalPages || loadingProducts"
            @click="goToPage(currentPage + 1)"
            class="h-7 px-2.5 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 text-slate-700 font-semibold cursor-pointer transition"
          >
            Következő
          </button>
        </div>
      </div>
    </div>

    <!-- 2. JOBB OLDALI KÁRTYA: A kiválasztott termék szellős adatlapja -->
    <div
      v-if="selectedProduct"
      class="lg:col-span-8 bg-white rounded-3xl border border-white shadow-sm p-6 sm:p-8 space-y-6"
    >
      <!-- Felső fejléc: Terméknév + Státusz + Szerkesztés / Törlés gombok -->
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div class="flex items-center gap-3">
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
              {{ selectedProduct.manufacturerCode }}
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
          <span class="text-sm font-semibold text-slate-800">{{ selectedProduct.model }}</span>
        </div>
        <div>
          <span class="text-xs text-slate-400 block">Nem</span>
          <span class="text-sm font-semibold text-slate-800">{{ selectedProduct.gender }}</span>
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
        <div>
          <span class="text-xs text-slate-400 block">Funkcionalitás / Jellemzők</span>
          <span class="text-sm font-semibold text-slate-800">
            {{ selectedProduct.functionality || '—' }}
          </span>
        </div>
      </div>

      <!-- FÜL 2: VARIÁNSOK & ÁRAK -->
      <div v-else-if="activeDetailTab === 'variants'" class="space-y-3">
        <div v-if="canManageCatalog" class="flex justify-end">
          <button
            type="button"
            @click="openCreateVariant"
            class="text-xs font-semibold text-orange-600 hover:text-orange-700 flex items-center gap-1 cursor-pointer"
          >
            <i class="pi pi-plus text-[10px]"></i>
            <span>Új variáns hozzáadása</span>
          </button>
        </div>

        <div v-if="loadingVariants" class="py-8 text-center text-xs text-slate-400">
          <i class="pi pi-spin pi-spinner mr-1.5"></i> Variánsok betöltése...
        </div>

        <div
          v-else-if="variants.length === 0"
          class="py-8 text-center bg-slate-50/60 rounded-2xl border border-dashed border-slate-200 text-xs text-slate-400"
        >
          Ehhez a termékhez még nem tartozik variáns.
        </div>

        <div v-else class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr
                class="text-[11px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100"
              >
                <th class="pb-3 pr-3">Méret</th>
                <th class="pb-3 pr-3">Cikkszám (SKU)</th>
                <th class="pb-3 pr-3">Színek</th>
                <th class="pb-3 pr-3 text-right">Súly</th>
                <th v-if="canSeeCostPrice" class="pb-3 pr-3 text-right">Beszerzési ár</th>
                <th class="pb-3 pr-3 text-right">Eladási ár</th>
                <th class="pb-3 pr-3">Vonalkódok</th>
                <th class="pb-3 pr-3 text-right">Szabad készlet</th>
                <th class="pb-3 pr-3 text-center">Állapot</th>
                <th v-if="canManageCatalog || canAdjustStock" class="pb-3 text-right">
                  Műveletek
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 text-sm">
              <tr v-for="v in variants" :key="v.id" class="hover:bg-slate-50/70 transition">
                <td class="py-3.5 pr-3 font-bold text-slate-900">{{ v.size }}</td>
                <td class="py-3.5 pr-3 font-mono text-xs text-slate-600">{{ v.sku }}</td>
                <td class="py-3.5 pr-3 text-slate-700">
                  <div class="flex items-center gap-2.5">
                    <button
                      v-if="getVariantThumbnail(v)"
                      type="button"
                      @click="selectedHeroImage = getVariantThumbnail(v)"
                      :title="`Kép megtekintése: ${v.colors.join(', ') || v.sku}`"
                      class="shrink-0 cursor-pointer rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/40"
                    >
                      <img
                        :src="getVariantThumbnail(v)!"
                        :alt="v.colors.join(', ') || v.sku"
                        class="w-9 h-9 rounded-lg aspect-square object-contain bg-white border border-slate-200 hover:border-orange-400 transition"
                      />
                    </button>
                    <span>{{ v.colors.join(', ') }}</span>
                  </div>
                </td>
                <td class="py-3.5 pr-3 text-right text-slate-500 text-xs">
                  {{ formatWeight(v.weight) }}
                </td>
                <td
                  v-if="canSeeCostPrice"
                  class="py-3.5 pr-3 text-right text-slate-500 whitespace-nowrap"
                >
                  {{ formatPrice(v.costPrice) }}
                </td>
                <td class="py-3.5 pr-3 text-right font-bold text-slate-900 whitespace-nowrap">
                  {{ formatPrice(v.price) }}
                </td>
                <td class="py-3.5 pr-3">
                  <button
                    type="button"
                    @click="openBarcodesModal(v)"
                    class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-orange-50 text-xs font-semibold text-slate-700 hover:text-orange-700 cursor-pointer transition"
                    title="Vonalkódok kezelése"
                  >
                    <i class="pi pi-barcode text-xs"></i>
                    <span v-if="getPrimaryBarcode(v)" class="font-mono">
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
                <td class="py-3.5 pr-3 text-right whitespace-nowrap">
                  <span
                    class="inline-flex items-center text-[11px] font-bold px-2.5 py-0.5 rounded-full"
                    :class="
                      getVariantFreeStock(v.id) > 0
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-slate-100 text-slate-500'
                    "
                  >
                    {{ getVariantFreeStock(v.id) }} db szabad
                  </span>
                </td>
                <td class="py-3.5 pr-3 text-center">
                  <span
                    class="inline-block text-[11px] font-bold px-2 py-0.5 rounded-full"
                    :class="
                      v.isActive
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-slate-100 text-slate-500'
                    "
                  >
                    {{ v.isActive ? 'Aktív' : 'Inaktív' }}
                  </span>
                </td>
                <td
                  v-if="canManageCatalog || canAdjustStock"
                  class="py-3.5 text-right whitespace-nowrap"
                >
                  <div class="inline-flex items-center gap-1">
                    <button
                      v-if="canAdjustStock"
                      type="button"
                      @click="openStockAdjustModal(null, v.id)"
                      class="w-7 h-7 rounded-lg border border-slate-200 hover:bg-emerald-50 hover:border-emerald-200 text-slate-600 hover:text-emerald-700 flex items-center justify-center cursor-pointer transition"
                      title="Gyors készletfelvitel / korrekció"
                    >
                      <i class="pi pi-box text-[11px]"></i>
                    </button>
                    <template v-if="canManageCatalog">
                      <button
                        type="button"
                        @click="openCloneVariant(v)"
                        class="w-7 h-7 rounded-lg border border-slate-200 hover:bg-orange-50 hover:border-orange-200 text-slate-600 hover:text-orange-600 flex items-center justify-center cursor-pointer transition"
                        title="Klónozás / Új méretsor ebből"
                      >
                        <i class="pi pi-copy text-[11px]"></i>
                      </button>
                      <button
                        type="button"
                        @click="openEditVariant(v)"
                        class="w-7 h-7 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 flex items-center justify-center cursor-pointer transition"
                        title="Variáns szerkesztése"
                      >
                        <i class="pi pi-pencil text-[11px]"></i>
                      </button>
                      <button
                        type="button"
                        @click="promptDeleteVariant(v)"
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

      <!-- FÜL 3: KÉSZLET & MOZGÁSOK -->
      <div v-else class="space-y-6">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <p class="text-xs text-slate-500">
            A termék aktuális készlete tárhelyek szerint és az utolsó 15 készletmozgás.
          </p>
          <button
            v-if="canAdjustStock"
            type="button"
            @click="openStockAdjustModal(null, null)"
            class="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition shadow-sm"
          >
            <i class="pi pi-plus text-[11px]"></i>
            <span>Készlet felvitele / korrekció</span>
          </button>
        </div>

        <div
          v-if="loadingStock && stockItems.length === 0 && stockMovements.length === 0"
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
                v-if="canAdjustStock"
                type="button"
                @click="openStockAdjustModal(null, null)"
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
                    <th v-if="canAdjustStock" class="pb-3 text-right">Művelet</th>
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
                      <span class="font-bold text-slate-900">{{ item.variant.size }}</span>
                      <span class="text-slate-400 mx-1">·</span>
                      <span>{{ item.variant.colors.join(', ') }}</span>
                      <span class="text-slate-400 mx-1">·</span>
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
                    <td v-if="canAdjustStock" class="py-3 text-right whitespace-nowrap">
                      <div v-if="!item.isExternalLocation" class="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          @click="openStockAdjustModal(item.locationId, item.variantId)"
                          class="px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-100 text-[11px] font-semibold text-slate-700 cursor-pointer transition"
                        >
                          Áthelyezés / Korrekció
                        </button>
                        <button
                          type="button"
                          @click="openStockReportModal(item.locationId, item.variantId, item.quantity)"
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
                Utolsó {{ stockMovements.length }} mozgás
              </span>
            </div>

            <div
              v-if="stockMovements.length === 0"
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
                    v-for="m in stockMovements"
                    :key="m.id"
                    class="hover:bg-slate-50/70 transition"
                  >
                    <td class="py-3 pr-3 text-slate-500 whitespace-nowrap">
                      {{ formatMovementDate(m.createdAt) }}
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
                      <span class="text-slate-400 ml-1">({{ m.variant.size }})</span>
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
    <Dialog
      v-model:visible="isDeleteProductOpen"
      modal
      header="Termék törlése"
      :style="{ width: '26rem', maxWidth: '95vw' }"
    >
      <div v-if="selectedProduct" class="space-y-4 pt-1">
        <p class="text-sm text-slate-600">
          Biztosan törölni szeretnéd a(z)
          <strong class="text-slate-900">„{{ selectedProduct.name }}”</strong> terméket?
        </p>
        <p class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
          Csak olyan termék törölhető, amelyhez már nem tartoznak variánsok.
        </p>
        <div class="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button
            type="button"
            @click="isDeleteProductOpen = false"
            class="h-9 px-4 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            Mégse
          </button>
          <button
            type="button"
            :disabled="deletingProduct"
            @click="confirmDeleteProduct"
            class="h-9 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-xs font-semibold text-white flex items-center gap-1.5 cursor-pointer"
          >
            <i v-if="deletingProduct" class="pi pi-spin pi-spinner text-xs"></i>
            <span>Törlés</span>
          </button>
        </div>
      </div>
    </Dialog>

    <!-- Variáns Létrehozó / Szerkesztő Modal -->
    <VariantFormModal
      v-if="selectedProduct"
      v-model:visible="isVariantModalOpen"
      :mode="variantModalMode"
      :product-id="selectedProduct.id"
      :product-name="selectedProduct.name"
      :manufacturerCode="selectedProduct.manufacturerCode"
      :existingSkus="variants.map((v) => v.sku)"
      :editing-variant="editingVariant"
      :templateVariant="cloningVariant"
      @saved="onVariantSaved"
    />

    <!-- Variáns Törlés Megerősítő Dialog -->
    <Dialog
      v-model:visible="isDeleteVariantOpen"
      modal
      header="Variáns törlése"
      :style="{ width: '26rem', maxWidth: '95vw' }"
    >
      <div v-if="variantToDelete" class="space-y-4 pt-1">
        <p class="text-sm text-slate-600">
          Biztosan törölni szeretnéd a(z)
          <strong class="font-mono text-slate-900">{{ variantToDelete.sku }}</strong> ({{
            variantToDelete.size
          }}) variánst?
        </p>
        <div class="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button
            type="button"
            @click="isDeleteVariantOpen = false"
            class="h-9 px-4 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            Mégse
          </button>
          <button
            type="button"
            :disabled="deletingVariant"
            @click="confirmDeleteVariant"
            class="h-9 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-xs font-semibold text-white flex items-center gap-1.5 cursor-pointer"
          >
            <i v-if="deletingVariant" class="pi pi-spin pi-spinner text-xs"></i>
            <span>Variáns törlése</span>
          </button>
        </div>
      </div>
    </Dialog>

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
