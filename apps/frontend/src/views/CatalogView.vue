<script setup lang="ts">
import { ref } from 'vue'
import ProductsTab from '@/components/catalog/ProductsTab.vue'
import CategoriesView from '@/views/CategoriesView.vue' // Ideiglenesen, amíg át nem alakítjuk!

type CatalogTab = 'products' | 'categories' | 'brands' | 'suppliers'

const activeTab = ref<CatalogTab>('products')

const tabs: { id: CatalogTab; label: string; icon: string }[] = [
  { id: 'products', label: 'Termékek', icon: 'pi pi-box' },
  { id: 'categories', label: 'Kategóriák', icon: 'pi pi-sitemap' },
  { id: 'brands', label: 'Márkák', icon: 'pi pi-verified' },
  { id: 'suppliers', label: 'Beszállítók', icon: 'pi pi-building' },
]
</script>

<template>
  <div class="space-y-5">
    <!-- FELSŐ AL-NAVIGÁCIÓ (Kapszula váltó a 4 törzsadat között, mint a koncepcióképen) -->
    <div class="flex items-center justify-between">
      <div class="inline-flex items-center bg-white border border-white rounded-2xl p-1 shadow-sm gap-1">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          @click="activeTab = tab.id"
          class="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all cursor-pointer"
          :class="
            activeTab === tab.id
              ? 'bg-slate-900 text-white shadow-sm'
              : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
          "
        >
          <i :class="[tab.icon, 'text-xs']"></i>
          <span>{{ tab.label }}</span>
        </button>
      </div>
    </div>

    <!-- AKTÍV FÜL TARTALMA -->
    <ProductsTab v-if="activeTab === 'products'" />
    <CategoriesView v-else-if="activeTab === 'categories'" />
    <div v-else class="bg-white rounded-3xl p-12 text-center text-slate-400 border border-white shadow-sm">
      Ez a fül ({{ activeTab }}) hamarosan elkészül!
    </div>
  </div>
</template>