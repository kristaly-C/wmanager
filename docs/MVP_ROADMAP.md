# wmanager (xStorage) – MVP Ütemterv és Állapotkövető

> Ez a dokumentum az MVP (Minimum Viable Product) fejlesztési sorrendjét és aktuális készültségi állapotát követi nyomon. Minden lezárt részfeladatnál pipáld ki (`[x]`) az adott sort, és frissítsd az „Aktuális fókusz” részt.
>
> Utolsó frissítés: 2026-11-16

---

## Aktuális fókusz

- **Következő lépés:** **3/B. Bevételezés beérkezett áruhoz (PurchaseOrder)** (Prisma séma-bővítés `PurchaseOrderItem`-mel, shared-types, backend modul és frontend bevételezés nézet)
- **MVP célok röviden:**
  1. Raktár és pozíciók (`WAREHOUSE` / `STORE` → `ZONE` → `SHELF` → `BIN`) könnyű létrehozása és kezelése.
  2. Termékek, variánsok és vonalkódok kezelése.
  3. Termékek felvitele pozíció szerint, valamint bevételezés létrehozása beérkezett áruhoz.
  4. Rendelés felvétele a saját raktárkészletünkre (foglalással és kiadással).

---

## 0. Alapozás (Már elkészült részek)

### Backend (`apps/backend`)
- [x] Hitelesítés és RBAC (`auth`, JWT, QR-kódos gyorsbelépés, `RolesGuard`, `@Roles`)
- [x] Felhasználókezelés és helyszín-hozzárendelés (`user`, `user-location`, hierarchia-szabályok)
- [x] Lokációkezelés (`location` CRUD + `LocationAccessService` fa-alapú jogosultsággal)
- [x] Törzsadatok (`brand`, `category`, `supplier`, `product`, `variant`, `variant-barcode`)
- [x] Készlet alapok (`stock`: `/stock`, `/stock/movements`, `/stock/adjust`, `DEDICATED` polcvédelem, `costPrice` szűrés)
- [x] Leltár backend (`stocktake` modul)

### Frontend (`apps/frontend`)
- [x] Alap elrendezés, munkaterület-váltó (`workspace.ts`), útvonalvédelem (`router/index.ts`)
- [x] Bejelentkezés + QR-kódos raktári átjelentkezés (`LoginView.vue`, `MainLayout.vue`, `MyQrBadgeModal.vue`)
- [x] Felhasználók kezelése és lokációhoz rendelése (`UsersView.vue`)
- [x] Lokáció API kliens (`src/api/locations.ts`)
- [x] Kategóriák kezelése (`CategoriesView.vue` – teljes CRUD hierarchia-választással)
- [x] Katalógus és termékadatlap (`CatalogView.vue`, `ProductsTab.vue`, `BrandsTab.vue`, `SuppliersTab.vue`)

---

## 1. Mérföldkő – Raktár és pozíciók könnyű kezelése

**Cél:** Raktár/üzlet létrehozása, alá zónák, polcok és tárolórekeszek (`ZONE` → `SHELF` → `BIN`) gyors felvétele és karbantartása.

### Backend (`apps/backend`)
- [x] Alap `Location` CRUD (`GET /locations`, `POST /locations`, `PATCH /locations/:id`, `DELETE /locations/:id`)
- [x] Tömeges pozíció-létrehozás (`POST /locations/bulk` – pl. polcok/rekeszek sorozat-generálása előtag + tartomány alapján, hogy ne egyesével kelljen rögzíteni)

### Frontend (`apps/frontend`)
- [x] Lokációk oldal és útvonal bekötése (pl. `/inventory` alatt vagy saját nézetben)
- [x] Hierarchikus fa / osztott nézet (`WAREHOUSE`/`STORE` → `ZONE` → `SHELF` → `BIN`)
- [x] Gyors létrehozás közvetlenül a szülő sorról (*„+ Zóna”*, *„+ Polc”*, *„+ Rekesz”*), `slotMode` (`DEDICATED` / `MIXED`) beállításával
- [x] Tömeges polc/rekesz generáló modal (pl. `A-01` … `A-20` vagy `Sor × Oszlop × Szint`)
- [x] Pozíció szerkesztése, áthelyezése (`parentId`), inaktiválása és biztonságos törlése

