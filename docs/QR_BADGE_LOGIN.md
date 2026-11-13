# Raktári Gyorsbeléptető és Fiókváltó Rendszer (QR-kód / Kártya alapú autentikáció)

Ez a dokumentum összefoglalja a **WManager (xStorage)** rendszerbe épített QR-kódos gyorsbeléptető és azonnali fiókváltó funkció architektúráját, működését és az érintett fájlokat. Másik chatben való hivatkozáskor elég ezt a fájlt (`docs/QR_BADGE_LOGIN.md`) megadni kontextusként.

---

## 1. Üzleti cél és működési koncepció

A raktárban lévő közös munkaállomásokon (PC-ken) és ipari PDA-kon a raktárosoknak nem praktikus minden művelet előtt e-mail címmel és jelszóval ki-be jelentkezniük.

### Főbb funkciók:
1. **Egyedi előtagú belépőkód (`WM-AUTH-<32-hex-karakter>`):**
   - Mindenkinek (kivéve az `ADMIN` és `BOSS` szerepköröket) generálható egy 40 karakteres, egyedi token (pl. `WM-AUTH-4f8a9b...`).
   - Az előtag (`WM-AUTH-`) biztosítja, hogy a globális olvasó-figyelő bárhol az alkalmazásban meg tudja különböztetni a dolgozói belépőkódot a termékek EAN/SKU vonalkódjaitól.
2. **Saját QR-kód megjelenítése és kártyanyomtatás:**
   - A dolgozó a PDA-n vagy PC-n bármikor megnyithatja a saját QR-kódját (`MyQrBadgeModal.vue`), amit a raktári PC olvasója közvetlenül a PDA kijelzőjéről is le tud olvasni, vagy fizikai kártyára/kitűzőre nyomtatható.
   - Ha a fizikai kártya elveszik, a dolgozó egyetlen gombnyomással **új kódot generálhat**, amivel a régi kártya azonnal érvénytelenné válik.
3. **Kijelentkezés nélküli azonnali fiókváltás + „Okos védelem”:**
   - A közös raktári gép nem léptet ki automatikusan: mindig az utoljára csippantott raktáros marad bejelentkezve.
   - **Ha a gép szabad** (nincs nyitva modális ablak/panel, és az elmúlt 15 másodpercben nem gépeltek/kattintottak rajta), egy másik raktáros QR-kódjának leolvasásakor a rendszer **kérdés nélkül, azonnal átvált** az új raktáros fiókjába.
   - **Okos védelem (`isBusy`):** Ha valaki éppen dolgozik a gépen (nyitva van egy `.p-dialog` vagy `.p-drawer`, vagy 15 másodpercen belül volt egér/billentyűzet aktivitás), a rendszer **nem szakítja meg** a munkamenetet, hanem feldob egy megerősítő ablakot (*„Folyamatban lévő művelet! [Név] szeretne átjelentkezni...”*). Ezt az ott álló dolgozó `Esc`-kel elutasíthatja, vagy az új dolgozó egy második csippantással (illetve az *Átváltás* gombbal) jóváhagyhatja.

---

## 2. Érintett fájlok áttekintése

### Backend (`apps/backend`)
| Fájl | Szerepe és módosítások |
| :--- | :--- |
| `prisma/schema.prisma` | A `User` modell bővült a `qrToken String? @unique` mezővel. |
| `src/auth/dto/qr-login.dto.ts` | Validálja a beérkező tokent (`@Matches(/^WM-AUTH-[A-Za-z0-9_-]+$/)`). |
| `src/auth/auth.service.ts` | `loginWithQr()`, `getMyQrToken()`, `regenerateQrToken()` metódusok és `ADMIN`/`BOSS` tiltás (`assertQrAllowedForRole`). |
| `src/auth/auth.controller.ts` | Új végpontok: `POST /auth/qr-login`, `GET /auth/my-qr`, `POST /auth/my-qr/regenerate`. |
| `src/auth/strategies/jwt.strategy.ts` | A JWT validáció mostantól a `name` mezőt is visszaadja (`{ userId, email, name, role }`). |
| `src/auth/decorators/current-user.decorator.ts` | Az `AuthUser` interfész kiegészült a `name: string` mezővel. |
| `src/user/user.service.ts` | Az `excludePassword` metódus a `passwordHash` mellett a `qrToken` mezőt is eltávolítja a publikus felhasználó-lekérésekből, hogy mások kódja ne szivárogjon ki. |

