# Deploy manual bằng root + supervisor + nginx

Tài liệu hướng dẫn triển khai ứng dụng trực tiếp bằng tài khoản `root` trên VPS Ubuntu (khuyến nghị Ubuntu 22.04 / 24.04 LTS).

---

## Giả định hệ thống

- Đăng nhập SSH trực tiếp bằng tài khoản `root`.
- Không tạo thêm user phụ (`deploy`, ...).
- Không dùng Docker / Containerization.
- Mỗi service tự quản lý file cấu hình môi trường `.env` tại thư mục của nó.
- Code dự án được đặt tại: `/var/www/html/surebet`

### Cấu hình Domain & Port (Stack Production)

- **Frontend (Next.js)**: `tykfk.site` -> `127.0.0.1:3000`
- **Backend API & WebSocket (Go)**: `api.tykfk.site` -> `127.0.0.1:8080`
- **Admin Panel (Laravel)**: `admin.tykfk.site` -> `127.0.0.1:9500`
- **Worker Telegram (Go)**: Chạy ngầm qua Supervisor
- **Worker Collector (Node.js/Playwright)**: Chạy 8xbet & jun88-cmd ngầm qua Supervisor
- **Reverse Proxy**: Nginx
- **Process Manager**: Supervisor

---

## 1. Chuẩn bị môi trường & Cài đặt Package cơ bản

Để tránh lỗi tương tác khi chạy bằng `root` (như hỏi Timezone hoặc cấu hình package), thiết lập môi trường không tương tác:

```bash
export DEBIAN_FRONTEND=noninteractive
apt update -y && apt upgrade -y
```

Cài đặt các gói công cụ nền tảng:

```bash
apt install -y \
  software-properties-common \
  ca-certificates \
  curl \
  gnupg \
  lsb-release \
  git \
  unzip \
  build-essential \
  pkg-config \
  supervisor \
  nginx \
  redis-server \
  postgresql \
  postgresql-contrib
```

---

## 2. Cài đặt PHP 8.3 & Composer

### Bước 2.1: Thêm Repository PHP (Ondřej Surý PPA)

```bash
add-apt-repository -y ppa:ondrej/php
apt update -y
```

### Bước 2.2: Cài đặt PHP 8.3 & các Extension cần thiết

```bash
apt install -y \
  php8.3-cli \
  php8.3-pgsql \
  php8.3-xml \
  php8.3-mbstring \
  php8.3-curl \
  php8.3-zip \
  php8.3-intl \
  php8.3-bcmath \
  php8.3-redis
```

Chuyển phiên bản PHP mặc định sang 8.3:

```bash
update-alternatives --set php /usr/bin/php8.3
php -v
```

### Bước 2.3: Cài đặt Composer trực tiếp từ Trang chủ

```bash
curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer
composer --version
```

---

## 3. Cài đặt Node.js 22 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

# Kiểm tra phiên bản
node -v
npm -v
```

---

## 4. Cài đặt Go (1.26.0)

Dự án yêu cầu Go 1.26+. Cài đặt Go bản chính thức vào `/usr/local/go`:

```bash
cd /root
curl -LO https://go.dev/dl/go1.26.0.linux-amd64.tar.gz
rm -rf /usr/local/go
tar -C /usr/local -xzf go1.26.0.linux-amd64.tar.gz
rm -f go1.26.0.linux-amd64.tar.gz

# Thêm Go vào PATH hệ thống cho tất cả session
printf 'export PATH=/usr/local/go/bin:$PATH\n' > /etc/profile.d/go.sh
source /etc/profile.d/go.sh

# Kiểm tra phiên bản Go
go version
```

---

## 5. Bật các Service Hệ thống

```bash
systemctl enable --now postgresql
systemctl enable --now redis-server
systemctl enable --now supervisor
systemctl enable --now nginx
```

---

## 6. Clone Mã nguồn & Tạo thư mục Runtime

```bash
mkdir -p /var/www/html
cd /var/www/html
# Nếu chưa clone thì clone, nếu đã clone rồi thì bỏ qua bước git clone
git clone https://github.com/Truonghocdot/surebet.git surebet || true
cd /var/www/html/surebet

