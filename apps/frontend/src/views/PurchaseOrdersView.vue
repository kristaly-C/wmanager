<script setup lang="ts">
import { ref } from 'vue'
import type { PurchaseOrderDetail } from '@/api/purchaseOrders'
import PurchaseOrdersTab from '@/components/procurement/PurchaseOrdersTab.vue'
import GoodsReceiptsTab from '@/components/procurement/GoodsReceiptsTab.vue'

type ProcurementTab = 'orders' | 'receipts'

const activeTab = ref<ProcurementTab>('orders')
const selectedReceiptIdForTab = ref<string | null>(null)
const poForNewReceipt = ref<PurchaseOrderDetail | null>(null)

const tabs: Array<{ id: ProcurementTab; label: string; icon: string }> = [
  { id: 'orders', label: 'Beszerzési rendelések', icon: 'pi pi-shopping-cart' },
  { id: 'receipts', label: 'Bevételezések', icon: 'pi pi-inbox' },
]

function onCreateReceiptFromPo(po: PurchaseOrderDetail) {
  poForNewReceipt.value = po
  activeTab.value = 'receipts'
}

function onOpenReceipt(receiptId: string) {
  selectedReceiptIdForTab.value = receiptId
  activeTab.value = 'receipts'
}
</script>

<template>
  <div class="space-y-5">
    <!-- FELSŐ AL-NAVIGÁCIÓ (Kapszula váltó a beszerzés és bevételezés között) -->
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
    <PurchaseOrdersTab
      v-if="activeTab === 'orders'"
      @create-receipt-from-po="onCreateReceiptFromPo"
      @open-receipt="onOpenReceipt"
    />
    <GoodsReceiptsTab
      v-else-if="activeTab === 'receipts'"
      :initial-receipt-id="selectedReceiptIdForTab"
      :preselected-po-for-create="poForNewReceipt"
      @clear-preselected-po="poForNewReceipt = null"
    />
  </div>
</template>
