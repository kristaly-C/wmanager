# wmanager (xStorage) – MVP Ütemterv és Állapotkövető

> Ez a dokumentum az MVP (Minimum Viable Product) fejlesztési sorrendjét és aktuális készültségi állapotát követi nyomon. Minden lezárt részfeladatnál pipáld ki (`[x]`) az adott sort, és frissítsd az „Aktuális fókusz” részt.
>
> Utolsó frissítés: 2026-11-28

---

## Aktuális fókusz

- **Aktuális állapot:** Az **1–4. Mérföldkő** (Lokációk, Katalógus & Variánsok, Készlet & Bevételezés, valamint Omnichannel Rendeléskezelés & Zónás Kiszedés) teljes egészében elkészült PC és PDA felületen is.
- **Következő lépés:** **5. fázis – Leltár UI (`/stocktakes`), Lokációk közti transzferek (`/transfers`) és Visszáru / RMA (`/returns`)**
- **MVP célok röviden:**
  1. [x] Raktár és pozíciók (`WAREHOUSE` / `STORE` → `ZONE` → `SHELF` → `BIN`) könnyű létrehozása és kezelése.
  2. [x] Termékek, variánsok és vonalkódok kezelése.
  3. [x] Termékek felvitele pozíció szerint, valamint bevételezés létrehozása beérkezett áruhoz.
  4. [x] Rendelés felvétele a saját raktárkészletünkre (foglalással, zónás kiszedéssel és kiadással).

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
- [x] ERP-kompatibilis `Product` & `Variant` modellbővítés: opcionális ruházati mezők (`gender`, `model`, `manufacturerCode`, `size`, `weight`, `colors`) az egyszerű termékek támogatásához, alap ERP/NAV mezők (`unit`, `vtszCode`, `originCountry`, `importantNote`, `season`, `isSerialized`, `isPurchasable`, `netWeight`, `volume`), valamint `Variant.price` átállítása `netPrice` + `grossPrice` párra (migrációs SQL + backend DTO/service frissítés)

### Frontend (`apps/frontend`)
- [x] Frontend API kliensek létrehozása (`products.ts`, `variants.ts`, `brands.ts`, `suppliers.ts`)
- [x] `CategoriesView.vue` kiegészítése létrehozás / szerkesztés / törlés dialógussal (fa/szülő választással)
- [x] `Brands` és `Suppliers` fülek megvalósítása a `CatalogView.vue`-ban (jelenleg placeholder)
- [x] `ProductsTab.vue` bekötése valódi API-ra (mintaadatok kiváltása, szerveroldali keresés ~300 ms debounce-szal és lapozással)
- [x] Termék létrehozása / szerkesztése modal
- [x] Variánsok CRUD a termékadatlapon (szín, méret, SKU, ár, `costPrice` szerepkör szerinti elrejtésével)
- [x] Variáns színváltozat képek (`imageUrls`) szerkesztése (`VariantFormModal.vue`), Hero színváltozat galéria + variánstábla miniatűrök (`ProductsTab.vue`), és `GlobalProductSearch.vue` előnézet
- [x] Vonalkódok kezelése variánsonként (`VariantBarcode` hozzáadása, elsődleges jelölés, törlés)
- [x] ERP törzsadat és `netPrice`/`grossPrice` kétirányú ÁFA-számítás a `ProductFormModal.vue`, `VariantFormModal.vue`, `ProductsTab.vue` és `GlobalProductSearch.vue` felületeken, egyszerű (méret és szín nélküli) termékek támogatásával

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

### 3/B. Bevételezés beérkezett áruhoz (`PurchaseOrder` & `GoodsReceipt`)
> **Elkészült:** a `PurchaseOrderItem`, `GoodsReceipt`, `GoodsReceiptItem`, `VariantSupplier` és `VariantMonthlyStat` modellek, a backend modulok, a desktop bevételezési felület és a PDA elrakás (putaway) folyamat is megvalósult.
- [x] **`VariantSupplier` kapcsolótábla és API:** több beszállító per variáns (`supplierSku`, idegen nyelvű `supplierProductName`, devizás beszerzési ár `purchasePrice` + `currency`, beszállítói kedvezmény `%`, rendelési egység `orderUnit`, `isPrimary` jelző)
- [x] Prisma séma bővítése: `PurchaseOrderItem`, `GoodsReceipt`, `GoodsReceiptItem`, `VariantSupplier`, `VariantMonthlyStat` modellek, fejlécmezők (bizonylatszám/szállítólevél szám, deviza/árfolyam, megjegyzés, célraktár) és migráció
- [x] `@wmanager/shared-types` bővítése a `PurchaseOrder`, `PurchaseOrderItem`, `GoodsReceipt`, `GoodsReceiptItem`, `VariantSupplier` és `VariantMonthlyStat` típusokkal
- [x] Backend `PurchaseOrderModule` és `GoodsReceiptModule` (`GET`, `POST`, `PATCH`, bevételezés és PDA elrakás / putaway `$transaction`-ben pozíció(k)ra történő `StockItem` növeléssel, `PURCHASE_RECEIPT` típusú `StockMovement` rögzítéssel és `VariantMonthlyStat` frissítéssel)
- [x] Frontend Bevételezés nézet (`/purchase-orders` és `/goods-receipts`) + PDA elrakás (putaway): új beszerzési rendelés és bevételezés felvétele, tételek hozzáadása, beérkezett tételek pozícióra rakása és lezárása

---

## 4. Mérföldkő – Rendelés felvétele saját raktárkészletre és zónás kiszedés

