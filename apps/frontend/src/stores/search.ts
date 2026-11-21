import { defineStore } from "pinia";
import { ref } from "vue";


export interface QuickStockBreakdown {
    locationId: string
    locationName: string
    totalQty: number
    reservedQty: number
    freeQty: number
}

export interface QuickProductInfo {
    id: string
    productId: string
    name: string
    variantLabel: string
    size?: string | null
    colors?: string[]
    sku: string
    barcode: string
    grossPrice: number
    netPrice: number
    freeStock: number
    shelf: string
    imageUrl?: string | null
    brandName?: string
    categoryName?: string
    supplierName?: string
    manufacturerCode?: string | null
    model?: string | null
    material?: string | null
    description?: string | null
    stockBreakdown?: QuickStockBreakdown[]
}


export const useSearchStore = defineStore('search', () => {
    const isSearchOpen = ref(false)

    const highlightedProduct = ref<QuickProductInfo | null>(null)

    const isProductSheetOpen = ref(false)
    const activeProductSheet = ref<QuickProductInfo | null>(null)


    function openSearch() {
        isSearchOpen.value = true
    }

    function closeSearch() {
        isSearchOpen.value = false
    }

    function setHighlightedProduct(product: QuickProductInfo | null) {
        highlightedProduct.value = product
      }

    function openProductSheet(product?: QuickProductInfo | null) {
        const target = product ?? highlightedProduct.value
        if(!target) return

        activeProductSheet.value = target
        isProductSheetOpen.value = true
    }

    function closeProductSheet() {
        isProductSheetOpen.value = false
    }

    return {
        isSearchOpen,
        highlightedProduct,
        isProductSheetOpen,
        activeProductSheet, 
        openSearch, 
        closeSearch,
        setHighlightedProduct,
        openProductSheet,
        closeProductSheet,
    }
})