<script setup lang="ts">
import { useSearchStore } from '@/stores/search';
import { onMounted, onUnmounted } from 'vue';


const searchStore = useSearchStore()

function handleKeydown(e: KeyboardEvent) {
    if((e.ctrlKey || e.metaKey) && e.key === 'k'){
        e.preventDefault()

        if(searchStore.isSearchOpen){
            searchStore.closeSearch()
        }else{
            searchStore.openSearch()
        }
    }
}

onMounted(() => {
    window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
    window.removeEventListener('keydown', handleKeydown)
})
</script>


<template>
    <Drawer 
      v-model:visible="searchStore.isSearchOpen" 
      position="right" 
      class="w-full md:w-[400px]"
      header="Gyors Termékkereső"
    >
      <div class="flex flex-col gap-4 mt-2">
        <span class="p-input-icon-left w-full">
          <i class="pi pi-search" />
          <InputText 
            placeholder="Cikkszám, név vagy vonalkód..." 
            class="w-full" 
            autofocus
          />
        </span>
        
        <!-- Ide jön majd az API hívás eredménye (Kártyák vagy Lista) -->
        <div class="flex-1 overflow-y-auto border-t pt-4">
          <p class="text-sm text-slate-500 text-center">
            Kezdj el gépelni, vagy csippants le egy vonalkódot a termékadatok megjelenítéséhez!
          </p>
          <!-- Példa találat helyőrző -->
          <div class="mt-4 p-3 border rounded-lg hover:bg-slate-50 cursor-pointer">
            <p class="font-bold">Shox Kesztyű (Fekete, L)</p>
            <p class="text-sm text-slate-500">Cikkszám: SHX-GL-BL-L</p>
            <div class="flex justify-between mt-2 text-sm">
              <span>Raktáron: <b class="text-emerald-600">12 db</b></span>
              <span>Polc: <b>A-12</b></span>
            </div>
          </div>
        </div>
      </div>
    </Drawer>
  </template>