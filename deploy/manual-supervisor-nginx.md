# Deploy manual bang supervisor + nginx

Tai lieu nay dung cho kieu cai tay tung phan, khong dung Docker, khong chay script deploy tong.
Muc tieu la:

- `tykfk.site` -> frontend Next.js
- `api.tykfk.site` -> backend Go API + websocket
- `admin.tykfk.site` -> Laravel admin
- `telegram-worker` -> worker Go doc queue va gui Telegram
- `collector-8xbet` va `collector-jun88-cmd` -> 2 worker rieng, chay qua supervisor
- reverse proxy bang `nginx`

Huong dan ben duoi target Ubuntu 24.04. Neu VPS cua ban khac ban Ubuntu nay thi ten package co the khac.

## 1. Cai tung package he thong

Cap nhat danh sach package:

```bash
sudo apt update
```

Cai tung package nen:

```bash
sudo apt install -y curl
sudo apt install -y git
sudo apt install -y unzip
sudo apt install -y ca-certificates
sudo apt install -y supervisor
sudo apt install -y nginx
sudo apt install -y redis-server
sudo apt install -y postgresql
sudo apt install -y postgresql-contrib
sudo apt install -y build-essential
sudo apt install -y pkg-config
sudo apt install -y php8.3-cli
sudo apt install -y php8.3-pgsql
sudo apt install -y php8.3-xml
sudo apt install -y php8.3-mbstring
sudo apt install -y php8.3-curl
sudo apt install -y php8.3-zip
sudo apt install -y php8.3-intl
sudo apt install -y php8.3-bcmath
sudo apt install -y php8.3-redis
sudo apt install -y composer
```

Bat va cho chay cung he thong:

```bash
sudo systemctl enable --now postgresql
sudo systemctl enable --now redis-server
sudo systemctl enable --now supervisor
sudo systemctl enable --now nginx
```

## 2. Cai Node.js 22

`frontend` va `collector` nen chay Node 22.

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

## 3. Cai Go

Backend hien tai pin `go 1.26.0` trong [backend/go.mod](/home/truonghocdot/study/surebet/backend/go.mod:1).

Kiem tra repo apt cua server co du version hay khong:

```bash
apt-cache policy golang-go
```

Neu repo apt cua server da co `1.26.x` thi cai bang apt:

```bash
sudo apt install -y golang-go
go version
```

Neu repo apt cua server chi co ban cu hon `1.26.x` thi cai Go chinh chu:

```bash
curl -LO https://go.dev/dl/go1.26.0.linux-amd64.tar.gz
sudo rm -rf /usr/local/go
sudo tar -C /usr/local -xzf go1.26.0.linux-amd64.tar.gz
echo 'export PATH=/usr/local/go/bin:$PATH' | sudo tee /etc/profile.d/go.sh >/dev/null
source /etc/profile.d/go.sh
go version
rm -f go1.26.0.linux-amd64.tar.gz
```

## 4. Clone code va tao thu muc runtime

Vi du repo o:

```bash
sudo mkdir -p /var/www/html
sudo chown -R "$USER":"$USER" /var/www/html
cd /var/www/html
git clone <repo-url> surebet
cd /var/www/html/surebet
```

Tao thu muc runtime:

```bash
sudo mkdir -p /etc/surebet
sudo mkdir -p /var/log/surebet
sudo mkdir -p /var/lib/surebet/playwright
sudo chown -R "$USER":"$USER" /var/lib/surebet
sudo chown -R "$USER":"$USER" /var/www/html/surebet
sudo chown -R "$USER":"$USER" /var/log/surebet
```

## 5. Tao file env goc

Dung file nay lam nguon tham chieu:

```bash
cp deploy/production/.env.example deploy/production/.env
nano deploy/production/.env
```

Can sua toi thieu:

- `POSTGRES_PASSWORD`
- `AUTH_TOKEN_SECRET`
- `LARAVEL_APP_KEY`
- `SEED_FRONTEND_USER_PASSWORD`
- `SEED_SUPER_ADMIN_PASSWORD`
- `TELEGRAM_BOT_TOKEN` neu ban dung Telegram
- `NEXT_PUBLIC_BACKEND_API_URL`
- `NEXT_PUBLIC_BACKEND_WS_URL`
- `DOMAIN_FRONTEND`
- `DOMAIN_API`
- `DOMAIN_ADMIN`

