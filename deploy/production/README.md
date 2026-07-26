# Deploy Production

Stack production nay dung:

- `tykfk.site` -> frontend Next.js
- `api.tykfk.site` -> backend Go API + websocket
- `admin.tykfk.site` -> Laravel Filament admin
- PostgreSQL cho du lieu
- 2 collector worker rieng cho 8xbet va Jun88 CMD
- `Caddy` de reverse proxy va tu cap TLS

## Chuan bi server

1. Tro DNS `A` record cua `tykfk.site`, `api.tykfk.site`, `admin.tykfk.site` ve cung IP server.
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
- `LARAVEL_APP_KEY`
- `SEED_FRONTEND_USER_PASSWORD`
- `SEED_SUPER_ADMIN_PASSWORD`
- `TELEGRAM_BOT_TOKEN` neu giu webhook dong bo metadata Telegram
- `COLLECTOR_PROXY_*` neu collector can proxy

Mac dinh production dang de:

- `LARAVEL_SESSION_DRIVER=file`
- `LARAVEL_CACHE_STORE=file`

de Filament admin khong phu thuoc vao bang `sessions` va `cache`.

Tao `LARAVEL_APP_KEY` neu chua co:

```bash
docker run --rm php:8.3-cli php -r 'echo "base64:".base64_encode(random_bytes(32)).PHP_EOL;'
```

## Build va chay

Build image:

```bash
docker compose -f deploy/production/docker-compose.yml --env-file deploy/production/.env build
```

Khoi dong stack:

```bash
docker compose -f deploy/production/docker-compose.yml --env-file deploy/production/.env up -d
```

Chay migrate va seed Laravel:

```bash
docker compose -f deploy/production/docker-compose.yml --env-file deploy/production/.env --profile tools run --rm laravel-cli php artisan migrate --seed --force
```

## Lenh huu ich

Xem log:

```bash
docker compose -f deploy/production/docker-compose.yml --env-file deploy/production/.env logs -f caddy backend-api frontend laravel-admin
```

Restart rieng collector:

```bash
docker compose -f deploy/production/docker-compose.yml --env-file deploy/production/.env restart collector-8xbet collector-jun88-cmd
```

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

Webhook Telegram:

- URL: `https://api.tykfk.site/api/telegram/webhook`
- Secret header: `X-Telegram-Bot-Api-Secret-Token`
- Gia tri secret lay tu `TELEGRAM_WEBHOOK_SECRET`

Set webhook:

```bash
curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -d "url=https://api.tykfk.site/api/telegram/webhook" \
  -d "secret_token=${TELEGRAM_WEBHOOK_SECRET}"
```

## Ghi chu

- Volume `collector-tmp` giu lai cache proxy va debug artifacts cua collector qua cac lan restart container.
- Backend API va collector noi bo noi voi nhau qua network Docker, khong mo cong rieng ra Internet.
- Telegram webhook production nen tro ve `backend-api`, khong can di qua `laravel-admin`.
- Compose production co gan san DNS public `1.1.1.1` va `8.8.8.8` cho cac container can ra Internet. Viec nay tranh loi `lookup ... on 127.0.0.53:53: connection refused` khi host dung `systemd-resolved`.
