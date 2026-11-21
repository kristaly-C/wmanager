<script setup lang="ts">
defineProps<{
  label: string
  value: string | number
  subtext?: string
  subtextClass?: string
  icon: string
  iconClass?: string
}>()
</script>

<template>
  <div class="bg-[#f6f7f5] border border-white rounded-[19px] h-[110px] p-4 flex items-start gap-4 shadow-2xs">
    <div class="bg-white rounded-[14px] size-[50px] flex items-center justify-center shrink-0 mt-0.5 shadow-2xs">
      <i :class="[icon, 'text-[20px]', iconClass || 'text-[#171918]']"></i>
    </div>
    <div class="min-w-0">
      <p class="text-[12px] text-[#686f6a] tracking-[-0.168px] truncate">{{ label }}</p>
      <p class="text-[30px] font-semibold text-[#171918] leading-tight tracking-[-0.42px]">{{ value }}</p>
      <p v-if="subtext" :class="['text-[11px] font-medium mt-0.5 truncate', subtextClass || 'text-[#686f6a]']">{{ subtext }}</p>
    </div>
  </div>
</template>
