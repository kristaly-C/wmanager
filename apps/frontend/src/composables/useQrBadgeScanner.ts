import { onUnmounted } from "vue"



const QR_REGEX = /(WM-AUTH-[A-Za-z0-9_-]+)$/
const MAX_KEY_INTERVAL_MS = 80


export function useQrBadgeScanner(onBadgeScanned: (qrToken: string, isBusy: boolean) => void) {
    let buffer= ''
    let lastKeyTime = 0
    let lastHumanActivityTime = 0


    function checkIsUserBusy(): boolean {
        const hasOpenOverlay = !!document.querySelector('.p-dialog, .p-drawer')
        if(hasOpenOverlay) return true

        const recentlyActive = Date.now() - lastHumanActivityTime  < 15_000
        return recentlyActive
    }

    function handleMouseActivity() {
        lastHumanActivityTime = Date.now()
    }

    function handleKeyDown(e: KeyboardEvent) {
        const now = Date.now()
        const timeDiff = now - lastKeyTime

        if( timeDiff > MAX_KEY_INTERVAL_MS) {
            buffer = ''

            if(e.key.length === 1) {
                lastHumanActivityTime = now
            }
        }

        lastKeyTime = now

        if(e.key === 'Enter') {
            const match = buffer.match(QR_REGEX)
            buffer = ''

            if(match && match[1]) {
                e.preventDefault()
                e.stopImmediatePropagation()

                const activeEl = document.activeElement as HTMLInputElement | null
                if(activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
                    activeEl.value = activeEl.value.replace(QR_REGEX,'')
                    activeEl.dispatchEvent(new Event('input', {bubbles: true}))
                }

                const isBusy = checkIsUserBusy()
                onBadgeScanned(match[1], isBusy)
            }
            return
        }

        if(e.key.length === 1) {
            buffer += e.key
        }
    }


        window.addEventListener('keydown', handleKeyDown, true)
        window.addEventListener('mousedown', handleMouseActivity, true)
    

    onUnmounted(() => {
        window.removeEventListener('keydown', handleKeyDown, true)
        window.removeEventListener('mousedown', handleMouseActivity, true)
    })
    

}