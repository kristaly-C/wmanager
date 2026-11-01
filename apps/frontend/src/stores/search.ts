import { defineStore } from "pinia";
import { ref } from "vue";


export interface QuickProductInfo {
    id: string
    productId: string
    name: string
    variantLabel: string
    sku: string
    barcode: string
    price: number
    freeStock: number
    shelf: string   
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

    function closeProductionSheet() {
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
        closeProductionSheet,
    }
})