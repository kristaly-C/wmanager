import { computed, ref } from 'vue'
import { CHANGELOG_ENTRIES } from '@/data/changelog'

const STORAGE_KEY = 'xstorage_last_seen_changelog_id'

function readInitialLastSeen(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

const lastSeenId = ref<string | null>(readInitialLastSeen())

export function useChangelog() {
  const entries = CHANGELOG_ENTRIES
  const latestId = entries[0]?.id ?? null

  const unreadIds = computed<Set<string>>(() => {
    if (entries.length === 0) {
      return new Set()
    }

    if (!lastSeenId.value) {
      return new Set([entries[0]!.id])
    }

    const idx = entries.findIndex((entry) => entry.id === lastSeenId.value)
    if (idx === -1) {
      return new Set([entries[0]!.id])
    }
    if (idx === 0) {
      return new Set()
    }

    return new Set(entries.slice(0, idx).map((entry) => entry.id))
  })

  const unreadCount = computed(() => unreadIds.value.size)
  const hasUnread = computed(() => unreadCount.value > 0)

  function markAllAsRead() {
    if (!latestId) return
    lastSeenId.value = latestId
    try {
      localStorage.setItem(STORAGE_KEY, latestId)
    } catch {
      /* ignore */
    }
  }

  return {
    entries,
    latestId,
    unreadIds,
    unreadCount,
    hasUnread,
    markAllAsRead,
  }
}
