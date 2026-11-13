# wmanager – Projektdokumentáció

Raktár- és készletkezelő rendszer egy motoros ruházati kereskedő számára · Utolsó frissítés: 2026. október 28. · Állapot: aktív fejlesztés (a legfrissebb kód a `dev` ágon van)

> **További, későbbi részletes dokumentációk a `docs/` mappában:**
> - [INVENTORY_CORE_AND_USERS.md](./INVENTORY_CORE_AND_USERS.md) – Helyszín-jogosultság, vonalkódok, készlet, leltár és felhasználókezelés
> - [PRISMA_PERFORMANCE_AND_SEARCH.md](./PRISMA_PERFORMANCE_AND_SEARCH.md) – Prisma séma optimalizáció, keresés, lapozás és `costPrice` védelem
> - [QR_BADGE_LOGIN.md](./QR_BADGE_LOGIN.md) – Raktári QR-kódos gyorsbeléptető és fiókváltó rendszer
> - [FRONTEND_FILTERING_AND_CONVENTIONS.md](./FRONTEND_FILTERING_AND_CONVENTIONS.md) – Frontend szűrési és lapozási irányelvek
> - [AGENTS.md](../AGENTS.md) – Tömör AI-szabályok és fejlesztői kivonat

---

## 1. Összefoglaló

A wmanager egy webes raktárkezelő rendszer (WMS), amely egy motoros ruházattal kereskedő cég készletét követi több telephelyen: egy főraktárban, országszerte több boltban és a webshop felé. A rendszer célja, hogy minden áru mozgása nyomon követhető legyen a beérkezéstől az eladásig és a visszavételig, vonalkódos szkenneléssel, jogosultsághoz kötött műveletekkel és adatvesztés nélkül.

Jelenlegi állapot röviden: az adatmodell és a hitelesítés/jogosultságkezelés elkészült, a törzsadat-modulok (kategória, márka, beszállító, termék, variáns, felhasználó) működnek, a lokációkezelés az utolsó lépéseknél tart. A készletmozgások, a leltár és a frontend funkcionális része még hátravan.

## 2. A projekt célja és háttere

### 2.1 Az ügyfél

Az ügyfél motoros ruházati termékek importőre és kereskedője (többek között Macna, Difi, Dane, Forma, XPD, AGV, Givi, Jet és Airoh márkák). A működése egy főraktárból (bolttal egybeépítve), több országos boltból és egy webshopból áll.

### 2.2 A megoldandó problémák

- Egy termék több helyen is lehet (raktár, boltok), a pontos készlet nehezen követhető.
- A polcok kiosztása gyakran változik, ezért a termékek helye nem rögzíthető egyszer és mindenkorra.
- A beszállítói rendelések nagyjából egy évvel előre mennek, és egyes termékek alig fogynak, ezért fontos lenne tudni, mi éri meg újrarendelni.
- A webshop és a fizikai készlet között szinkron kell.
- A visszaküldések (RMA) és a leltár nem követhető egységesen.

### 2.3 Célok

1. Pontos, lokációnkénti készlet, teljes mozgástörténettel.
2. Gyors, vonalkódos munka PDA-n (Zebra Android terminálok, böngészős PWA, DataWedge billentyűzet-emulációs módban).
3. Szerepkör-alapú hozzáférés: mindenki csak azt lássa és csinálja, amihez köze van.
4. Dinamikus tárolóhely-kiosztás (putaway), mert a helyek gyakran változnak.
5. Adatvesztés elleni védelem: a készletmozgások nem módosíthatók és nem törölhetők utólag.
6. Később: webshop-szinkron, játékos elemek (XP, küldetések, statisztikák), előrejelzés és optimalizálás.

### 2.4 Nem cél (egyelőre)

Pénzügyi könyvelés, számlázás és teljes webshop-motor. A mesterséges intelligencia alapú funkciók (kereslet-előrejelzés, utánpótlás- és putaway-optimalizálás) csak későbbi ötletek, nem aktuális terv.

## 3. Követelmények

### 3.1 Funkcionális