## 6. Tao env rieng cho backend

Tao file:

```bash
sudo nano /etc/surebet/backend.env
```

Noi dung mau:

```dotenv
APP_NAME=surebet-platform
APP_ENV=production
AUTH_TOKEN_SECRET=thay-secret-that
AUTH_TOKEN_TTL=12h
HTTP_ADDRESS=127.0.0.1:8080
HTTP_READ_TIMEOUT=15s
HTTP_WRITE_TIMEOUT=15s
POSTGRES_DSN=postgres://surebet:thay-mat-khau@127.0.0.1:5432/surebet?sslmode=disable
REDIS_ADDRESS=127.0.0.1:6379
REDIS_DB=0
REDIS_PASSWORD=
ODDS_STATE_PROTOCOL=v1

EIGHTXBET_BASE_URL=https://8x4455.com
EIGHTXBET_INPLAY_PAGE_URL=https://8x4455.com/sportEvents/inplay/football
JUN88_BASE_URL=https://www.jun888e.ren
JUN88_CMD_PAGE_URL=https://www.jun888e.ren/vi-vn/sports-landing/cmd

COLLECTOR_PROXY_MODE=off
COLLECTOR_PROXY_PROTOCOL=http
COLLECTOR_PROXY_SERVER=
COLLECTOR_PROXY_BYPASS=
COLLECTOR_PROXYXOAY_KEY=

TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
TELEGRAM_API_BASE_URL=https://api.telegram.org
TELEGRAM_REQUEST_TIMEOUT=10s
TELEGRAM_SUREBET_DEDUP_WINDOW=30m
TELEGRAM_QUEUE_POLL_INTERVAL=250ms
TELEGRAM_QUEUE_BATCH_SIZE=25
TELEGRAM_VERIFICATION_MODE=auto
SUREBET_CONFIRM_TIMEOUT=2s
SUREBET_CONFIRM_VALIDITY=2s
SUREBET_CONFIRM_MAX_SKEW=1s
SUREBET_SHADOW_DURATION=30m
SUREBET_SHADOW_MIN_SAMPLES=20
SUREBET_SHADOW_MIN_SUCCESS_RATE=0.80
SUREBET_SHADOW_MAX_P95_LATENCY=1500ms

AUTO_BET=false
MANUAL_CONFIRMATION=true
RISK_VALIDATION=true
MAX_STAKE_CHECK=true
BALANCE_CHECK=true
ODDS_RECHECK=true
LIQUIDITY_CHECK=true
BOOKMAKER_ENABLE=true
```

## 7. Tao env rieng cho frontend

Tao file:

```bash
sudo nano /etc/surebet/frontend.env
```

Noi dung mau:

```dotenv
NODE_ENV=production
BACKEND_API_URL=http://127.0.0.1:8080
NEXT_PUBLIC_BACKEND_API_URL=https://api.tykfk.site
NEXT_PUBLIC_BACKEND_WS_URL=wss://api.tykfk.site/v1/ws
```

## 8. Tao env rieng cho Laravel admin

Tao file:

```bash
sudo nano /etc/surebet/laravel.env
```

Noi dung mau:

```dotenv
APP_NAME="Surebet Data Tools"
APP_ENV=production
APP_KEY=base64:thay-key-that
APP_DEBUG=false
APP_URL=https://admin.tykfk.site
APP_TIMEZONE=Asia/Ho_Chi_Minh
APP_LOCALE=vi
APP_FALLBACK_LOCALE=en
SESSION_DRIVER=file
CACHE_STORE=file

DB_CONNECTION=pgsql
DB_HOST=127.0.0.1
DB_PORT=5432
DB_DATABASE=surebet
DB_USERNAME=surebet
DB_PASSWORD=thay-mat-khau
DB_SSLMODE=disable

REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=

TELEGRAM_WEBHOOK_SECRET=

SEED_FRONTEND_USER_ID=surebet-operator
SEED_FRONTEND_USER_EMAIL=operator@tykfk.site
SEED_FRONTEND_USER_PASSWORD=thay-password-that
SEED_FRONTEND_USER_FULL_NAME="Surebet Operator"
SEED_FRONTEND_USER_ROLE=operator

SEED_SUPER_ADMIN_ID=surebet-super-admin
SEED_SUPER_ADMIN_EMAIL=superadmin@tykfk.site
SEED_SUPER_ADMIN_PASSWORD=thay-password-that
SEED_SUPER_ADMIN_FULL_NAME="Surebet Super Admin"
SEED_SUPER_ADMIN_ROLE=super_admin

ODDS_RETENTION_ACTIVE_HOURS=24
ODDS_RETENTION_FINISHED_MINUTES=30
```

