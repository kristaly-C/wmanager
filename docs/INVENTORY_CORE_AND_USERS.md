# Helyszín-jogosultság, Vonalkódok, Készlet, Leltár és Felhasználókezelés

Ez a dokumentum összefoglalja a **WManager (xStorage)** rendszerben elkészített helyszín-hozzáférési, vonalkód-, készlet-, leltár- és felhasználókezelési modulok architektúráját, üzleti szabályait és az érintett fájlokat. Másik AI chatben való hivatkozáskor elég ezt a fájlt (`docs/INVENTORY_CORE_AND_USERS.md`) megadni kontextusként.

---

## 1. Helyszín-alapú jogosultságkezelés (`LocationAccessService`) és `Location` modul

A felhasználók egy része globális (`LOCATION_UNBOUND_ROLES`: `ADMIN`, `BOSS`, `ORDER_CLERK`, `RMA_CLERK`), míg a többi szerepkör (`WAREHOUSE_MANAGER`, `STORE_MANAGER`, `WAREHOUSE_STAFF`, `STORE_STAFF`) csak a hozzá rendelt `WAREHOUSE` / `STORE` fákhoz és azok al-lokációihoz férhet hozzá.

### Főbb megoldások:
- **Optimalizált fastruktúra-ellenőrzés (`LocationAccessService`):**
  - A maximum 4 szintű hierarchia (`WAREHOUSE/STORE` → `ZONE` → `SHELF` → `BIN`) miatt az `isUnderAssigned` ciklusos DB-hívások helyett egyetlen beágyazott `select`-tel kéri le az ősöket.
  - Az `accessibleWhere(user)` egyetlen Prisma `where` feltételt ad vissza, amivel a `Location`, `StockItem`, `StockMovement` és `StocktakeSession` listák közvetlenül adatbázis-szinten szűrhetők.
- **`LocationController` & `LocationService`:**
  - `GET /locations`, `GET /locations/:id`, `POST /locations`, `PATCH /locations/:id`, `DELETE /locations/:id` mind helyszín-jogosultsággal védettek.
  - Gyökér lokációt (`WAREHOUSE`, `STORE`) csak `LOCATION_UNBOUND_ROLES` hozhat létre; `STORE_MANAGER` is kezelhet al-lokációkat a saját üzletén belül.
  - A `remove(id)` törlés előtt ellenőrzi, hogy nincs-e al-lokáció (`parentId: id`) vagy pozitív készlet (`StockItem.quantity > 0`), és `ConflictException`-t dob.
- **Közös optimalizációk (`BaseService`, `UserService`):**
  - `BaseService.findAll(args?)` opcionális Prisma `findMany` argumentumokat fogad (`where`, `include`, `orderBy`).
  - A `LocationService.update` valamint a `UserService.updateUser` és `removeUser` elkerüli a dupla `findOne` lekérdezést.

---

## 2. Vonalkód-modul (`VariantBarcode`)

Egy termékvariánshoz több vonalkód is tartozhat (pl. gyári EAN + belső címke), amelyekből **legfeljebb egy lehet elsődleges (`isPrimary: true`)**.

- **Végpontok (`variants/:variantId/barcodes`):** `GET`, `POST`, `PATCH :barcodeId`, `DELETE :barcodeId`.
- **Tranzakciós `isPrimary` szabály (`VariantBarcodeService`):** Ha új vagy módosított vonalkód `isPrimary: true`-t kap, a `$transaction` előbb leveszi az `isPrimary` jelölést a variáns többi vonalkódjáról.
- **Kereső-támogatás:** A `VariantService.findAllForUser` és `findOneForUser` automatikusan `include`-olja a `variantBarcodes` listát (`isPrimary: 'desc'` rendezéssel).

---

## 3. Készlet és Készletmozgás (`StockModule`)

- **Új `MovementType.INITIAL_STOCK`:** A kezdeti készletfeltöltés elkülönül a beszerzéstől (`PURCHASE_RECEIPT`) és a későbbi kézi korrekciótól (`MANUAL_CORRECTION`).
- **Üzleti szabályok (`StockService.adjustStock`):**
  - Bármilyen **aktív** lokációra (`WAREHOUSE`, `STORE`, `ZONE`, `SHELF`, `BIN`) engedélyezett a készletmozgatás, ha a felhasználónak van hozzáférése.
  - **`DEDICATED` tárhely-védelem:** Ha a lokáció `slotMode === 'DEDICATED'`, növeléskor nem lehet rajta más variánsból pozitív készlet (`ConflictException`).
  - **Negatív készlet tiltása:** `newQty < 0` esetén `BadRequestException`-t dob.
  - **Tranzakció:** A `StockItem` (`upsert`) és a `StockMovement` naplóbejegyzés közös `$transaction`-ben készül el.
- **Végpontok (`stock`):** `GET /stock`, `GET /stock/movements`, `POST /stock/adjust`.

---

## 4. Leltár-modul (`StocktakeModule`)

Többlépéses, feladat-alapú és **vakleltár** támogatással működő leltározási folyamat:

