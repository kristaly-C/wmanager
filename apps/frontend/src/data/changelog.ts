export type ChangelogCategory = 'feature' | 'improvement' | 'fix'

export interface ChangelogEntry {
  id: string
  date: string
  milestone: string
  category: ChangelogCategory
  title: string
  summary: string
  items: string[]
}

export const CHANGELOG_ENTRIES: ChangelogEntry[] = [
  {
    id: '2026-11-28-dispatch-hub-cross-site-dropoff',
    date: '2026-11-28',
    milestone: '4. Mérföldkő',
    category: 'feature',
    title: 'Összekapcsolt épületek (Közös csomagoló központ) és cross-site lerakás',
    summary:
      'Az egymás melletti épületek (pl. Főraktár + szomszédos Bolt) közös kiszállítási központba kapcsolhatók, és a kiszedett áru bármely elérhető telephely csomagolópolcára leadható.',
    items: [
      'Közös kiszállítási központ (Hub) beállítása a Vezérlőpulton — a központ és a kapcsolt bolt közös készlete ON_HOLD nélkül, épületenkénti/zónás kiszedési feladatokkal teljesíthető',
      'Klaszter-szintű foglalásvédelem a központ és a kapcsolt üzletek között (bolti pultos eladás nem viheti el a webshophoz foglalt utolsó darabot)',
      'Cross-site lerakás PC-n (/shipments) és PDA-n (/pda/picking): a szomszédos épületben kiszedett termékek a Főraktár lerakópolcaira is csippantva leadhatók',
      'Lerakó / Csomagoló helyszín (isDropoffLocation) jelölés a lokációknál a gyors polcválasztáshoz',
    ],
  },
  {
    id: '2026-11-28-pwa-standalone',
    date: '2026-11-28',
    milestone: 'Rendszer',
    category: 'feature',
    title: 'Telepíthető PWA mód (címsor nélküli PDA-használat)',
    summary:
      'Az xStorage mostantól telepíthető alkalmazásként (PWA) is hozzáadható a PDA és telefon kezdőképernyőjéhez, így böngésző címsor nélkül, teljes képernyőn fut.',
    items: [
      'Web App Manifest (standalone megjelenítés) és 192×192 / 512×512 alkalmazásikonok',
      'Minimális Service Worker a telepíthetőséghez, az élő raktári API-hívások megőrzésével',
      'PDA-barát viewport és görgetés-finomhangolás (véletlen pull-to-refresh tiltása)',
    ],
  },
  {
    id: '2026-11-28-fulfillment-routing',
    date: '2026-11-28',
    milestone: '4. Mérföldkő',
    category: 'improvement',
    title: 'Automatikus webshop telephely-választás és személyes átvétel',
    summary:
      'A webshopos rendelések automatikusan a Központi Raktár vagy a legkevesebb árumozgatást igénylő üzlet felé irányulnak split nélkül, míg a személyes bolti átvétel külön jelölhető.',
    items: [
      'Prioritás- és legkevesebb árumozgatás alapú automatikus telephely-választó a backendben és a rendelésrögzítőben',
      'Személyes bolti átvétel (Click & Collect) jelölés és szűrési/megjelenítési támogatás a rendeléslistában és részletezőben',
      'Új Webshop teljesítési sorrend & útválasztás kártya a Vezérlőpulton (ADMIN / BOSS)',
    ],
  },
  {
    id: '2026-11-28-m4-orders-picking-ui-pda',
    date: '2026-11-28',
    milestone: '4. Mérföldkő',
    category: 'feature',
    title: 'Rendeléskezelés, zónás kiszedés (PC & PDA) és értékesítési elemzések',
    summary:
      'Elkészült a teljes rendelésfelvételi, zónánkénti raktári kiszedési, árukiadási és értékesítési árrés-elemzési folyamat PC-n és PDA-n is.',
    items: [
      'PC Rendelések (/orders): omnichannel rendelésfelvétel élő telephelyi szabadkészlet-ellenőrzéssel, bolti azonnali kiadással, valamint ON_HOLD hiánykezelő készletmátrixszal és telephely-átirányítással',
      'Raktár & Kiadás (/shipments): Zónás feladattábla valós idejű kiszedési állapottal és Kiszállítási fül a READY rendelések átadására',
      'PDA Kiszedés (/pda/picking): többes feladatfelvétel (kocsi/láda), zónán belüli egyesített járási sorrend, lerakópolc QR-hozzárendelés és offline műveleti sor',
      'Elemzések (/analytics): aktivált Értékesítés & Árrés fül KPI kártyákkal, havi bevétel/ELÁBÉ/árrés bontással és lapozott lezárt rendelési tételistával',
    ],
  },
  {
    id: '2026-11-28-whats-new',
    date: '2026-11-28',
    milestone: 'Rendszer',
    category: 'feature',
    title: 'Újdonságok és frissítési napló',
    summary:
      'Elérhetővé vált a beépített frissítési napló a PC és a PDA fejlécben is, így minden új funkció és javítás egy helyen követhető.',
    items: [
      'Újdonságok ikongomb a PC és a PDA felső sávjában olvasatlan frissítés jelzéssel',
      'Kategória szerinti szűrés (Új funkció, Fejlesztés, Javítás) és az utolsó megtekintés óta érkezett tételek kiemelése',
      'Minden lezárt fejlesztés automatikusan összefoglalót kap a naplóban',
    ],
  },
  {
    id: '2026-11-28-m4-sales-orders-picking-backend',
    date: '2026-11-28',
    milestone: '4. Mérföldkő',
    category: 'feature',
    title: 'Rendeléskezelés és zónás kiszedés alapjai (Backend)',
    summary:
      'Elkészült az omnichannel rendeléskezelés (webshop, bolti, telefonos, B2B) és az IKEA-stílusú zónánkénti raktári kiszedés szerveroldali motorja.',
    items: [
      'Automatikus telephelyi szabadkészlet-foglalás és védelem a lefoglalt készlet túlfogyása ellen',
      'Hiányos rendelések automatikus ON_HOLD állapotba tétele és manuális feloldásának támogatása',
      'Rendelések automatikus szétbontása zónánkénti felvehető kiszedési feladatokra, együttes körszedés és lerakópolc QR-kódos hozzárendelés előkészítése',
    ],
  },
  {
    id: '2026-11-27-barcode-search-hu-scanner',
    date: '2026-11-27',
    milestone: 'Keresés & Szkenner',
    category: 'fix',
    title: 'Vonalkód-keresés minden modulban és magyar szkenner támogatás',
    summary:
      'A raktári USB vonalkód-olvasók magyar Windows billentyűzetkiosztáson is megbízhatóan működnek, és minden fő kereső ismeri a vonalkódokat.',
    items: [
      'Automatikus magyar szkenner-normalizálás (ö/Ö → 0, ü/Ü → -, 12/13 jegyű EAN vezető nulla és Y/Z kezelés)',
      'Vonalkód alapú keresés a Termékek, Variánsok, Készlet, Mozgások, Jelentések, Beszerzések és Bevételezések felületein',
      'Gyors Enteres termék-hozzáadás beszerzésnél és bevételezésnél, valamint offline PDA gyorsítótár-támogatás',
    ],
  },
  {
    id: '2026-11-21-m3b-procurement-receiving-pda-analytics',
    date: '2026-11-21',
    milestone: '3/B Mérföldkő',
    category: 'feature',
    title: 'Beszerzés, bevételezés, offline PDA és elemzések',
    summary:
      'Elindult a teljes beszállítói rendelés- és áruátvételi folyamat PC-n és PDA-n, kiegészítve vezetői elemzésekkel.',
    items: [
      'Beszerzési rendelések (PO) és variáns-beszállító kapcsolatok árrés-kalkulátorral',
      'Bevételezési munkamenetek PC-s felülettel és offline-tűrő PDA polcra pakolással',
      'Elemzések modul: beszállítói árösszehasonlítás, eladhatósági és készletforgási mutatók',
    ],
  },
  {
    id: '2026-11-16-m3a-inventory-reports-qr',
    date: '2026-11-16',
    milestone: '3/A Mérföldkő',
    category: 'feature',
    title: 'Készletkezelés, áttárolás, hibajelentések és QR-kódos belépés',
    summary:
      'Elindult a helyszín-alapú készletkezelés, a polcok közötti áttárolás, a sérült/hiányos jelentések kezelése és a gyors QR-kódos raktári fiókváltás.',
    items: [
      'Valós idejű készletnézet, korrigálás, polcok és telephelyek közötti áttárolás és auditálható mozgásnapló',
      'Sérült vagy hiányos készlet bejelentése (PDA és PC) és vezetői jóváhagyás',
      'Saját QR-kódos belépőkártya és munkavédelemmel ellátott gyors átjelentkezés közös raktári gépen',
    ],
  },
  {
    id: '2026-11-14-m1-m2-catalog-locations',
    date: '2026-11-14',
    milestone: '1–2. Mérföldkő',
    category: 'feature',
    title: 'Alaprendszer, katalógus és raktári lokációk',
    summary:
      'Felépült a többszintű jogosultságkezelés, a termékkatalógus variánsokkal és a hierarchikus raktár-térkép.',
    items: [
      'Szerepkör-alapú munkaterületek és helyszínhez kötött hozzáférés',
      'Termékek, variánsok, képek, márkák, kategóriák és többes vonalkódok kezelése',
      'Telephelyek, zónák és polcok hierarchikus nyilvántartása, globális Ctrl+K keresővel',
    ],
  },
]