# Tạo thư mục log và lưu trữ dữ liệu Playwright
mkdir -p /var/log/surebet
mkdir -p /var/lib/surebet/playwright
```

---

## 7. Cấu hình Môi trường (.env) cho từng Service

Mỗi service sử dụng file `.env` độc lập nằm trong thư mục của service đó.

### 7.1. Cấu hình Backend (`backend/.env`)

```bash
nano /var/www/html/surebet/backend/.env
```

Nội dung mẫu:

```dotenv
APP_NAME=surebet-platform
APP_ENV=production
AUTH_TOKEN_SECRET=thay-secret-that-o-day
AUTH_TOKEN_TTL=12h
HTTP_ADDRESS=127.0.0.1:8080
HTTP_READ_TIMEOUT=15s
HTTP_WRITE_TIMEOUT=15s

POSTGRES_DSN=postgres://surebet:Vz0Rw1tkN85r@127.0.0.1:5432/surebet?sslmode=disable
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

### 7.2. Cấu hình Frontend (`frontend/.env.production`)

```bash
nano /var/www/html/surebet/frontend/.env.production
```

Nội dung mẫu:

```dotenv
BACKEND_API_URL=http://127.0.0.1:8080
NEXT_PUBLIC_BACKEND_API_URL=https://api.tykfk.site
NEXT_PUBLIC_BACKEND_WS_URL=wss://api.tykfk.site/v1/ws
```

### 7.3. Cấu hình Collector (`collector/.env`)

```bash
nano /var/www/html/surebet/collector/.env
```

Nội dung mẫu:

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

### 7.4. Cấu hình Laravel Admin (`laravel/.env`)

```bash
nano /var/www/html/surebet/laravel/.env
```

Nội dung mẫu:

```dotenv
APP_NAME="Surebet Data Tools"
APP_ENV=production
APP_KEY=base64:thay-key-laravel-o-day
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
DB_PASSWORD=Vz0Rw1tkN85r
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

---

## 8. Cấu hình Cơ sở dữ liệu PostgreSQL & Redis

### 8.1. Tạo Database & User PostgreSQL (Nếu chưa tạo)

```bash
su - postgres -c "psql -c \"CREATE USER surebet WITH PASSWORD 'Vz0Rw1tkN85r';\"" || true
su - postgres -c "psql -c \"CREATE DATABASE surebet OWNER surebet;\"" || true
su - postgres -c "psql -c \"ALTER ROLE surebet SET client_encoding TO 'UTF8';\""
su - postgres -c "psql -c \"ALTER ROLE surebet SET default_transaction_isolation TO 'read committed';\""
su - postgres -c "psql -c \"ALTER ROLE surebet SET timezone TO 'Asia/Ho_Chi_Minh';\""
```

Kiểm tra kết nối DB:

```bash
psql "postgres://surebet:Vz0Rw1tkN85r@127.0.0.1:5432/surebet?sslmode=disable" -c '\dt'
```

### 8.2. Kiểm tra Redis Server

```bash
redis-cli ping
# Kết quả trả về: PONG
```

---

## 9. Build & Cài đặt Dependencies cho các Service (BẮT BUỘC ĐỂ TRÁNH LỖI SPAWN ERROR)

> ⚠️ **LƯU Ý QUAN TRỌNG:** Nếu không chạy `npm ci` và `npm run build` cho `frontend` cũng như `collector`, Supervisor sẽ bị lỗi `spawn error` khi nạp service!

### 9.1. Build Backend Go

```bash
export PATH=/usr/local/go/bin:$PATH
cd /var/www/html/surebet/backend
mkdir -p bin
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o bin/api ./cmd/api
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o bin/telegram-worker ./cmd/telegram-worker
```

### 9.2. Build Frontend Next.js

```bash
cd /var/www/html/surebet/frontend
npm ci
npm run build
```

### 9.3. Cài đặt Collector Dependencies & Playwright Browser

```bash
cd /var/www/html/surebet/collector
npm ci
npx playwright install --with-deps chromium
```

### 9.4. Cài đặt Laravel Admin Dependencies, Migration & Seed

```bash
cd /var/www/html/surebet/laravel
COMPOSER_ALLOW_SUPERUSER=1 composer install --no-dev --no-interaction --prefer-dist --optimize-autoloader
php artisan key:generate --force
php artisan migrate --force
php artisan db:seed --force
```

---

## 10. Cấu hình Supervisor Process Manager

Tạo file cấu hình Supervisor cho tất cả các service:

```bash
nano /etc/supervisor/conf.d/surebet.conf
```

Nội dung cấu hình:

```ini
[group:surebet]
programs=surebet-backend-api,surebet-telegram-worker,surebet-frontend,surebet-laravel-admin,surebet-collector-8xbet,surebet-collector-jun88-cmd