1. **Indítás (`POST /stocktakes`):**
   - `isTask?: boolean`: Ha `true`, a `performedByUserId` `null` marad, így szabad leltárfeladatként jelenik meg a saját bolt/raktár dolgozóinak. Ha `false`/üres, azonnal az indító dolgozó saját leltára lesz.
   - `splitByChildren?: boolean`: Ha `true`, a kiválasztott lokáció (pl. egy `ZONE`) alatti összes aktív gyerek-lokációra külön-külön nyitott feladatot generál, hogy több raktáros párhuzamosan számolhasson.
2. **Feladat felvétele (`POST /stocktakes/:id/claim`):** A saját raktáron/bolton belüli nyitott feladat felvétele.
3. **Lokális számolás + Szinkron + Beküldés:**
   - A kliens lokálisan számol, időszakosan szinkronizálhat (`PUT /stocktakes/:id/items` — tömbbel, `IN_PROGRESS` marad), vagy egyetlen tételt menthet (`PATCH /stocktakes/:id/items`).
   - Végleges beküldéskor (`POST /stocktakes/:id/submit`) egyben is beküldheti a számolt tételek tömbjét; a ki nem töltött eredeti tételek `0`-ra állnak, a státusz `WAITING_FOR_APPROVAL` lesz.
4. **Vakleltár védelem (`BLIND_STOCKTAKE_ROLES`):** A `WAREHOUSE_STAFF` és `STORE_STAFF` szerepkörök válaszából a `StocktakeService` kiszűri az `expectedQuantity` és `discrepancy` mezőket.
5. **Jóváhagyás és eltérések (`POST /stocktakes/:id/approve`, `GET /stocktakes/:id/discrepancies`):**
   - Csak vezetői szerepkörök (`ADMIN`, `BOSS`, `WAREHOUSE_MANAGER`, `STORE_MANAGER`) érhetik el.
   - A `StocktakeItem` sorokban eltárolódik a végső `expectedQuantity` és `discrepancy`, frissül a `StockItem`, és minden nem-nulla eltérésre létrejön a `STOCKTAKE_ADJUSTMENT` típusú `StockMovement`.

---

## 5. Frontend: Felhasználókezelés (`UsersView.vue` / `/users`)

A Figma terv alapján, a valódi backend sémához (`User`, `UserLocation`, `Role`) igazítva elkészült a felhasználókezelő felület:
- **Felső mutató kártyák:** Összes felhasználó (+havi új), Aktív felhasználók (%-kal), Helyhez kötött dolgozók, Aktív szerepkörök száma.
- **Csapattagok lista + Részletpanel:** Élő keresés, szerepkör- és állapotszűrés, lapozás, CSV exportálás, új felhasználó létrehozása, adatok/szerepkör/aktivitás szerkesztése, törlés.
- **Közvetlen helyszín-hozzárendelés:** A helyhez kötött szerepkörökhöz a jobb oldali panelen azonnal hozzárendelhetők és eltávolíthatók a `WAREHOUSE` / `STORE` lokációk.
- **Értesítések:** A központi PrimeVue `useToast()` szolgáltatást használja (`App.vue` `<Toast position="top-right"/>`).

---

## 6. Érintett fájlok áttekintése

### Backend (`apps/backend` & `packages/shared-types`)
| Fájl | Szerepe |
| :--- | :--- |
| `packages/shared-types/src/enums.ts` | `MovementType.INITIAL_STOCK` felvétele |
| `apps/backend/prisma/schema.prisma` | `MovementType.INITIAL_STOCK`, `StocktakeItem` modell, `StocktakeSession` bővítés (`note`, `approvedByUserId`, opcionális `performedByUserId`) |
| `apps/backend/src/common/base.service.ts` | `findAll(args?)` opcionális Prisma argumentum-támogatás |
| `apps/backend/src/location/location-access.service.ts` | Optimalizált `isUnderAssigned`, `accessibleWhere`, `canAccess`, `assertCanAccess` |
| `apps/backend/src/location/location.controller.ts` | `STORE_MANAGER` jogosultság, `findAll` szűrés, írási végpontok védelme |
| `apps/backend/src/location/location.service.ts` | `BIN` slotMode üzenet, dupla `findOne` eltávolítása, `remove` gyerek/készlet védelem |
| `apps/backend/src/user/user.service.ts` | `userLocations` include a lekérésekben, dupla `findOne` eltávolítása |
| `apps/backend/src/user/user-location.service.ts` | Felesleges mező/import takarítás |
| `apps/backend/src/variant/variant-barcode.*` & `dto/*` | `VariantBarcodeController`, `VariantBarcodeService`, DTO-k |
| `apps/backend/src/variant/variant.service.ts` | `variantBarcodes` include |
| `apps/backend/src/stock/*` | `StockController`, `StockService`, `StockModule`, `AdjustStockDto` |
| `apps/backend/src/stocktake/*` | `StocktakeController`, `StocktakeService`, `StocktakeModule`, DTO-k |
| `apps/backend/src/app.module.ts` | `StockModule` és `StocktakeModule` regisztrálása |

### Frontend (`apps/frontend`)
| Fájl | Szerepe |
| :--- | :--- |
| `src/api/locations.ts` | Lokációk REST API kliens |
| `src/api/users.ts` | Felhasználók és `UserLocation` REST API kliens |
| `src/views/UsersView.vue` | Felhasználókezelő oldal (KPI, táblázat, részletkártya, helyszín-hozzárendelés, modalok, `useToast()`) |
| `src/router/index.ts` | `/users` útvonal regisztrálása szerepkör-védelemmel |
