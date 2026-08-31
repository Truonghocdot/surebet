# Deploy Production

Stack production nay dung:

- `tykfk.site` -> frontend Next.js
- `api.tykfk.site` -> backend Go API + websocket
- PostgreSQL cho du lieu
- 2 collector worker rieng cho 8xbet va Jun88 CMD
- Laravel CLI chi chay theo profile `tools` khi migrate, seed hoac don du lieu
- `Caddy` de reverse proxy va tu cap TLS

## Chuan bi server

1. Tro DNS `A` record cua `tykfk.site` va `api.tykfk.site` ve cung IP server.
2. Cai Docker Engine va Docker Compose plugin.
3. Clone repo len server.
4. Tat web server mac dinh neu dang chiem cong `80/443`, vi stack nay dung `Caddy`:

```bash
systemctl disable --now nginx
ss -ltnp | grep -E ':(80|443)\s' || true
```

## Chuan bi env

```bash
cd /path/to/surebet
cp deploy/production/.env.example deploy/production/.env
```

Can doi toi thieu:

- `POSTGRES_PASSWORD`
- `AUTH_TOKEN_SECRET`
- `INTERNAL_API_TOKEN`
- `COLLECTOR_STREAM_JUN88_TOKEN` va `COLLECTOR_STREAM_EIGHTXBET_TOKEN` bang hai secret khac nhau
- `SEED_FRONTEND_USER_PASSWORD`
- `SEED_SUPER_ADMIN_PASSWORD`
- `CMD_RECONCILE_SETTLE_MS=1500` de reconcile cho DOM render on dinh truoc khi doc lai
- `AUTO_BET_MODE=off` de tat, `simulation` de mo phong, `dry-run` de chi chuan bi betslip, `live` de cho phep luong that.
- `AUTO_BET_TOTAL_STAKE_VND` la tong von toi da cho mot cap cuoc.
- Jun88 co dinh `1 VD = 1.000 VND`; 8xbet dung truc tiep gia tri VND tren site.

## Build va chay

Build image:

```bash
docker compose -f deploy/production/docker-compose.yml --env-file deploy/production/.env build
```

Khoi dong stack:

```bash
docker compose -f deploy/production/docker-compose.yml --env-file deploy/production/.env up -d --remove-orphans
```

Chay migrate va seed Laravel:

```bash
docker compose -f deploy/production/docker-compose.yml --env-file deploy/production/.env --profile tools run --rm laravel-cli php artisan migrate --seed --force
```

Migration `2026_08_14_000011_create_live_bet_execution_tables.php` tao `bet_attempts`, `bet_exposures`, event journal va nang cap `bet_actions` theo cach idempotent.

Muc theo doi van han nam tai `/auto-bet`. BFF frontend dung `INTERNAL_API_TOKEN` server-side; khong dua token nay vao bien `NEXT_PUBLIC_*`.

Sau rollout nay, `--remove-orphans` se dung va xoa container `laravel-admin` cu.
Neu Caddy dang chay tu deploy truoc, recreate de nap Caddyfile khong con domain admin:

```bash
docker compose -f deploy/production/docker-compose.yml --env-file deploy/production/.env up -d --force-recreate caddy
```

## Lenh huu ich

Xem log runtime:

```bash
docker compose -f deploy/production/docker-compose.yml --env-file deploy/production/.env logs -f caddy backend-api frontend collector-8xbet collector-jun88-cmd
```

Restart rieng collector:

```bash
docker compose -f deploy/production/docker-compose.yml --env-file deploy/production/.env restart collector-8xbet collector-jun88-cmd
```

## Jun88 CMD network

Ca hai collector ket noi truc tiep den bookmaker.

Sau moi lan doi, chi restart collector CMD va theo doi cung mot khoang thoi gian:

```bash
docker compose -f deploy/production/docker-compose.yml --env-file deploy/production/.env restart collector-jun88-cmd
docker compose -f deploy/production/docker-compose.yml --env-file deploy/production/.env logs --since=10m collector-jun88-cmd \
  | grep -E 'snapshot mode=|timing reconcile_ms'
```

So sanh `status`, ty le `fixtures=stable/observed`, `elapsed_ms`, `fingerprint_ms`, `parse_ms`, `settle_ms` va `source_lag_ms` de phat hien DOM parse bi block.

## Rollout odds state v2

### 1. Chay bridge v1 trong production

Giu cau hinh sau trong `deploy/production/.env`:

```dotenv
ODDS_STATE_PROTOCOL=v1
```

Build va recreate `backend-api`. `fixture_observed_batch` v2 se refresh freshness
cua quote v1 chi khi fixture, market, outcome, line, odds, batch va fingerprint
khop voi snapshot v2 coherent. Market da bi xoa, suspended hoac doi line se khong
duoc bridge giu song.

```bash
docker compose -f deploy/production/docker-compose.yml --env-file deploy/production/.env build backend-api
docker compose -f deploy/production/docker-compose.yml --env-file deploy/production/.env up -d --no-deps backend-api
```

### 2. Theo doi shadow tu 7 den 14 ngay

Chay report hang ngay:

```bash
deploy/production/report-odds-v3-shadow.sh
```

Chi chuyen sang v2 khi ca `8xbet:default` va `jun88:cmd` deu co
`ready_for_v2: true` lien tuc. Report ap dung cac nguong:

- theo doi toi thieu 7 ngay;
- 100% batch accepted la complete;
- mismatch, ke ca outcome thieu o mot trong hai namespace, nho hon 0.1%;
- it nhat 20 latency sample trong cua so 30 phut;
- p95 collector-to-backend khong qua 500 ms.

Co the doc mot source truc tiep khi can debug:

```bash
docker compose -f deploy/production/docker-compose.yml --env-file deploy/production/.env exec -T redis \
  redis-cli HGETALL odds:v3:shadow:metrics:8xbet:default
docker compose -f deploy/production/docker-compose.yml --env-file deploy/production/.env exec -T redis \
  redis-cli HGETALL odds:v3:shadow:metrics:jun88:cmd
```

### 3. Chuyen read path sang v2

Sau khi hai source dat nguong, doi bien moi truong va recreate backend:

```dotenv
ODDS_STATE_PROTOCOL=v2
```

```bash
docker compose -f deploy/production/docker-compose.yml --env-file deploy/production/.env up -d --no-deps --force-recreate backend-api
```

Bridge v1 tu dong tat khi backend doc v2. Neu can rollback trong chu ky theo doi,
doi lai `ODDS_STATE_PROTOCOL=v1` va recreate `backend-api`.

### 4. Cleanup sau khi v2 stable

Chi o mot deploy sau, khi v2 da chay on dinh het cua so rollback, moi xoa bridge
trong `ObserveFixtureBatches` va duong `quote_upsert` v1. Truoc khi xoa, xac nhan
khong con consumer nao doc namespace `odds:v2` hoac frame protocol v1.

## Ghi chu

- Volume `collector-tmp` giu lai cache proxy va debug artifacts cua collector qua cac lan restart container.
- Backend API va collector noi bo noi voi nhau qua network Docker, khong mo cong rieng ra Internet.
- Compose production co gan san DNS public `1.1.1.1` va `8.8.8.8` cho cac container can ra Internet. Viec nay tranh loi `lookup ... on 127.0.0.53:53: connection refused` khi host dung `systemd-resolved`.
