# WManager telepítése Proxmoxra (Docker + GitHub Actions Auto-Deploy)

Ez a leírás végigvezet azon, hogyan tudod a **WManager** projektet futtatni a Proxmox szervereden úgy, hogy minden `main` branch-re történő feltöltés (`git push` / merge) után **automatikusan frissüljön**.

---

## 1. LXC konténer vagy VM létrehozása a Proxmoxon

1. Hozz létre a Proxmoxon egy **Debian 12** vagy **Ubuntu 24.04** alapú VM-et vagy LXC konténert (ajánlott: min. **2 vCPU**, **2–4 GB RAM**, **20 GB tárhely**).
   - *Ha LXC konténert használsz:* a konténer **Options -> Features** menüjében kapcsold be a **Nesting** opciót (a Dockerhez szükséges).
2. Lépj be SSH-n (vagy a Proxmox Console-on), és telepítsd a Dockert, valamint hozz létre egy nem-root felhasználót a GitHub Runnernek:

```bash
apt update && apt install -y ca-certificates curl git sudo openssl

# Docker hivatalos telepítése
curl -fsSL https://get.docker.com | sh

# Felhasználó létrehozása a GitHub Actions Runner számára
useradd -m -s /bin/bash deployer
usermod -aG docker deployer
```

---

## 2. Környezeti változók (`/opt/wmanager/.env`) beállítása a szerveren

A titkos jelszavak és kulcsok nem kerülnek fel a GitHubra, hanem biztonságosan a Proxmox szerveren maradnak a `/opt/wmanager/.env` fájlban:

```bash
mkdir -p /opt/wmanager

cat <<EOF > /opt/wmanager/.env
POSTGRES_USER=wmanager
POSTGRES_PASSWORD=$(openssl rand -hex 16)
POSTGRES_DB=wmanager
JWT_SECRET=$(openssl rand -hex 32)
ADMIN_EMAIL=admin@wmanager.local
ADMIN_PASSWORD=ValasszErosJelszot123!
ADMIN_NAME=Admin
APP_PORT=80
EOF

chown -R deployer:deployer /opt/wmanager
chmod 600 /opt/wmanager/.env
```

> **Tipp:** Nézd meg vagy szerkeszd a generált fájlt a `nano /opt/wmanager/.env` paranccsal, hogy biztosan tudd a belépési `ADMIN_EMAIL` és `ADMIN_PASSWORD` párost! Az első indításkor (üres adatbázisnál) a rendszer automatikusan létrehozza ezt a `BOSS` jogosultságú fiókot.

---

## 3. GitHub Self-Hosted Runner összekötése (egyszeri beállítás)

1. Nyisd meg a GitHub repódat: `https://github.com/kristaly-C/wmanager`
2. Menj a **Settings -> Actions -> Runners -> New self-hosted runner** menüpontra.
3. Válaszd ki a **Linux** rendszert és az **x64** architektúrát.
4. Válts át a `deployer` felhasználóra a Proxmox gépen, és hozd létre a runner mappáját:
   ```bash
   su - deployer
   ```
5. Másold be és futtasd a GitHub oldalon látható **Download** és **Configure** parancsokat (ez létrehozza az `~/actions-runner` mappát; a kérdéseknél nyomhatsz mindenre *Enter*-t az alapértelmezett értékekhez).
6. **Fontos:** Ne simán `./run.sh`-val indítsd el, hanem lépj vissza `root`-ba (`exit`), és telepítsd háttérszolgáltatásként (systemd service), hogy a Proxmox újraindítása után is automatikusan fusson:
   ```bash
   exit
   cd /home/deployer/actions-runner
   ./svc.sh install deployer
   ./svc.sh start
   ```

---

## 4. Kész! Hogyan működik a frissítés ezután?

1. Amint a jelenlegi változtatásokat felküldöd / be-merge-eled a `main` branch-re (vagy a GitHub **Actions -> Deploy to Proxmox -> Run workflow** gombbal kézzel elindítod):
   - A Proxmox szervereden futó runner lehúzza az új kódot,
   - Újraépíti a `backend` és `frontend` Docker image-eket,
   - Elindítja a PostgreSQL 17 adatbázist,
   - Automatikusan lefuttatja a Prisma adatbázis migrációkat (`prisma migrate deploy`),
   - Elindítja az alkalmazást.
2. Nyisd meg böngészőből (vagy PDA-ról a helyi hálózaton):
   - `http://<PROXMOX_KONTAINER_IP>` (ha az `APP_PORT=80`), és az Nginx automatikusan kiszolgálja a Vue frontendet, az `/api/*` hívásokat pedig továbbítja a NestJS backendnek.

---

## Hasznos parancsok a szerveren (hibakereséshez / naplókhoz)

```bash
# Konténerek állapotának ellenőrzése
docker compose -p wmanager --env-file /opt/wmanager/.env -f /opt/wmanager/docker-compose.prod.yml ps

# Élő logok követése (backend + frontend + postgres)
docker compose -p wmanager --env-file /opt/wmanager/.env -f /opt/wmanager/docker-compose.prod.yml logs -f
```
