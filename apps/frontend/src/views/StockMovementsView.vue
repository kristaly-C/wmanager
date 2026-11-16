<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { locationApi, type LocationItem } from '@/api/locations'
import StockMovementsTab from '@/components/inventory/StockMovementsTab.vue'
import { extractApiError } from '@/utils/locationMeta'
import { useToast } from 'primevue/usetoast'

const toast = useToast()
const locations = ref<LocationItem[]>([])

async function loadLocations() {
  try {
    const res = await locationApi.getAll()
    locations.value = res.data
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Betöltési hiba',
      detail: extractApiError(err, 'Nem sikerült betölteni a pozíciókat.'),
      life: 5000,
    })
  }
}

onMounted(() => {
  void loadLocations()
})
</script>

<template>
  <div class="space-y-6 text-[#171918]">
    <div>
      <h1 class="text-[30px] font-semibold tracking-[-0.42px] text-[#171918] leading-tight">
        Készletmozgási és Audit Napló
      </h1>
      <p class="text-[14px] text-[#686f6a] mt-1 tracking-[-0.196px]">
        Minden készletváltozás visszakövethető eseménynaplója raktárak, üzletek és felhasználók szerint.
      </p>
    </div>

    <StockMovementsTab :allLocations="locations" />
  </div>
</template>
