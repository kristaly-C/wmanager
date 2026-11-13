# Projekt-kontextus és Frontend Szűrési / Lapozási Irányelvek

Ez a dokumentum összefoglalja a ebben a munkamenetben egyeztetett általános projekt-kontextust, az `AGENTS.md` használatának elvét, valamint a **WManager (xStorage)** frontendjén követendő szerveroldali és kliensoldali szűrési/lapozási irányelveket. Másik AI chatben való hivatkozáskor elég ezt a fájlt (`docs/FRONTEND_FILTERING_AND_CONVENTIONS.md`) megadni kontextusként.

> **Megjegyzés:** Ebben a beszélgetésben nem történt kódmódosítás; a dokumentum a megbeszélt tervezési és architekturális döntéseket rögzíti.

---

## 1. Szűrés és lapozás a frontend–backend között

### 1.1. Szerveroldali szűrés (Server-side filtering) – Alapértelmezett irányelv
Minden olyan nézetnél, ahol **lapozás (pagination)** van, vagy az adathalmaz nagy / folyamatosan növekszik (`Product`, `Variant`, `StockItem`, `StockMovement`, `PurchaseOrder`, `StocktakeSession`, `ReturnCase`), **tilos** csak a böngészőben jelen lévő szeletet szűrni. A szűrés, rendezés és lapozás a backend API felé küldött query paraméterekkel történik:

- **API hívás formátuma:** `GET /eroforras?search=...&szuroId=...&skip=0&take=25&sortBy=...` (lásd még: `docs/PRISMA_PERFORMANCE_AND_SEARCH.md`).
- **PrimeVue `DataTable`:** `:lazy="true"` módban kell használni, ahol a `@page` és `@sort` események közvetlenül az API-lekérő függvényt hívják meg.
- **Oldalszám nullázása szűrőváltáskor:** Ha a felhasználó bármelyik szűrőt vagy a keresőmezőt módosítja, az oldalszámot (`page` / `skip`) kötelező visszaállítani az első oldalra (`page = 1` / `skip = 0`), különben egy szűkebb találati halmaznál üres táblázat jelenhet meg.
- **Debounce szöveges keresőnél:** Gépelés közben ~300 ms késleltetés (debounce) alkalmazandó, hogy ne menjen ki felesleges API-kérés minden billentyűleütésre. *(Kivétel: PDA vagy USB vonalkód-olvasó, ahol a leolvasás végén `Enter` érkezik — ott a kérés azonnal indítható.)*
- **Versenyhelyzet (race condition) kezelése:** Gyors egymásutáni szűrőváltásoknál `AbortController`-rel érdemes megszakítani a még folyamatban lévő előző kérést, hogy egy lassabb régebbi válasz ne írhassa felül az újabbat.

### 1.2. Kliensoldali szűrés (Client-side filtering) – Kivételek
Kliensoldali szűrés csak **kicsi, fix, lapozás nélküli** listáknál indokolt, amelyek egyszerre, teljes egészében letöltődnek:
- márkák (`Brand`),
- kategóriafa (`Category`),
- lokációfa (`Location`),
- felhasználók (`User` — kis létszám esetén) vagy legördülő menük (`Select` / `Autocomplete`) statikusabb opciói.

---

## 2. Egyeztetett projekt-kontextus és dokumentációs struktúra

A projekt átfogó üzleti és technikai háttere (motoros ruházati WMS, főraktár + boltok + webshop, NestJS + Prisma 7 + PostgreSQL 17 + Vue 3 / PrimeVue / Tailwind monorepo, `@wmanager/shared-types`, `BaseService`, `BOSS`/RBAC szabályok) a beszélgetés alapját képezte.

### Javasolt dokumentációs felosztás a repóban
1. **Embernek szóló projekt-áttekintés (`README.md` vagy `docs/`):** A teljes üzleti háttér, követelmények, modulok és ütemterv (a meglévő `docs/*.md` fájlokhoz hasonlóan).
2. **AI-nak szóló szabályfájl (`AGENTS.md` a gyökérben, opcionális):** Rövid, szigorú technikai kivonat (Prisma 7 sajátosságok, `BaseService` minta, RBAC / `BOSS` / `costPrice` szabályok, új modul receptje), amelyet az AI eszközök (Antigravity, Cursor) minden új munkamenet elején automatikusan betöltenek.