| Terület | Követelmény | Állapot |
| --- | --- | --- |
| Törzsadatok | Kategória (fa), márka, beszállító, termék, variáns (szín, méret, ár), vonalkódok | Kész (a vonalkód-kezelő modul még hiányzik) |
| Lokációk | Raktár/bolt → zóna → polc fa, szabályozott elhelyezéssel | Folyamatban |
| Készlet | Készlet variánsonként és lokációnként, foglalással, minimum/maximum szinttel | Séma kész, modul tervezett |
| Készletmozgás | Append-only napló, előjeles mennyiséggel | Séma kész, modul tervezett |
| Beszerzés | Beszállítói rendelések, beérkeztetés | Tervezett |
| Átadás | Lokációk közti transzfer | Tervezett |
| Leltár | Lokációnkénti leltárfolyamat jóváhagyással | Tervezett |
| RMA | Visszaküldések kezelése | Tervezett |
| Felhasználók | Fiókok, szerepkörök, hierarchia-szabályok | Kész |
| Webshop | Készletszinkron API-n át | Tervezett |
| PDA | Szkennelés-alapú munkafolyamatok | Tervezett |

### 3.2 Nem funkcionális

- **Adatintegritás:** a készletmozgások csak hozzáadhatók, a mennyiség a mozgások összegéből levezethető. A törlést az adatbázis külső kulcsai korlátozzák.
- **Biztonság:** jelszavak bcrypt-tel hash-elve, JWT alapú hitelesítés, szerver oldali jogosultság-ellenőrzés minden végponton.
- **Karbantarthatóság:** egységes modulminta, közös típusok a frontend és a backend között.
- **Megbízhatóság:** a szerver és az adatbázis Docker Compose-szal fut majd.

### 3.3 Szerepkörök

| Szerepkör | Jelentés |
| --- | --- |
| `BOSS` | Legmagasabb szint, a bizalmi gyökér. Nem törölhető és nem fokozható le az API-n át. |
| `ADMIN` | Rendszergazda, az alacsonyabb szerepkörök kezelője. |
| `WAREHOUSE_MANAGER` | Raktárvezető. |
| `WAREHOUSE_STAFF` | Raktáros. |
| `STORE_MANAGER` | Boltvezető. |
| `STORE_STAFF` | Bolti dolgozó. |
| `ORDER_CLERK` | Rendelés-ügyintéző. |
| `RMA_CLERK` | Visszáru- és vevőszolgálati ügyintéző. |

A `BOSS` szándékosan nem kap automatikusan mindenhez hozzáférést, minden végponton külön, kifejezetten kell felvenni.

## 4. Architektúra

### 4.1 Szerkezet

Monorepo, npm workspaces-szel:

```
wmanager/
├── apps/
│   ├── backend/        NestJS API + Prisma
│   └── frontend/       Vue 3 alkalmazás
├── packages/
│   └── shared-types/   közös TypeScript típusok (enumok, adatmodell-interfészek)
├── docker-compose.yml  PostgreSQL
└── tsconfig.base.json
```

### 4.2 Technológiák

| Réteg | Választás |
| --- | --- |
| Backend | NestJS, TypeScript |
| ORM és adatbázis | Prisma 7, PostgreSQL 17 (Docker Compose) |
| Hitelesítés | JWT (passport-jwt), bcrypt |
| Frontend | Vue 3, TypeScript, Vite, Pinia, vue-router, PrimeVue, Tailwind |
| Üzemeltetés | Docker Compose (tervezett) |
| Eszközök | Cursor, Postman, GitHub |

### 4.3 A backend rétegei

Egy kérés útja: **Controller → Service → PrismaService → PostgreSQL**.

- A **Controller** a route-okat és a jogosultságot adja (`@UseGuards`, `@Roles`).
- A **Service** az üzleti logika. A legtöbb egyszerű modul a közös `BaseService<TDelegate>` osztályból örököl (`findAll`, `findOne`, `create`, `update`, `remove`), és csak ott ír felül, ahol extra szabály kell.
- A **DTO** osztályok csak azokat a mezőket tartalmazzák, amiket a kliensnek küldenie kell. A globális `ValidationPipe` (`whitelist` és `forbidNonWhitelisted`) eldobja vagy elutasítja a többit.
- A globális **`PrismaExceptionFilter`** a Prisma hibáit HTTP válaszokká fordítja: `P2025` → 404, `P2002` → 409, `P2003` → 409 törlésnél (még hivatkoznak rá), egyébként 400.

### 4.4 A közös típuscsomag

A `@wmanager/shared-types` a frontend és a backend közös szerződése. A típusai szándékosan laposak: kapcsolatot csak azonosítóval fejeznek ki, mert így nincs körkörös JSON és nem nőnek korlátlanul az API-válaszok. A kapcsolódó adatokat külön típusok viszik (például `ProductWithVariants`). A dátumok szövegként utaznak.

## 5. Adatmodell

### 5.1 Főbb entitások

