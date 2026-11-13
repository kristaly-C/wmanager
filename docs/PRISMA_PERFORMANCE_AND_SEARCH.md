# Prisma Séma Optimalizáció, Keresés, Lapozás és Beszerzési Ár (`costPrice`) Védelem

Ez a dokumentum összefoglalja a **WManager (xStorage)** rendszerben elvégzett adatbázis-teljesítménybeli (PostgreSQL + Prisma) fejlesztéseket, a szerveroldali keresést/lapozást, valamint a beszerzési árak (`costPrice`) egységes jogosultsági szűrését. Másik AI chatben való hivatkozáskor elég ezt a fájlt (`docs/PRISMA_PERFORMANCE_AND_SEARCH.md`) megadni kontextusként.

---

## 1. Üzleti és technikai cél

5 000+ termék (ami ~15–25 000 variánst és több százezer készletmozgást jelent) esetén a PostgreSQL adatbázis önmagában néhány ezredmásodperc alatt válaszol, **ha**:
1. Az idegen kulcsok (Foreign Keys) és gyakori kereső/rendező mezők indexelve vannak (`@@index`), mivel a PostgreSQL csak a `@id` és `@unique` mezőket indexeli automatikusan.
2. A végpontok nem próbálják meg egyszerre a teljes táblát memóriába tölteni, hanem támogatják a szerveroldali szűrést (`search`) és lapozást (`skip`, `take`).
3. A pénzügyi és mennyiségi `Decimal` mezők nem az alapértelmezett `DECIMAL(65, 30)` típust használják, hanem pontos skálázást (`@db.Decimal(...)`).
4. A beszerzési ár (`costPrice`) nem szivárog ki a készlet- és készletmozgás-lekérdezéseken (`include: { variant: true }`) keresztül azoknál a szerepköröknél, akik nem láthatják.

---

## 2. Elvégzett fejlesztések részletesen

### 2.1. Adatbázis indexek (`@@index`) és relációs szabályok (`schema.prisma`)
A teljes táblás keresések (*Sequential Scan*) elkerülése érdekében az alábbi indexek kerültek be a sémába:

- **`Product`:** `@@index([categoryId])`, `@@index([brandId])`, `@@index([primarySupplierId])`, `@@index([name])`, `@@index([manufacturerCode])`
- **`Variant`:** `@@index([productId])`
- **`VariantBarcode`:** `@@index([variantId])` + `onDelete: Cascade` (variáns törlésekor a vonalkódjai is törlődnek)
- **`StockItem`:** `@@index([locationId])` (a meglévő `@@unique([variantId, locationId])` kompozit index csak a `variantId`-val kezdődő kereséseket gyorsította, a tisztán `locationId` alapú raktár/polc lekérdezéseket és a `DEDICATED` tárhely-ellenőrzést nem)
- **`StockMovement`:** `@@index([locationId, createdAt])`, `@@index([variantId, createdAt])`, `@@index([createdByUserId])` (a leggyorsabban növekvő naplótábla időrendi lekérdezéseihez)
- **`Category` és `Location` (hierarchia):** `@@index([parentId])` (a `LocationAccessService` többszintű szülő-ellenőrzéséhez és fa-bejáráshoz)
- **Egyéb tranzakciós táblák:**
  - `PurchaseOrder`: `@@index([supplierId])`
  - `StockTransfer`: `@@index([fromLocationId])`, `@@index([toLocationId])`
  - `StocktakeSession`: `@@index([locationId])`, `@@index([performedByUserId])`
  - `StocktakeItem`: `@@index([stocktakeSessionId])`, `@@index([variantId])` (`onDelete: Cascade`)
  - `ReturnCase`: `@@index([handledByUserId])`
  - `ReturnCaseItem`: `@@index([returnCaseId])`, `@@index([variantId])` (`onDelete: Cascade`)
  - `UserLocation`: `@@index([locationId])`

### 2.2. Pontos `Decimal` típusok (`@db.Decimal`)
- `Product.vatRate`: `Decimal @db.Decimal(5, 2)` (pl. `27.00`)
- `Variant.weight`: `Decimal @db.Decimal(10, 3)` (súly 3 tizedesjegyig)
- `Variant.price`: `Decimal @db.Decimal(12, 2)`
- `Variant.costPrice`: `Decimal @db.Decimal(12, 2)`

### 2.3. Szerveroldali keresés (`search`) és lapozás (`skip`, `take`)
- **`GET /products` (`ProductController` & `ProductService.findAllFiltered`):**
  - Támogatott query paraméterek: `search`, `categoryId`, `brandId`, `skip`, `take`.
  - A `search` paraméter kis- és nagybetű-függetlenül (`mode: 'insensitive'`) keres a termék nevében (`name`), gyártói kódjában (`manufacturerCode`), modelljében (`model`), a márka nevében (`brand.name`), valamint a termékhez tartozó variánsok `sku` és `variantBarcodes.barcode` mezőiben.