## 9. Tao env rieng cho collector

Tao file:

```bash
sudo nano /etc/surebet/collector.env
```

Noi dung mau:

```dotenv
NODE_ENV=production
BACKEND_API_URL=http://127.0.0.1:8080
PLAYWRIGHT_BROWSERS_PATH=/var/lib/surebet/playwright

EIGHTXBET_BASE_URL=https://8x4455.com
EIGHTXBET_INPLAY_PAGE_URL=https://8x4455.com/sportEvents/inplay/football
JUN88_BASE_URL=https://www.jun888e.ren
JUN88_CMD_PAGE_URL=https://www.jun888e.ren/vi-vn/sports-landing/cmd

COLLECT_HEARTBEAT_MS=15000
COLLECT_STREAM_POLL_MS=300
COLLECT_PAGE_SETTLE_MS=1000

EIGHTXBET_RECONCILE_MS=15000
EIGHTXBET_PAGE_REFRESH_MS=300000
EIGHTXBET_FIXTURE_MAX_AGE_MS=10800000
EIGHTXBET_STREAM_STALE_MS=30000
EIGHTXBET_COVERAGE_GRACE_MS=30000
EIGHTXBET_NAVIGATION_ATTEMPTS=3
EIGHTXBET_NAVIGATION_READY_MS=15000
EIGHTXBET_NETWORK_BOOTSTRAP_MS=10000
EIGHTXBET_ODDS_FORMAT_GATE_MS=5000
EIGHTXBET_METADATA_BOOTSTRAP_MS=5000
EIGHTXBET_BOOTSTRAP_STABLE_MS=1000
EIGHTXBET_SUBSCRIPTION_BATCH_SIZE=4
EIGHTXBET_SUBSCRIPTION_BATCH_DELAY_MS=250
EIGHTXBET_STREAM_TELEMETRY=true
EIGHTXBET_STREAM_TELEMETRY_MS=5000
EIGHTXBET_COVERAGE_TELEMETRY=true
EIGHTXBET_COVERAGE_TELEMETRY_MS=30000

CMD_RECONCILE_MS=30000
CMD_DOM_SCAN_MS=500

COLLECTOR_HEADLESS=true
COLLECTOR_SLOWMO=0
COLLECTOR_BLOCK_HEAVY_RESOURCES=true
COLLECTOR_BLOCK_RESOURCE_TYPES=image,media,font
COLLECTOR_DEBUG_ARTIFACTS=true
COLLECTOR_DEBUG_THROTTLE_MS=60000

COLLECTOR_PROXY_MODE=off
COLLECTOR_PROXY_PROTOCOL=http
COLLECTOR_PROXY_BYPASS=
COLLECTOR_PROXY_CACHE_ENABLED=true
COLLECTOR_PROXY_CACHE_FILE=/var/lib/surebet/proxyxoay-cache.json
COLLECTOR_PROXY_TIMEOUT_MS=10000
COLLECTOR_PROXY_SERVER=
COLLECTOR_PROXYXOAY_KEY=
COLLECTOR_PROXYXOAY_NHAMANG=random
COLLECTOR_PROXYXOAY_TINHTHANH=0
COLLECTOR_PROXYXOAY_WHITELIST=
```

## 10. Tao PostgreSQL user va database

Dung password giong `POSTGRES_DSN` va `laravel.env`:

```bash
sudo -u postgres psql -c "CREATE USER surebet WITH PASSWORD 'thay-mat-khau';"
sudo -u postgres psql -c "CREATE DATABASE surebet OWNER surebet;"
sudo -u postgres psql -c "ALTER ROLE surebet SET client_encoding TO 'UTF8';"
sudo -u postgres psql -c "ALTER ROLE surebet SET default_transaction_isolation TO 'read committed';"
sudo -u postgres psql -c "ALTER ROLE surebet SET timezone TO 'Asia/Ho_Chi_Minh';"
```

Thu ket noi:

```bash
psql "postgres://surebet:thay-mat-khau@127.0.0.1:5432/surebet?sslmode=disable" -c '\dt'
```

## 11. Thu Redis

```bash
redis-cli ping
```

Ket qua mong doi:

```text
PONG
```

## 12. Build backend Go

```bash
cd /var/www/html/surebet/backend
mkdir -p bin
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o bin/api ./cmd/api
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o bin/telegram-worker ./cmd/telegram-worker
```

## 13. Build frontend Next.js

```bash
cd /var/www/html/surebet/frontend
npm ci
set -a
. /etc/surebet/frontend.env
set +a
npm run build
```

## 14. Cai collector dependencies va Chromium

```bash
cd /var/www/html/surebet/collector
npm ci
set -a
. /etc/surebet/collector.env
set +a
npx playwright install --with-deps chromium
```

## 15. Cai Laravel dependencies, migrate va seed

```bash
cd /var/www/html/surebet/laravel
set -a
. /etc/surebet/laravel.env
set +a
composer install --no-dev --no-interaction --prefer-dist --optimize-autoloader
php artisan migrate --force
php artisan db:seed --force
```

## 16. Tao supervisor config

Tao file:

```bash
sudo tee /etc/supervisor/conf.d/surebet.conf >/dev/null <<'EOF'
[group:surebet]
programs=surebet-backend-api,surebet-telegram-worker,surebet-frontend,surebet-laravel-admin,surebet-collector-8xbet,surebet-collector-jun88-cmd

[program:surebet-backend-api]
directory=/var/www/html/surebet/backend
command=/bin/bash -lc 'set -a; . /etc/surebet/backend.env; set +a; exec /var/www/html/surebet/backend/bin/api'
autostart=true
autorestart=true
startsecs=5
stopasgroup=true
killasgroup=true
stopsignal=TERM
stopwaitsecs=20
stdout_logfile=/var/log/surebet/backend-api.log
redirect_stderr=true

[program:surebet-telegram-worker]
directory=/var/www/html/surebet/backend
command=/bin/bash -lc 'set -a; . /etc/surebet/backend.env; set +a; exec /var/www/html/surebet/backend/bin/telegram-worker'
autostart=true
autorestart=true
startsecs=5
stopasgroup=true
killasgroup=true
stopsignal=TERM
stopwaitsecs=20
stdout_logfile=/var/log/surebet/telegram-worker.log
redirect_stderr=true

[program:surebet-frontend]
directory=/var/www/html/surebet/frontend
command=/bin/bash -lc 'set -a; . /etc/surebet/frontend.env; set +a; exec /usr/bin/npm run start -- --hostname 127.0.0.1 --port 3000'
autostart=true
autorestart=true
startsecs=5
stopasgroup=true
killasgroup=true
stopsignal=TERM
stopwaitsecs=20
stdout_logfile=/var/log/surebet/frontend.log
redirect_stderr=true

[program:surebet-laravel-admin]
directory=/var/www/html/surebet/laravel
command=/bin/bash -lc 'set -a; . /etc/surebet/laravel.env; set +a; exec /usr/bin/php artisan serve --host=127.0.0.1 --port=9500'
autostart=true
autorestart=true
startsecs=5
stopasgroup=true
killasgroup=true
stopsignal=TERM
stopwaitsecs=20
stdout_logfile=/var/log/surebet/laravel-admin.log
redirect_stderr=true

[program:surebet-collector-8xbet]
directory=/var/www/html/surebet/collector
command=/bin/bash -lc 'set -a; . /etc/surebet/collector.env; set +a; exec /usr/bin/npm run run:8xbet-worker'
autostart=true
autorestart=true
startsecs=5
stopasgroup=true
killasgroup=true
stopsignal=TERM
stopwaitsecs=30
stdout_logfile=/var/log/surebet/collector-8xbet.log
redirect_stderr=true

[program:surebet-collector-jun88-cmd]
directory=/var/www/html/surebet/collector
command=/bin/bash -lc 'set -a; . /etc/surebet/collector.env; set +a; exec /usr/bin/npm run run:jun88-cmd-worker'
autostart=true
autorestart=true
startsecs=5
stopasgroup=true
killasgroup=true
stopsignal=TERM
stopwaitsecs=30
stdout_logfile=/var/log/surebet/collector-jun88-cmd.log
redirect_stderr=true
EOF
```