**Cél:** Vevői / bolti rendelések rögzítése a meglévő szabad készlet terhére, foglalással, IKEA-stílusú zónánkénti kiszedéssel és teljesítéssel (kiadással).

> **Elkészült:** az omnichannel `SalesOrder` foglalási/feloldási motor, a 2-menetes zónás `PickTask` rendszer, a PC `/orders` és `/shipments` felületek, az offline-tűrő PDA `/pda/picking` munkamenet és az `/analytics` *Értékesítés & Árrés* fül is megvalósult.
- [x] Prisma séma bővítése: `SalesOrder`, `SalesOrderItem`, `PickTask`, `PickTaskItem` modellek (`SalesChannel`, `SalesOrderStatus`, `PickTaskStatus`), egyedi rendelés- és feladatszámok, valamint migráció (`20261128101000_sales_orders_and_zone_picking`)
- [x] `@wmanager/shared-types` bővítése a `SalesOrder`, `SalesOrderItem`, `PickTask`, `PickTaskItem` és kapcsolódó enum típusokkal
- [x] Backend `SalesOrderModule` (`sales-order.controller.ts`, `sales-order.service.ts`, `pick-task.controller.ts`, `pick-task.service.ts`, `sales-reservation.ts`):
  - [x] Omnichannel rendelés létrehozása `$transaction`-ben: telephelyi szabad készlet (`quantity - reservedQuantity`) ellenőrzése és `reservedQuantity` foglalása, készlethiány esetén automatikus `ON_HOLD` státusz
  - [x] `ON_HOLD` feloldás és telephelyi készletmátrix (`GET /sales-orders/availability`, `reassign-location`, `request-transfer`, `recheck-stock`)
  - [x] IKEA-stílusú 2-menetes zónás kiszedés (`PickTask`): zónákra bontott feladattábla, többes feladatfelvétel kocsi/láda (`toteCode`) szerint, egyesített járási sorrend (`GET /pick-tasks/my-route`), lerakópolc QR-hozzárendelés (`dropoffLocationId` / `dropoffCode`), azonnali hiányjelentés és `SALE` mozgás + `VariantMonthlyStat` értékesítési/ELÁBÉ frissítés
  - [x] Rendelés teljesítése / kiadása (`complete`, `instantComplete` bolti azonnali kiadással), illetve lemondás (`cancel`) `reservedQuantity` felszabadítással és visszapótló korrekcióval
  - [x] Variáns értékesítési előzmény és árrés végpont (`GET /sales-orders/variant-history/:variantId`)
- [x] Frontend PC Rendelések nézet (`/orders` – `OrdersView.vue`, `OrderCreateModal.vue`, `OrderDetailDrawer.vue`): omnichannel rendelésfelvétel élő telephelyi szabadkészlettel, gyors vonalkód-bevitellel, `ON_HOLD` készletmátrix-feloldóval és átirányítással
- [x] Frontend PC Raktár & Kiadás nézet (`/shipments` – `ShipmentsView.vue`): *Kiszállításra vár (`READY`)* és *Zónás kiszedési feladattábla (`PickTask`)* fülek valós idejű állapottal és kiadással
- [x] Frontend PDA Kiszedés nézet (`/pda/picking` – `PdaPickingView.vue` + `useOfflinePickingQueue.ts`): többes zónafeladat felvétele kocsival/ládával, egyesített szedőkör járási sorrendben, lerakópolc QR-szkennelés és offline műveleti sor
- [x] Elemzések (`/analytics` – `AnalyticsView.vue`): *Értékesítés & Árrés* fül KPI kártyákkal, havi bevétel/ELÁBÉ/árrés statisztikával és lapozott lezárt rendelési tételekkel

---

## 5. MVP utáni következő körök (Teljes ERP kiváltás és Backlog)

### Raktár & Operáció bővítések
- [ ] **Leltár UI (`/stocktakes`):** meglévő backend `StocktakeModule` bekötése a frontendre
- [ ] **Lokációk közti árumozgatás / transzfer (`StockTransfer`):** backend modul + UI (`/transfers`)
- [ ] **PDA felület (`/pda`):** Zebra DataWedge vonalkódos gyorsbevételezés, polcra helyezés (putaway), kiszedés és leltár
- [ ] **Visszáru / RMA (`ReturnCase`):** backend modul + UI (`/returns`)
- [ ] **Dashboard KPI-k & Webshop szinkron**

### ERP, Számlázás és Könyvelés (régi rendszer teljes kiváltásához)
- [ ] **Árfolyamok & Speciális árlisták (`CurrencyRate`, `PriceList` / `PriceListItem`):** napi/MNB devizaárfolyamok, aktuális vs. utolsó Ft beszerzési ár számítás, vevői és akciós árlisták, max. kedvezmény% / minimális árrés figyelés
- [ ] **Vevőtörzs, Számlázás & NAV Online Számla (`Customer`, `Invoice` / `InvoiceItem`):** adószám, számlázási/szállítási cím, sztornó/jóváíró számlák, NAV XML adatszolgáltatás
- [ ] **Könyvelési & EPR adatok (`ProductAccounting`):** főkönyvi számlaszámok, termékdíj / EPR csomagolóanyag-kezelés, vámkezelési díj / fuvar / statisztikai illeték / paritás
- [ ] **Gyáriszám-követés (`SerialNumber`):** `Product.isSerialized` termékeknél egyedi gyáriszámok rögzítése bevételezéskor és kiadáskor
- [ ] **Csomagtermékek / Receptúrák (`ProductBundle` / BOM):** összetett termékek és szerelési/csomag-receptek kezelése
- [ ] **Módosítási napló (`AuditLog`):** törzsadat-, ár- és jogosultságváltozások visszakövethető naplózása