### Frontend (`apps/frontend`)
| Fájl | Szerepe és módosítások |
| :--- | :--- |
| `src/stores/auth.ts` | Kiegészült a `verifyQrToken(qrToken)`, `applySession(token, user)` és `loginWithQr(qrToken)` akciókkal. |
| `src/composables/useQrBadgeScanner.ts` | Globális olvasó-figyelő composable, amely kezeli a PC-s USB olvasókat és az Androidos ipari PDA-kat is. |
| `src/components/common/MyQrBadgeModal.vue` | A dolgozó saját QR-kódját megjelenítő, kártyanyomtatást (`window.print()`) és kód-újragenerálást biztosító modális ablak (`qrcode` csomaggal). |
| `src/views/LoginView.vue` | Bekötve a `useQrBadgeScanner` a jelszó nélküli azonnali belépéshez, `autofocus`-szal az e-mail mezőn. |
| `src/layouts/MainLayout.vue` | Bekötve a `useQrBadgeScanner` a munka közbeni fiókváltáshoz, az Okos védelem (`pendingSwitch`) megerősítő dialógus és a `MyQrBadgeModal`. |
| `src/layouts/PdaLayout.vue` | A PDA fejlécébe bekerült a saját QR-kód megnyitó gomb és a `MyQrBadgeModal`. |

---

## 3. Technikai részletek (Amire későbbi fejlesztéskor figyelni kell)

### 3.1. Hogyan működik a `useQrBadgeScanner.ts`? (PC + Android PDA kompatibilitás)
Az ipari olvasók és Androidos PDA-k három különböző módon küldhetnek adatot a böngészőnek, ezért a composable mindhármat figyeli **capture fázisban (`true`)**, közvetlenül a `setup` lefutásakor regisztrálva (hogy megelőzze a gyerek komponensek `onMounted` eseménykezelőit, pl. a `GlobalProductSearch.vue`-t):

1. **`keydown` figyelés (PC USB HID olvasók és KeyEvent módú PDA-k):**
   - Gyűjti a gyorsan (`MAX_KEY_INTERVAL_MS = 300ms`-on belül) érkező karaktereket.
   - Nem vár kötelezően `Enter`-re: amint összeáll a 40 karakteres `WM-AUTH-<32 hex>` minta, azonnal elsüti a beolvasást (`e.preventDefault()` + `e.stopImmediatePropagation()`). Ha az olvasó küld utána `Enter`-t is, azt 500 ms-ig elnyeli.
2. **`input` esemény figyelés (Android PDA IME / Text Injection mód):**
   - Sok Androidos PDA `keydown` helyett egyben szúrja be a karakterláncot a fókuszált `<input>` mezőbe. A `handleInput` ezt elkapja, kitakarítja a `WM-AUTH-...` szöveget az inputból, és elindítja a belépést.
3. **`paste` esemény figyelés (Android PDA Clipboard Paste mód):**
   - A vágólap-alapú PDA beolvasást (és a fejlesztői `Ctrl + V` tesztelést) kapja el, még akkor is, ha épp nincs fókuszban egyetlen input mező sem.
4. **Magyar billentyűzetkiosztás normalizálása (`normalizeToken`):**
   - Ha az olvasó US kiosztásra van állítva, de az operációs rendszer magyar QWERTZ-re, a `-` karakterből `ü`, `Ö` vagy `/` lesz (`WMüAUTHü...`). A reguláris kifejezés (`/(WM[-ü/Ö]AUTH[-ü/Ö][a-fA-F0-9]{32})/i`) ezt felismeri, a `normalizeToken` pedig visszaalakítja szabványos `WM-AUTH-...` formátumra.

### 3.2. Miért van külön `verifyQrToken` és `applySession` az `authStore`-ban?
Amikor **A** raktáros dolgozik a gépen (`isBusy === true`), és **B** raktáros leolvassa a kódját:
1. A `verifyQrToken` meghívja a `POST /auth/qr-login` végpontot, ami visszaadja `{ accessToken, user }` objektumot, de az `authStore` **még nem írja felül** **A** raktáros tokenjét.
2. A felugró megerősítő ablak kiírja **B** raktáros nevét (`pendingSwitch.user.name`).
3. Ha **A** raktáros elutasítja a váltást (`Esc`), a munkamenete érintetlen marad. Ha jóváhagyják (vagy **B** még egyszer csippant), akkor hívódik meg az `applySession(accessToken, user)`.

---

## 4. Gyors tesztelés fejlesztés közben (olvasó nélkül)

1. Jelentkezz be egy nem-admin felhasználóval (pl. `WAREHOUSE_STAFF` vagy `WAREHOUSE_MANAGER`).
2. Nyisd meg a felső sávban a **QR-kód ikont**, és másold ki a `WM-AUTH-...` tokent a hálózati fülről (`GET /auth/my-qr`).
3. A `/login` oldalon vagy bejelentkezve bárhol nyomj egy **`Ctrl + V`**-t — a `useQrBadgeScanner` `paste` figyelője azonnal szimulálja a beolvasást.