Nap lai supervisor:

```bash
sudo supervisorctl reread
sudo supervisorctl update
```

## 17. Tao nginx config

Neu ban da co cert SSL cho 3 domain, tao file:

```bash
sudo tee /etc/nginx/sites-available/surebet.conf >/dev/null <<'EOF'
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

server {
    listen 80;
    listen [::]:80;
    server_name tykfk.site;
    return 301 https://$host$request_uri;
}

server {
    listen 80;
    listen [::]:80;
    server_name api.tykfk.site;
    return 301 https://$host$request_uri;
}

server {
    listen 80;
    listen [::]:80;
    server_name admin.tykfk.site;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name tykfk.site;

    ssl_certificate /etc/letsencrypt/live/tykfk.site/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tykfk.site/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host $host;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name api.tykfk.site;

    ssl_certificate /etc/letsencrypt/live/api.tykfk.site/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.tykfk.site/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name admin.tykfk.site;

    ssl_certificate /etc/letsencrypt/live/admin.tykfk.site/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/admin.tykfk.site/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:9500;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host $host;
    }
}
EOF
```

Enable site:

```bash
sudo ln -sfn /etc/nginx/sites-available/surebet.conf /etc/nginx/sites-enabled/surebet.conf
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

Neu chua co cert, co the cap bang Certbot sau khi da tro DNS:

```bash
sudo apt install -y certbot
sudo apt install -y python3-certbot-nginx
sudo certbot --nginx -d tykfk.site -d api.tykfk.site -d admin.tykfk.site
```

## 18. Start tung service

Start tat ca:

```bash
sudo supervisorctl start surebet-backend-api
sudo supervisorctl start surebet-telegram-worker
sudo supervisorctl start surebet-frontend
sudo supervisorctl start surebet-laravel-admin
sudo supervisorctl start surebet-collector-8xbet
sudo supervisorctl start surebet-collector-jun88-cmd
```

Kiem tra trang thai:

```bash
sudo supervisorctl status
```

## 19. Lenh debug hay dung

Xem log backend:

```bash
sudo tail -f /var/log/surebet/backend-api.log
```

Xem log frontend:

```bash
sudo tail -f /var/log/surebet/frontend.log
```

Xem log 8xbet:

```bash
sudo tail -f /var/log/surebet/collector-8xbet.log
```

Xem log jun88:

```bash
sudo tail -f /var/log/surebet/collector-jun88-cmd.log
```

Restart rieng collector:

```bash
sudo supervisorctl restart surebet-collector-8xbet
sudo supervisorctl restart surebet-collector-jun88-cmd
```

Restart rieng backend:

```bash
sudo supervisorctl restart surebet-backend-api
sudo supervisorctl restart surebet-telegram-worker
```

## 20. Thu nhanh sau khi deploy

Thu health API:

```bash
curl -I http://127.0.0.1:8080/health
curl -I https://api.tykfk.site/health
```

Thu frontend:

```bash
curl -I http://127.0.0.1:3000
curl -I https://tykfk.site
```

Thu admin:

```bash
curl -I http://127.0.0.1:9500
curl -I https://admin.tykfk.site
```

Neu ban muon, buoc tiep theo toi co the tach tiep tai lieu nay thanh:

- mot file rieng chi cho `postgres + redis`
- mot file rieng chi cho `backend + frontend`
- mot file rieng chi cho `collector + supervisor + nginx`

