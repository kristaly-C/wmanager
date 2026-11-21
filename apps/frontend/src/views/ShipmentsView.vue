<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import GoodsReceiptsTab from '@/components/procurement/GoodsReceiptsTab.vue'

const route = useRoute()

const initialReceiptId = computed(() => {
  const raw = route.query.receiptId
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null
})
</script>

<template>
  <div class="space-y-5">
    <!-- FELSŐ AL-NAVIGÁCIÓ (Kapszula váltó) -->
    <div class="flex items-center justify-between">
      <div
        class="inline-flex items-center bg-white border border-white rounded-2xl p-1 shadow-sm gap-1"
      >
        <button
          type="button"
          class="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-slate-900 text-white shadow-sm transition-all cursor-pointer"
        >
          <i class="pi pi-inbox text-xs"></i>
          <span>Bevételezések</span>
        </button>

        <button
          type="button"
          disabled
          class="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-slate-400 cursor-not-allowed opacity-75"
          title="Kiszállítás és komissiózás hamarosan elérhető"
        >
          <i class="pi pi-truck text-xs"></i>
          <span>Kiszállítás (hamarosan)</span>
        </button>
      </div>
    </div>

    <GoodsReceiptsTab :initial-receipt-id="initialReceiptId" />
  </div>
</template>
