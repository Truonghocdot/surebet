# Deploy Production

Stack production nay dung:

- `tykfk.site` -> frontend Next.js
- `api.tykfk.site` -> backend Go API + websocket
- `telegram-worker` -> worker Go gui Telegram tu queue
- `admin.tykfk.site` -> Laravel Filament admin + Telegram webhook
- PostgreSQL cho du lieu
- 5 collector worker rieng cho 8xbet va Jun88
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
- `TELEGRAM_BOT_TOKEN` neu bat thong bao Telegram
- `COLLECTOR_PROXY_*` neu collector can proxy

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
docker compose -f deploy/production/docker-compose.yml --env-file deploy/production/.env logs -f telegram-worker
```

Restart rieng collector:

```bash
docker compose -f deploy/production/docker-compose.yml --env-file deploy/production/.env restart collector-8xbet
docker compose -f deploy/production/docker-compose.yml --env-file deploy/production/.env restart collector-jun88-bti collector-jun88-ibc collector-jun88-cmd collector-jun88-m8
```

Webhook Telegram:

- URL: `https://admin.tykfk.site/api/telegram/webhook`
- Secret header: `X-Telegram-Bot-Api-Secret-Token`
- Gia tri secret lay tu `TELEGRAM_WEBHOOK_SECRET`

Set webhook:

```bash
curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -d "url=https://admin.tykfk.site/api/telegram/webhook" \
  -d "secret_token=${TELEGRAM_WEBHOOK_SECRET}"
```

## Ghi chu

- Volume `collector-tmp` giu lai cache proxy va debug artifacts cua collector qua cac lan restart container.
- Backend API va collector noi bo noi voi nhau qua network Docker, khong mo cong rieng ra Internet.
- Compose production co gan san DNS public `1.1.1.1` va `8.8.8.8` cho cac container can ra Internet. Viec nay tranh loi `lookup ... on 127.0.0.53:53: connection refused` khi host dung `systemd-resolved`.
