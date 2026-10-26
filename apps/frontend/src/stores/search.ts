import { defineStore } from "pinia";
import { ref } from "vue";



export const useSearchStore = defineStore('search', () => {
    const isSearchOpen = ref(false)

    function openSearch() {
        isSearchOpen.value = true
    }

    function closeSearch() {
        isSearchOpen.value = false
    }

    return {isSearchOpen, openSearch, closeSearch}
})