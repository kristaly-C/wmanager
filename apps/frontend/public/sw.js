// Minimális Service Worker a PWA telepíthetőséghez (élő hálózati kérések megőrzésével)
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', () => {
  // Szándékosan nem interceptáljuk a kéréseket, hogy a készletadatok és frissítések mindig élők maradjanak.
})