---

## 2. Mérföldkő – Katalógus és Termékek kezelése

**Cél:** Valódi adatbázisból működő termék-, variáns-, vonalkód-, kategória-, márka- és beszállítókezelés.

### Backend (`apps/backend`)
- [x] `Brand`, `Category`, `Supplier`, `Product`, `Variant`, `VariantBarcode` végpontok
- [x] Ellenőrzés: a `Product` lista válasz tartalmazza-e a `total` elemszámot a `:lazy="true"` PrimeVue lapozáshoz (ha szükséges, `{ items, total }` bővítés)
- [x] Variáns színváltozat képek (`Variant.imageUrls` mező, Prisma migráció, DTO validáció, és `bulkCreate` támogatás)

### Frontend (`apps/frontend`)
- [x] Frontend API kliensek létrehozása (`products.ts`, `variants.ts`, `brands.ts`, `suppliers.ts`)
- [x] `CategoriesView.vue` kiegészítése létrehozás / szerkesztés / törlés dialógussal (fa/szülő választással)
- [x] `Brands` és `Suppliers` fülek megvalósítása a `CatalogView.vue`-ban (jelenleg placeholder)
- [x] `ProductsTab.vue` bekötése valódi API-ra (mintaadatok kiváltása, szerveroldali keresés ~300 ms debounce-szal és lapozással)
- [x] Termék létrehozása / szerkesztése modal
- [x] Variánsok CRUD a termékadatlapon (szín, méret, SKU, ár, `costPrice` szerepkör szerinti elrejtésével)
- [x] Variáns színváltozat képek (`imageUrls`) szerkesztése (`VariantFormModal.vue`), Hero színváltozat galéria + variánstábla miniatűrök (`ProductsTab.vue`), és `GlobalProductSearch.vue` előnézet
- [x] Vonalkódok kezelése variánsonként (`VariantBarcode` hozzáadása, elsődleges jelölés, törlés)

---

## 3. Mérföldkő – Pozíció szerinti készlet és Bevételezés

**Cél:** Termékek felvitele konkrét pozíciókra, raktári készlet áttekintése pozíciónként, valamint beérkező áru bevételezése.

### 3/A. Pozíció szerinti készlet (`StockItem` & `StockMovement`)
- [x] Frontend `stock.ts` API kliens (`/stock`, `/stock/movements`, `/stock/adjust`)
- [x] Készletlista nézet lokáció / pozíció és termék / variáns szerinti szerveroldali szűréssel (`quantity`, `reservedQuantity`, elérhető: `quantity - reservedQuantity`)
- [x] Gyors *„Készlet felvitele pozícióra / korrekció”* művelet (`INITIAL_STOCK` / `MANUAL_CORRECTION`), vonalkód- vagy SKU-kereséssel
- [x] A `ProductsTab.vue` *„Készlet”* al-fülének bekötése (mutassa, melyik pozíción hány darab van az adott termék variánsaiból)
- [x] Készletmozgási napló (`/movements`) megjelenítése
- [x] Kereszt-telephelyi készlet betekintés (cross-location stock visibility): nem hozzárendelt telephelyek gyökér szintű (`WAREHOUSE`/`STORE`) aggregált olvasása és szűrése read-only módban (`isAssigned: false`, `isExternalLocation: true`), írási műveletek és belső zónák/polcok szigorú védelmével mindkét rétegben
- [x] Raktáron belüli pozíció-áthelyezés (`POST /stock/relocate`, `TRANSFER_OUT` + `TRANSFER_IN` `$transaction`-ben, `DEDICATED` védelem és 3-lépéses pozíció-áthelyező varázsló a `StockAdjustModal.vue`-ban)
- [x] BOSS / ADMIN nyitókészlet-felvitel kapcsoló (`SystemSetting.initialStockEnabled`, `GET/PATCH /stock/settings`, backend tiltás ha inaktív, és vezérlőpulti toggle kártya a `DashboardView.vue`-ban)
- [x] Polckészlet hiány és eltérés-jelentés (`StockReport` modell, `POST /stock/reports`, vezetői elbírálás `resolveReport` atomi készlet- és mozgásszinkronnal, `InventoryView.vue` 4. fül jelvénnyel, `F5` gyorsjelentés a `GlobalProductSearch.vue`-ban, és vezérlőpulti widget)

