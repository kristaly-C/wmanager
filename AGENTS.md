# wmanager (xStorage) – AI Agent Irányelvek

## 0. Munkafolyamat és egyeztetés (KÖTELEZŐ)
- **Előbb egyeztetés, utána megvalósítás:** Mielőtt bármilyen kódot írnál, fájlt módosítanál/létrehoznál vagy állapotváltoztató parancsot (pl. migráció, telepítés) futtatnál, **mindig vázold fel röviden a tervedet** a felhasználónak (érintett fájlok, megközelítés, lépések, nyitott kérdések), és **várd meg a jóváhagyását**. Ne vágj bele saját magától a megvalósításba.
- **Előzetes tájékozódás:** A terv összeállításához a kód és a dokumentáció olvasása/keresése engedélyezett, de az érdemi változtatás előtt mindenképp egyeztess.

## 1. Architektúra és monorepo szabályok
- **Szerkezet:** npm workspaces monorepo (`apps/backend` NestJS + Prisma 7, `apps/frontend` Vue 3 + PrimeVue + Tailwind, `packages/shared-types` közös TS típusok).
- **Közös típusok (`@wmanager/shared-types`):** A típusok szándékosan laposak (kapcsolatok csak azonosítóval, dátumok szövegként). Bővítésnél külön `...WithX` típusokat használj.
- **Elnevezések:** camelCase mezők, többes számú API-útvonalak (`/products`, `/variants`, `/locations`), kisbetűs mappanevek.
- **Környezet:** PostgreSQL 17 Docker Compose-ban (`docker compose up -d`). `npx prisma ...` parancsokat mindig `apps/backend` mappából futtasd; az `npm ... --workspace=...` parancsokat a gyökérből.

## 2. Prisma 7 sajátosságok (`apps/backend`)
- A kapcsolat a `prisma.config.ts`-ben van (`@prisma/adapter-pg`), nem a `schema.prisma`-ban.
- A `schema.prisma` generátorának kötelező beállításai: `moduleFormat = "cjs"`, `importFileExtension = "ts"`, `output = "../src/generated/prisma"`.
- A `@prisma/client` csomagot telepítve kell tartani a futásidejű segédek miatt.
- Opcionális önhivatkozásoknál (`parentId`) kifejezetten add meg az `onDelete: Restrict` szabályt (különben a Prisma alapértelmezése `SetNull`).
- Típusellenőrzés backendben: `npx tsc --noEmit` (`apps/backend` mappából), mert a `start:dev` nem végez teljes típusellenőrzést.

## 3. Backend konvenciók és biztonság
- **Rétegződés:** `Controller → Service → PrismaService → PostgreSQL`. Az egyszerű CRUD modulok a `BaseService` osztályból örökölnek (`findAll(args?)`, `findOne`, `create`, `update`, `remove`). Minden service-re kell `@Injectable()`.
- **DTO-k:** Csak a kliens által küldhető mezők szerepeljenek benne (`id`, időbélyegek, `passwordHash` soha). A globális `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`) aktív.
- **RBAC / Jogosultság (KRITIKUS):**
  - Minden controlleren osztályszintű `@UseGuards(JwtAuthGuard, RolesGuard)`, az írási végpontokon kötelező `@Roles(...)` (elhagyása *fail-open*!).
  - A `BOSS` **nem** kap automatikus hozzáférést; minden végponton külön fel kell sorolni, ha jogosult rá.
  - Helyhez kötött szerepköröknél (`WAREHOUSE_MANAGER`, `STORE_MANAGER`, `WAREHOUSE_STAFF`, `STORE_STAFF`) használd a `LocationAccessService`-t (`accessibleWhere`, `assertCanAccess`).
  - `costPrice` mezőt soha ne szivárogtass ki `STORE_STAFF`, `WAREHOUSE_STAFF` és `RMA_CLERK` számára (`src/common/cost-price.ts`).
- **Készletintegritás:** A `StockMovement` append-only. Készletváltozáskor a `StockItem` frissítése és a `StockMovement` létrehozása **kötelezően egy `$transaction`-ben** történjen.

## 4. Frontend konvenciók (`apps/frontend`)
- **Szűrés és lapozás:** Lapozott vagy nagy tábláknál (`Product`, `Variant`, `StockItem`, `StockMovement`, `StocktakeSession` stb.) **szerveroldali szűrést** használj (`PrimeVue DataTable :lazy="true"`, query paraméterekkel, szűrőváltáskor `page = 1` nullázással, szöveges keresőnél ~300 ms debounce-szal). Kliensoldali szűrés csak kicsi, fix listáknál (`Brand`, `Category`, `Location`) használható.

## 5. Részletes modul-dokumentációk (`docs/`)
- MVP ütemterv és állapotkövető: `docs/MVP_ROADMAP.md`
- Általános projekt-áttekintés: `docs/PROJECT_OVERVIEW.md`
- Helyszín-jogosultság, vonalkódok, készlet, leltár, felhasználók: `docs/INVENTORY_CORE_AND_USERS.md`
- Prisma indexek, keresés, lapozás, `costPrice`: `docs/PRISMA_PERFORMANCE_AND_SEARCH.md`
- QR-kódos raktári beléptetés és fiókváltás: `docs/QR_BADGE_LOGIN.md`
- Frontend szűrési és lapozási irányelvek: `docs/FRONTEND_FILTERING_AND_CONVENTIONS.md`