| Terület | Modellek |
| --- | --- |
| Törzsadat | `Category` (fa), `Brand`, `Supplier`, `Product`, `Variant`, `VariantBarcode` |
| Hely | `Location` (fa) |
| Készlet | `StockItem`, `StockMovement` |
| Folyamatok | `PurchaseOrder`, `StockTransfer`, `StocktakeSession`, `SalesOrder`, `ReturnCase`, `ReturnCaseItem` |
| Felhasználó | `User`, `Role` enum |

### 5.2 Fontos tervezési döntések

- **Termék és variáns szétválasztva:** a terméknek (`Product`) közös adatai vannak (név, márka, anyag, áfa), a variáns (`Variant`) a konkrét eladható egység (szín, méret, SKU, ár). A színek listaként tárolódnak, így egy variáns többszínű is lehet.
- **Egy cikkszám, több vonalkód:** a `Variant.sku` egyedi, a vonalkódok külön táblában vannak, `isPrimary` jelzővel, és egy vonalkód csak egy variánsra mutathat.
- **A `StockItem` a készlet pillanatképe:** variáns és lokáció páronként egy sor (egyedi kényszerrel), `quantity`, `reservedQuantity`, valamint helyenként külön minimum- és maximumszint. A ténylegesen elérhető mennyiség: `quantity − reservedQuantity`.
- **A `StockMovement` a rendszer naplója:** append-only, nincs `updatedAt`, a mennyiség előjeles (+ bevét, − kiadás), egy sor egy variánsra és egy lokációra vonatkozik. Az ok típusa a `MovementType` (`PURCHASE_RECEIPT`, `SALE`, `TRANSFER_IN`, `TRANSFER_OUT`, `STOCKTAKE_ADJUSTMENT`, `RETURN_RESTOCK`, `MANUAL_CORRECTION`). A kapcsolódó dokumentumra típusos, opcionális külső kulcsok mutatnak (rendelés, eladás, leltár, transzfer, RMA), egyszerre egy kitöltve.
- **Több tétel egy dokumentumban:** egy többtételes beérkezés tételenként egy-egy mozgássort ad, közös dokumentum-azonosítóval. Egy transzfer két sort: egy kivételt a forrásnál, egy betételt a célnál.
- **Kapcsolótábla, ahol saját adat van:** például `ReturnCaseItem`, hogy a visszaküldött termék már a vizsgálat előtt rögzíthető legyen.
- **A beérkeztetés két lépésre bontása** (átvétel, majd tárolóhelyre rakás) tervezett, a jelenlegi séma még az egylépéses `PURCHASE_RECEIPT`-et tartalmazza.

### 5.3 A `Location` fa szabályai

| Típus | Szülő | `slotMode` |
| --- | --- | --- |
| `WAREHOUSE`, `STORE` | nincs (gyökér) | nem adható meg |
| `ZONE` | `WAREHOUSE` vagy `STORE` | megadható |
| `SHELF` | csak `ZONE` | megadható |

A `type` létrehozás után nem módosítható, az áthelyezés (más szülő) igen. A szülő törlése megakadályozott, amíg vannak gyerekei (`onDelete: Restrict`). A `slotMode` (`DEDICATED` vagy `MIXED`) azt mondja meg, hogy a hely egyetlen termékfajtának van-e fenntartva.

## 6. Hitelesítés és jogosultság

### 6.1 Bejelentkezés

- `POST /auth/login`: e-mail és jelszó alapján JWT-t ad (9 óra érvényességgel). Hibás e-mail és hibás jelszó ugyanazt az üzenetet kapja, hogy ne lehessen kitalálni, mely e-mail létezik. Inaktív fiók nem léphet be.
- `GET /auth/me`: a bejelentkezett felhasználó adatai, az aktuális adatbázis-állapot szerint.
- A `JwtStrategy.validate()` **minden kérésnél lekéri a felhasználót az adatbázisból**: törölt vagy inaktív fiók azonnal elveszti a hozzáférését, és a szerepkör mindig friss, nem a tokenből jön.

### 6.2 Végpontok védelme

A minta: osztályszintű `@UseGuards(JwtAuthGuard, RolesGuard)`, az írási végpontokon `@Roles(...)`. Olvasni általában bármelyik bejelentkezett felhasználó tud.

**Figyelem (fail-open):** ha egy új írási végpontról lemarad a `@Roles`, az nem hibát ad, hanem mindenki számára elérhetővé válik. A `@Roles` csak a `RolesGuard`-dal együtt hat.

### 6.3 Felhasználók hierarchiája

