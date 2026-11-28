<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import { useChangelog } from '@/composables/useChangelog'
import type { ChangelogCategory } from '@/data/changelog'

const visible = defineModel<boolean>('visible', { default: false })

const { entries, unreadIds, markAllAsRead } = useChangelog()

type FilterOption = 'all' | ChangelogCategory

const activeCategory = ref<FilterOption>('all')
const highlightedIds = ref<Set<string>>(new Set())

const CATEGORY_META: Record<
  ChangelogCategory,
  { label: string; badgeClass: string }
> = {
  feature: {
    label: 'Új funkció',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  improvement: {
    label: 'Fejlesztés',
    badgeClass: 'bg-sky-50 text-sky-700 border-sky-200',
  },
  fix: {
    label: 'Javítás',
    badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
  },
}

const filterOptions = computed(() => [
  { key: 'all' as const, label: 'Összes', count: entries.length },
  {
    key: 'feature' as const,
    label: CATEGORY_META.feature.label,
    count: entries.filter((entry) => entry.category === 'feature').length,
  },
  {
    key: 'improvement' as const,
    label: CATEGORY_META.improvement.label,
    count: entries.filter((entry) => entry.category === 'improvement').length,
  },
  {
    key: 'fix' as const,
    label: CATEGORY_META.fix.label,
    count: entries.filter((entry) => entry.category === 'fix').length,
  },
])

const filteredEntries = computed(() => {
  if (activeCategory.value === 'all') {
    return entries
  }
  return entries.filter((entry) => entry.category === activeCategory.value)
})

function formatDate(iso: string): string {
  return `${iso.replace(/-/g, '. ')}.`
}

watch(visible, (isOpen) => {
  if (isOpen) {
    activeCategory.value = 'all'
    highlightedIds.value = new Set(unreadIds.value)
    markAllAsRead()
  }
})
</script>

<template>
  <Dialog
    v-model:visible="visible"
    modal
    dismissableMask
    :style="{ width: '42rem', maxWidth: '94vw' }"
  >
    <template #header>
      <div class="flex items-center gap-3">
        <div
          class="w-10 h-10 rounded-2xl bg-orange-50 border border-orange-200 text-orange-500 flex items-center justify-center shrink-0"
        >
          <i class="pi pi-sparkles text-lg"></i>
        </div>
        <div>
          <h2 class="text-base font-bold text-slate-900 leading-tight">
            Újdonságok és frissítések
          </h2>
          <p class="text-xs text-slate-500 mt-0.5">
            Az elvégzett fejlesztések és javítások összefoglalója
          </p>
        </div>
      </div>
    </template>

    <div class="flex flex-col gap-4">
      <!-- Kategória szűrő kapszulák -->
      <div class="flex flex-wrap items-center gap-2">
        <button
          v-for="option in filterOptions"
          :key="option.key"
          type="button"
          @click="activeCategory = option.key"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors cursor-pointer"
          :class="
            activeCategory === option.key
              ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:text-slate-900'
          "
        >
          <span>{{ option.label }}</span>
          <span
            class="px-1.5 py-0.5 rounded-full text-[10px] font-bold"
            :class="
              activeCategory === option.key
                ? 'bg-white/20 text-white'
                : 'bg-slate-100 text-slate-600'
            "
          >
            {{ option.count }}
          </span>
        </button>
      </div>

      <!-- Görgethető frissítési kártyák -->
      <div
        v-if="filteredEntries.length > 0"
        class="max-h-[62vh] overflow-y-auto pr-1 flex flex-col gap-3"
      >
        <article
          v-for="entry in filteredEntries"
          :key="entry.id"
          class="rounded-2xl border p-4 transition-colors"
          :class="
            highlightedIds.has(entry.id)
              ? 'border-orange-200 bg-orange-50/40'
              : 'border-slate-200/80 bg-white'
          "
        >
          <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
            <div class="flex flex-wrap items-center gap-1.5">
              <span
                class="inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-bold border"
                :class="CATEGORY_META[entry.category].badgeClass"
              >
                {{ CATEGORY_META[entry.category].label }}
              </span>
              <span
                class="inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-semibold bg-slate-100 text-slate-600 border border-slate-200/70"
              >
                {{ entry.milestone }}
              </span>
              <span
                v-if="highlightedIds.has(entry.id)"
                class="inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-extrabold uppercase tracking-wider bg-orange-500 text-white"
              >
                ÚJ
              </span>
            </div>
            <time
              :datetime="entry.date"
              class="text-xs font-medium text-slate-400"
            >
              {{ formatDate(entry.date) }}
            </time>
          </div>

          <h3 class="text-sm font-bold text-slate-900">
            {{ entry.title }}
          </h3>
          <p class="text-xs text-slate-600 mt-1 leading-relaxed">
            {{ entry.summary }}
          </p>

          <ul v-if="entry.items.length > 0" class="mt-3 flex flex-col gap-1.5">
            <li
              v-for="(item, index) in entry.items"
              :key="index"
              class="flex items-start gap-2 text-xs text-slate-700 leading-relaxed"
            >
              <i
                class="pi pi-check-circle text-emerald-500 text-xs mt-0.5 shrink-0"
              ></i>
              <span>{{ item }}</span>
            </li>
          </ul>
        </article>
      </div>

      <div
        v-else
        class="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-8 text-center text-xs text-slate-500"
      >
        Ebben a kategóriában még nincs bejegyzés.
      </div>
    </div>

    <template #footer>
      <div class="w-full flex items-center justify-between gap-3">
        <span class="text-xs text-slate-400">
          Megjelenítve: {{ filteredEntries.length }} / {{ entries.length }} bejegyzés
        </span>
        <Button
          label="Bezárás"
          severity="secondary"
          outlined
          size="small"
          @click="visible = false"
        />
      </div>
    </template>
  </Dialog>
</template>
