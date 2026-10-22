export function isPdaOrMobileDevice(): boolean {

const forcedMode = localStorage.getItem('preferredViewMode')
if( forcedMode === 'pda') return true
if(forcedMode === 'desktop') return false


const userAgent = navigator.userAgent || ''
const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBreey|IEMobile|Opera Mini/i.test(userAgent)

const isSmallScreen = window.innerWidth < 768

return isMobileUA || isSmallScreen
}