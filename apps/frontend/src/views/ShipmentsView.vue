<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter, type LocationQueryRaw } from 'vue-router'
import GoodsReceiptsTab from '@/components/procurement/GoodsReceiptsTab.vue'
import PickingBoardTab from '@/components/orders/PickingBoardTab.vue'

type ShipmentsTab = 'receiving' | 'picking'

const route = useRoute()
const router = useRouter()

const initialReceiptId = computed(() => {
  const raw = route.query.receiptId
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null
})

const activeTab = computed<ShipmentsTab>(() => {
  if (initialReceiptId.value) {
    return 'receiving'
  }
  return route.query.tab === 'picking' ? 'picking' : 'receiving'
})

const tabs: Array<{ id: ShipmentsTab; label: string; icon: string }> = [
  { id: 'receiving', label: 'Bevételezések', icon: 'pi pi-inbox' },
  { id: 'picking', label: 'Kiszállítás & Kiszedés', icon: 'pi pi-truck' },
]

function selectTab(tab: ShipmentsTab) {
  if (activeTab.value === tab && route.query.tab === tab) return
  const nextQuery: LocationQueryRaw = { ...route.query, tab }
  if (tab === 'picking') {
    delete nextQuery.receiptId
  }
  void router.replace({ query: nextQuery })
}
</script>

<template>
  <div class="space-y-5">
    <!-- FELSŐ AL-NAVIGÁCIÓ (Kapszula váltó) -->
    <div class="flex items-center justify-between">
      <div
        class="inline-flex items-center bg-white border border-white rounded-2xl p-1 shadow-sm gap-1"
      >
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          @click="selectTab(tab.id)"
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

    <GoodsReceiptsTab
      v-if="activeTab === 'receiving'"
      :initial-receipt-id="initialReceiptId"
    />
    <PickingBoardTab v-else />
  </div>
</template>