- **`GET /variants` (`VariantController` & `VariantService.findAllForUser`):**
  - Támogatott query paraméterek: `search`, `productId`, `skip`, `take`.
  - A `search` paraméter keres a variáns `sku`-jában, a `variantBarcodes.barcode` értékekben, valamint a szülő termék `name`, `manufacturerCode` és `model` mezőiben (kiválóan használható a globális `Ctrl + K` gyorskeresőhöz és PDA vonalkód-kereséshez).
- **`GET /stock` és `GET /stock/movements` (`StockController` & `StockService`):**
  - Támogatott query paraméterek: `locationId`, `variantId`, `skip`, `take`.
  - A `GET /stock/movements` alapértelmezetten `take = 100` értéket használ, ha a hívó nem ad meg limitet, így megakadályozza, hogy több százezer múltbéli készletmozgás egyszerre töltődjön be a memóriába.

### 2.4. Egységes `costPrice` (beszerzési ár) védelem (`src/common/cost-price.ts`)
- A beszerzési árat kizárólag a `COST_PRICE_ROLES` szerepkörök láthatják: `BOSS`, `ADMIN`, `WAREHOUSE_MANAGER`, `STORE_MANAGER`, `ORDER_CLERK`.
- A `STORE_STAFF`, `WAREHOUSE_STAFF` és `RMA_CLERK` szerepkörök számára a `canSeeCostPrice(role)` és `excludeCostPrice(variant)` segédfüggvények nemcsak a `VariantService`-ben, hanem a `StockService.findAll` és `StockService.findMovements` beágyazott `variant` objektumaiból is eltávolítják a `costPrice` mezőt.

---

## 3. Érintett fájlok áttekintése

| Fájl | Szerepe és módosítások |
| :--- | :--- |
| `apps/backend/prisma/schema.prisma` | `@@index` definíciók minden idegen kulcsra és keresőmezőre, `@db.Decimal` pontosságok, `onDelete: Cascade` szabályok. |
| `apps/backend/src/common/cost-price.ts` | Közös `COST_PRICE_ROLES`, `canSeeCostPrice(role)` és `excludeCostPrice(variant)` segédfüggvények. |
| `apps/backend/src/product/product.service.ts` | `findAllFiltered(options)` metódus (`search`, `categoryId`, `brandId`, `skip`, `take`). |
| `apps/backend/src/product/product.controller.ts` | `GET /products` query paraméterek (`search`, `categoryId`, `brandId`, `skip`, `take`) bekötése. |
| `apps/backend/src/variant/variant.service.ts` | `findAllForUser(user, options)` bővítése kereséssel/lapozással és a közös `cost-price.ts` használatával. |
| `apps/backend/src/variant/variant.controller.ts` | `GET /variants` query paraméterek (`search`, `productId`, `skip`, `take`) bekötése. |
| `apps/backend/src/stock/stock.service.ts` | `skip`/`take` lapozás (100-as alapértelmezett limit a `findMovements`-en) és `excludeCostPrice` alkalmazása a beágyazott `variant` objektumokra. |
| `apps/backend/src/stock/stock.controller.ts` | `GET /stock` és `GET /stock/movements` kiegészítése `skip` és `take` query paraméterekkel. |

---

## 4. Mire figyelj későbbi fejlesztéskor (Frontend bekötésnél)?

1. **Katalógus és Globális Kereső (`Ctrl + K`):**
   - Amikor a frontend `ProductsTab.vue` vagy `GlobalProductSearch.vue` komponenseket bekötöd az éles API-ra, használd a `?search=...&take=50&skip=0` query paramétereket a `GET /products` és `GET /variants` hívásoknál.
2. **Új Prisma modell vagy reláció felvételekor:**
   - Minden új idegen kulcs (`...Id`) mezőre tegyél `@@index([...Id])` jelölést a `schema.prisma`-ban, és pénzügyi mezőknél mindig add meg a `@db.Decimal(12, 2)` attribútumot.
3. **Variánsok beágyazása (`include: { variant: true }`) új modulokban:**
   - Ha egy új service (pl. `ReturnCaseService`, `StockTransferService`, `SalesOrderService`) visszaadja a `variant` objektumot olyan végponton, amit `STORE_STAFF`, `WAREHOUSE_STAFF` vagy `RMA_CLERK` is elérhet, mindig hívd meg rá az `excludeCostPrice(variant)` függvényt a `src/common/cost-price.ts`-ből.