### 3/B. Bevételezés beérkezett áruhoz (`PurchaseOrder`)
> **Elkerülhetetlen séma-bővítés:** a `prisma/schema.prisma`-ban a `PurchaseOrder` jelenleg csak fejléc (`supplierId`, `status`), még nincs hozzá `PurchaseOrderItem` tábla és NestJS modul.
- [ ] Prisma séma bővítése: `PurchaseOrderItem` (`purchaseOrderId`, `variantId`, `orderedQuantity`, `receivedQuantity`, opcionális egységár) + szükséges fejlécmezők (pl. bizonylatszám/szállítólevél szám, megjegyzés, célraktár) és migráció
- [ ] `@wmanager/shared-types` bővítése a `PurchaseOrder` és `PurchaseOrderItem` típusokkal
- [ ] Backend `PurchaseOrderModule` (`GET`, `POST`, `PATCH`, `POST :id/receive` – `$transaction`-ben pozíció(k)ra történő `StockItem` növeléssel és `PURCHASE_RECEIPT` típusú `StockMovement` rögzítéssel)
- [ ] Frontend Bevételezés nézet (`/purchase-orders` vagy `/shipments` alatt): új bevételezés felvétele, tételek hozzáadása, beérkezett tételek pozícióra rakása és lezárása

---

## 4. Mérföldkő – Rendelés felvétele saját raktárkészletre

**Cél:** Vevői / bolti rendelések rögzítése a meglévő szabad készlet terhére, foglalással és teljesítéssel (kiadással).

> **Elkerülhetetlen séma-bővítés:** a `prisma/schema.prisma`-ban a `SalesOrder` jelenleg csak fejléc (`status`), még nincs hozzá `SalesOrderItem` tábla és NestJS modul.
- [ ] Prisma séma bővítése: `SalesOrderItem` (`salesOrderId`, `variantId`, `quantity`) + rendelés fejlécmezők (rendelésszám, vevő neve/elérhetősége vagy forrás, forrás lokáció, megjegyzés) és migráció
- [ ] `@wmanager/shared-types` bővítése a `SalesOrder` és `SalesOrderItem` típusokkal
- [ ] Backend `SalesOrderModule`:
  - [ ] Rendelés létrehozása `$transaction`-ben: szabad készlet (`quantity - reservedQuantity`) ellenőrzése és `reservedQuantity` növelése
  - [ ] Rendelés teljesítése / kiadása: választott pozíció(k)ról `quantity` és `reservedQuantity` csökkentése + `SALE` típusú `StockMovement` létrehozása
  - [ ] Rendelés lemondása: `reservedQuantity` felszabadítása
- [ ] Frontend Rendelések nézet (`/orders`): rendelésfelvétel (elérhető készlet kijelzésével), rendeléslista, státuszkezelés (teljesítés / lemondás)

---

## 5. MVP utáni következő körök (Backlog)

- [ ] **Leltár UI (`/stocktakes`):** meglévő backend `StocktakeModule` bekötése a frontendre
- [ ] **Lokációk közti árumozgatás / transzfer (`StockTransfer`):** backend modul + UI (`/transfers`)
- [ ] **PDA felület (`/pda`):** Zebra DataWedge vonalkódos gyorsbevételezés, polcra helyezés (putaway), kiszedés és leltár
- [ ] **Visszáru / RMA (`ReturnCase`):** backend modul + UI (`/returns`)
- [ ] **Dashboard KPI-k & Webshop szinkron**
