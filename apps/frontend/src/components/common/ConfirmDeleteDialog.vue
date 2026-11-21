<script setup lang="ts">
import Dialog from 'primevue/dialog'

defineProps<{
  visible: boolean
  header: string
  itemName?: string
  message?: string
  warningNote?: string
  confirmLabel?: string
  loading?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:visible', val: boolean): void
  (e: 'confirm'): void
}>()
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :header="header"
    :style="{ width: '26rem', maxWidth: '95vw' }"
    @update:visible="emit('update:visible', $event)"
  >
    <div class="space-y-3 py-1">
      <slot>
        <p class="text-sm text-[#686f6a]">
          <template v-if="message">{{ message }}</template>
          <template v-else>
            Biztosan törlöd a(z)
            <strong class="text-[#171918]">{{ itemName }}</strong>
            elemet?
          </template>
        </p>
      </slot>

      <p
        v-if="warningNote"
        class="text-xs text-[#686f6a] bg-[#f6f7f5] rounded-[10px] p-3 border border-[#e8eae6]"
      >
        {{ warningNote }}
      </p>

      <div class="flex justify-end gap-2 pt-2">
        <button
          type="button"
          @click="emit('update:visible', false)"
          class="h-[36px] px-4 rounded-[10px] bg-white border border-[#dce0d8] text-xs font-medium text-[#171918] cursor-pointer"
        >
          Mégse
        </button>
        <button
          type="button"
          :disabled="loading"
          @click="emit('confirm')"
          class="h-[36px] px-4 rounded-[10px] bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
        >
          <i v-if="loading" class="pi pi-spin pi-spinner text-xs"></i>
          <span>{{ confirmLabel || 'Törlés' }}</span>
        </button>
      </div>
    </div>
  </Dialog>
</template>