- ADMIN és BOSS fiókot (létrehozás, módosítás, törlés) **csak BOSS** kezelhet, az ADMIN az alacsonyabb szerepköröket.
- A BOSS nem törölhető és a szerepköre nem módosítható az API-n át.
- Az utolsó ADMIN nem törölhető.
- A jelszó nem módosítható a sima PATCH-csel, és a `passwordHash` semelyik válaszban nem jelenik meg.
- A szabályt az `assertCanManage(actor, szerepkör)` segédmetódus érvényesíti, a kérőt a `@CurrentUser()` dekorátor adja.

### 6.4 Tervezett: felhasználó–hely hozzárendelés

Egy kapcsolótábla (`UserLocation`) rendeli a dolgozókat `STORE` vagy `WAREHOUSE` gyökérhez (több hely is lehet). A hozzáférés a hozzárendelt gyökér alatti teljes fára érvényes, a helyhez nem kötött szerepkörök (`ADMIN`, `BOSS`, `ORDER_CLERK`, `RMA_CLERK`) korlátozás nélkül látnak. Amíg ez nincs meg, a boltvezető nem kezelhet lokációkat, mert nem lehet a saját helyére korlátozni. Ezt a készlet-végpontok előtt kell megcsinálni.

## 7. API-áttekintés

| Útvonal | Tartalom | Állapot |
| --- | --- | --- |
| `/auth` | `login`, `me` | Kész |
| `/users` | felhasználók, hierarchia-szabályokkal | Kész |
| `/categories` | kategóriafa | Kész |
| `/brands` | márkák (név egyedi) | Kész |
| `/suppliers` | beszállítók | Kész |
| `/products` | termékek | Kész |
| `/variants` | variánsok (cikkszám egyedi) | Kész |
| `/locations` | lokációfa | Folyamatban |

A pontos szerepkörök a controllerek `@Roles` dekorátoraiban találhatók, az a kód az igazság forrása. Az útvonalak többes számúak.

## 8. Fejlesztői útmutató

### 8.1 Környezet indítása

Előfeltétel: Node.js 22, Docker.

```
npm install
docker compose up -d
cd apps/backend
npx prisma migrate dev
npx prisma generate
npm run start:dev
```

A szerver alapértelmezetten a 4001-es porton fut.

### 8.2 Környezeti változók

