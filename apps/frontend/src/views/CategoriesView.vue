<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { categoryApi, type Category } from '@/api/categories'
import PageHeader from '@/components/common/PageHeader.vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'

const categories = ref<Category[]>([])
const loading = ref(false)

async function loadCategories() {
  loading.value = true
  try {
    const response = await categoryApi.getAll()
    categories.value = response.data
  } catch (error) {
    console.error('Hiba a kategóriák lekérésekor:', error)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadCategories()
})
</script>

<template>
  <div class="max-w-7xl mx-auto space-y-6">
    <PageHeader title="Kategóriák" subtitle="Termékkategóriák kezelése">
      <template #actions>
        <!-- A gomb színét a modern sötétkék/fekete stílusra állítjuk -->
        <Button label="Új Kategória" icon="pi pi-plus" class="bg-slate-900 border-none hover:bg-slate-800 text-white" />
      </template>
    </PageHeader>

    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <!-- PrimeVue Táblázat -->
      <DataTable 
        :value="categories" 
        :loading="loading" 
        stripedRows 
        paginator 
        :rows="10"
        dataKey="id"
        class="p-4"
      >
        <template #empty>
          <div class="text-center py-8 text-slate-500">Nincsenek még kategóriák rögzítve.</div>
        </template>
        
        <Column field="name" header="Kategória Név" sortable class="font-medium text-slate-900"></Column>
        <Column field="description" header="Leírás" class="text-slate-500"></Column>
        <Column header="Műveletek" :exportable="false" style="width: 120px">
          <template #body="{ data }">
            <div class="flex gap-2">
              <Button icon="pi pi-pencil" text rounded severity="secondary" size="small" />
              <Button icon="pi pi-trash" text rounded severity="danger" size="small" />
            </div>
          </template>
        </Column>
      </DataTable>
    </div>
  </div>
</template>