[program:surebet-backend-api]
directory=/var/www/html/surebet/backend
command=/var/www/html/surebet/backend/bin/api
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
command=/var/www/html/surebet/backend/bin/telegram-worker
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
command=/usr/bin/npm run start -- --hostname 127.0.0.1 --port 3000
environment=PATH="/usr/local/bin:/usr/bin:/bin",NODE_ENV="production"
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
command=/usr/bin/php artisan serve --host=127.0.0.1 --port=9500
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
command=/usr/bin/npm run run:8xbet-worker
environment=PATH="/usr/local/bin:/usr/bin:/bin",NODE_ENV="production"
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
command=/usr/bin/npm run run:jun88-cmd-worker
environment=PATH="/usr/local/bin:/usr/bin:/bin",NODE_ENV="production"
autostart=true
autorestart=true
startsecs=5
stopasgroup=true
killasgroup=true
stopsignal=TERM
stopwaitsecs=30
stdout_logfile=/var/log/surebet/collector-jun88-cmd.log
redirect_stderr=true
```

Cập nhật và nạp file cấu hình vào Supervisor:

```bash
supervisorctl reread
supervisorctl update
```

---

## 11. Cấu hình Nginx & Certbot SSL

> ⚠️ **LƯU Ý QUAN TRỌNG:** Phải cài cấu hình HTTP (Port 80) trước để Nginx nạp thành công, sau đó mới dùng Certbot tạo SSL 443 tự động.

### Bước 11.1: Tạo cấu hình Nginx ban đầu (HTTP Port 80)

```bash
nano /etc/nginx/sites-available/surebet.conf
```

Nội dung cấu hình ban đầu:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

server {
    listen 80;
    listen [::]:80;
    server_name tykfk.site;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_redirect http://127.0.0.1:3000/ https://$host/;
        proxy_redirect http://localhost:3000/ https://$host/;
    }
}

server {
    listen 80;
    listen [::]:80;
    server_name api.tykfk.site;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}

server {
    listen 80;
    listen [::]:80;
    server_name admin.tykfk.site;

    location / {
        proxy_pass http://127.0.0.1:9500;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
    }
}
```

### Bước 11.2: Kích hoạt Site Nginx & Reload Service

```bash
ln -sfn /etc/nginx/sites-available/surebet.conf /etc/nginx/sites-enabled/surebet.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
```

### Bước 11.3: Cài đặt SSL Certbot tự động cấp chứng chỉ HTTPS

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d tykfk.site -d api.tykfk.site -d admin.tykfk.site
```

*(Certbot sẽ tự tạo chứng chỉ SSL và tự động cập nhật file `/etc/nginx/sites-available/surebet.conf` để chuyển hướng HTTP -> HTTPS 443).*

---

## 12. Khởi động & Kiểm tra Trạng thái Service

Khởi chạy toàn bộ các process trong nhóm `surebet`:

```bash
supervisorctl start surebet:*
```

Kiểm tra trạng thái hoạt động:

```bash
supervisorctl status
```

---

## 13. Các Lệnh Debug / Theo dõi Log

```bash
# Xem log Backend API
tail -f /var/log/surebet/backend-api.log

# Xem log Frontend Next.js
tail -f /var/log/surebet/frontend.log

# Xem log Laravel Admin
tail -f /var/log/surebet/laravel-admin.log

# Xem log 8xbet Collector
tail -f /var/log/surebet/collector-8xbet.log

# Xem log Jun88 CMD Collector
tail -f /var/log/surebet/collector-jun88-cmd.log

# Restart riêng một service
supervisorctl restart surebet:surebet-backend-api
supervisorctl restart surebet:surebet-collector-8xbet
```

---

## 14. Kiểm tra Nhanh sau khi Deploy

```bash
# Kiểm tra API Health
curl -I http://127.0.0.1:8080/healthz

# Kiểm tra Frontend Next.js
curl -I http://127.0.0.1:3000

# Kiểm tra Laravel Admin
curl -I http://127.0.0.1:9500
```