| Fájl | Változók |
| --- | --- |
| `.env` (gyökér) | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` |
| `apps/backend/.env` | `DATABASE_URL`, `JWT_SECRET`, `PORT` (opcionális) |
| `apps/frontend/.env` | `VITE_API_URL` |

Az `.env` fájlok nem kerülnek verziókezelésbe.

### 8.3 Prisma 7 sajátosságok

A generátor beállítása a `schema.prisma`-ban:

```
generator client {
  provider            = "prisma-client"
  output              = "../src/generated/prisma"
  moduleFormat        = "cjs"
  importFileExtension = "ts"
}
```

- A kapcsolat a `prisma.config.ts`-ben van, nem a sémában, és a futásidejű klienshez meghajtóadapter kell (`@prisma/adapter-pg`).
- A generált kód a `@prisma/client` futásidejű csomagot is használja, ezért azt telepítve kell tartani.
- A `@default(uuid())` a Prisma kliens oldalán generálódik, ezért Prisma Studióban kézzel felvett sornak nem lesz azonosítója. Sorokat az API-n át érdemes létrehozni.
- Az `npx prisma ...` parancsokat az `apps/backend` mappából kell futtatni, az `npm ... --workspace=...` parancsokat a gyökérből.

### 8.4 Gyakori hibák

| Tünet | Ok |
| --- | --- |
| `exports is not defined in ES module scope` | hiányzik a `moduleFormat = cjs` |
| `Cannot find module './internal/class.js'` | hiányzik az `importFileExtension = ts` |
| `Cannot find module '@prisma/client/runtime/client'` | nincs telepítve az `@prisma/client` |
| A `ts-node-dev` összeomlik | a backendben TypeScript 5.x kell, a 7.x nem kompatibilis |
| `Cannot read properties of undefined` egy service konstruktorában | hiányzik az `@Injectable()` |
| 500-as válasz | a részletes hiba a `start:dev` terminálban van, nem a válaszban |
| `ECONNREFUSED` | nem fut a PostgreSQL konténer (`docker compose up -d`) |

### 8.5 Új modul létrehozása (recept)

1. Prisma modell és migráció (`npx prisma migrate dev --name ...`), majd `npx prisma generate`.
2. `CreateXDto` (csak a kliens által küldött mezők, validációs dekorátorokkal) és `UpdateXDto` (`PartialType`, szükség szerint `OmitType`).
3. `XService extends BaseService<PrismaService['x']>`, `@Injectable()`-lel. Ha egy felülírt metódus szignatúrája eltér az ősétől, adj neki új nevet.
4. `XController` többes számú útvonallal, `@UseGuards(JwtAuthGuard, RolesGuard)` az osztályon, `@Roles(...)` az írásokon.
5. `XModule`, és felvétel az `AppModule`-ba.
6. Típusellenőrzés (`npx tsc --noEmit` az `apps/backend` mappában, mert a fejlesztői szerver nem ellenőriz típusokat) és tesztelés Postmanben.

### 8.6 Konvenciók

- A DTO-ban csak a kliens által megadható mezők szerepelnek, soha nem az `id`, az időbélyegek vagy a jelszó-hash.
- Az adatbázis védi a törlést: kötelező kapcsolatnál a hivatkozott rekord nem törölhető. Opcionális önhivatkozásnál (`parentId`) a Prisma alapértelmezése `SetNull`, ezért ott kifejezetten `onDelete: Restrict` kell.
- Elnevezés: camelCase mezők, többes számú útvonalak, kisbetűs mappanevek (a kis- és nagybetű számít Linuxon).
- Az ágkezelés: a fejlesztés a `dev` ágon folyik.

## 9. Ismert hiányosságok és technikai adósság

- A generált Prisma kliens (`src/generated/prisma`) bekerült a repóba, és a `.gitignore` nem fedi le. Töröld a követésből, és vedd fel a `.gitignore`-ba.
- A `Category.parentId` törlési viselkedése még `SetNull` (a gyerekkategóriák árván maradnának).
- A `GET /users` jogosultsága nem egységes a `GET /users/:id`-vel.
- A `LocationModule` regisztrációja és a `STORE_MANAGER` szerepköre a lokáció-írásoknál tisztázandó.
- Nyitott döntés: létrehozható legyen-e BOSS az API-n át, vagy csak az adatbázisban (egyetlen BOSS).
- Az `npm audit` több magas súlyosságú jelzést mutat, éles üzem előtt át kell nézni.
- A kényszerített kijelentkeztetés (jelszócsere után minden token érvénytelenítése) még nincs.
- Nincs automatizált teszt, a tesztelés Postman-gyűjteményekkel kézzel történik (a `Location`-höz van egy futtatható gyűjtemény). Érdemes tesztet írni arra, hogy minden írási végponton van `@Roles`.
- A frontend váz átnézése után ajánlott javítások: `401` kezelés a kérések után, a JWT kézi dekódolása helyett a `GET /auth/me` használata.

## 10. Ütemterv

| Szakasz | Tartalom |
| --- | --- |
| **Kész** | Monorepo, közös típusok, adatmodell, hitelesítés, jogosultság, felhasználók, törzsadat-modulok, frontend váz |
| **Most** | Lokációkezelés lezárása és tesztelése |
| **Következő** | Felhasználó–hely hozzárendelés, majd készlet (`StockItem`) és tárolóhelyre rakás (`StockMovement` egy tranzakcióban) |
| **Utána** | Leltár, transzfer, beszerzés, RMA, frontend funkciók (lokációfa, készletnézet) |
| **Később** | PDA-munkafolyamatok, webshop-szinkron, telepítés Hetznerre, játékos elemek, előrejelzés |

A tárolóhelyre rakás (putaway) nem sima CRUD: egy tranzakcióban kell frissíteni a `StockItem`-et és beírni a `StockMovement` sort, hogy a két adat ne csúszhasson szét.

## 11. Fogalomtár

| Fogalom | Jelentés |
| --- | --- |
| WMS | Raktárkezelő rendszer |
| SKU | Cikkszám, egy variáns egyedi azonosítója |
| Variáns | Egy termék konkrét, eladható változata (szín, méret) |
| Lokáció | Bármely hely a fában: raktár, bolt, zóna vagy polc |
| Putaway | Az átvett áru tárolóhelyre rakása |
| Leltár | A tényleges és a nyilvántartott készlet összevetése |
| RMA | Visszaküldött áru kezelési folyamata |
| PDA | Kézi, vonalkódolvasós terminál (itt Zebra Android) |
| DataWedge | A Zebra szolgáltatás, ami a szkennelt kódot billentyűleütésként küldi az alkalmazásnak |
| Append-only | Csak hozzáfűzhető napló: a meglévő sorok nem módosíthatók |
| DTO | A kliens és a szerver közt utazó adat alakját leíró osztály |
