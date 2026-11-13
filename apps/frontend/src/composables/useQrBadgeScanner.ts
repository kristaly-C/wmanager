import { onUnmounted } from "vue"



const QR_EXACT_REGEX = /(WM[-ü/Ö]AUTH[-ü/Ö][a-fA-F0-9]{32})/i
const MAX_KEY_INTERVAL_MS = 300


export function useQrBadgeScanner(onBadgeScanned: (qrToken: string, isBusy: boolean) => void) {
    let buffer= ''
    let lastKeyTime = 0
    let lastHumanActivityTime = 0
    let lastTriggeredAt = 0


    function checkIsUserBusy(): boolean {
        const hasOpenOverlay = !!document.querySelector('.p-dialog, .p-drawer')
        if(hasOpenOverlay) return true

        return Date.now() - lastHumanActivityTime  < 15_000
    }


    function normalizeToken(raw: string): string {
        return raw.replace(/^WM[-ü/Ö]AUTH[-ü/Ö]/i, 'WM-AUTH-').toLowerCase().replace(/^wm-auth-/, 'WM-AUTH-')
    }

    function triggerScan(rawToken: string, activeEl?: HTMLInputElement | null) {
        const now = Date.now()

        if(now - lastTriggeredAt < 500) return
        lastTriggeredAt = now
        buffer = ''


        if(activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')){
            activeEl.value = activeEl.value.replace(QR_EXACT_REGEX, '')
            activeEl.dispatchEvent(new Event('input', { bubbles: true}))
        }

        const isBusy = checkIsUserBusy()
        onBadgeScanned(normalizeToken(rawToken), isBusy)
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
            if( now - lastTriggeredAt < 500) {
                e.preventDefault()
                e.stopImmediatePropagation()
                return
            }

            const match = buffer.match(QR_EXACT_REGEX)
            buffer = ''

            if(match && match[1]) {
                e.preventDefault()
                e.stopImmediatePropagation()
                triggerScan(match[1], document.activeElement as HTMLInputElement | null)
            }
            return 
        }

        if(e.key.length === 1) {
            buffer += e.key

            const match = buffer.match(QR_EXACT_REGEX)
            if( match && match[1]) {
                e.preventDefault()
                e.stopImmediatePropagation()
                triggerScan(match[1], document.activeElement as HTMLInputElement | null)
            }
        }
    }


    function handleInput(e: Event){
        const target = e.target as HTMLInputElement | null
        if(!target || (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA')) return

        const match = target.value?.match(QR_EXACT_REGEX)
        if(match && match[1]) {
            triggerScan(match[1], target)
        }
    }

    function handlePaste(e: ClipboardEvent) {
        const pasted = e.clipboardData?.getData('text') || ''
        const match = pasted.match(QR_EXACT_REGEX)
        if (match && match[1]) {
            e.preventDefault()
            e.stopImmediatePropagation()
            triggerScan(match[1], document.activeElement as HTMLInputElement | null)
        }
    }

        window.addEventListener('keydown', handleKeyDown, true)
        window.addEventListener('input', handleInput, true)
        window.addEventListener('paste', handlePaste, true)
        window.addEventListener('mousedown', handleMouseActivity, true)
    

    onUnmounted(() => {
        window.removeEventListener('keydown', handleKeyDown, true)
        window.removeEventListener('input', handleInput, true)
        window.removeEventListener('paste', handlePaste, true)
        window.removeEventListener('mousedown', handleMouseActivity, true)
    })
    

}