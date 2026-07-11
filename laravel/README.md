# Surebet Laravel Data Tools

Service Laravel nay dung de quan ly schema va du lieu PostgreSQL bang cac lenh `php artisan`.
No dung chung database voi backend Go, khong thay the backend runtime.

## Lenh hay dung

Chay tu thu muc goc repo:

```bash
docker compose --profile tools run --rm laravel-data php artisan list
docker compose --profile tools run --rm laravel-data php artisan migrate
docker compose --profile tools run --rm laravel-data php artisan db:seed
docker compose --profile tools run --rm laravel-data php artisan migrate --seed
docker compose --profile tools run --rm laravel-data php artisan odds:stats
docker compose --profile tools run --rm laravel-data php artisan odds:retention --dry-run
docker compose --profile tools run --rm laravel-data php artisan odds:retention --vacuum
docker compose --profile tools run --rm laravel-data php artisan tinker
```

## Chinh sach don odds

Mac dinh `odds:retention` se xoa:

- Ban ghi cu hon `ODDS_RETENTION_ACTIVE_HOURS`, mac dinh 24 gio.
- Ban ghi `finished` cu hon `ODDS_RETENTION_FINISHED_MINUTES`, mac dinh 30 phut.

Hay chay `--dry-run` truoc khi xoa that.

## Seed account dang nhap

`php artisan db:seed` se tao hoac cap nhat 2 account mac dinh:

- Frontend/API:
  - email: `operator@surebet.local`
  - password: `matkhau123`
  - role: `operator`
- Filament super admin:
  - email: `superadmin@surebet.local`
  - password: `superadmin123`
  - role: `super_admin`

Co the doi qua `.env` bang:

- `SEED_FRONTEND_USER_ID`
- `SEED_FRONTEND_USER_EMAIL`
- `SEED_FRONTEND_USER_PASSWORD`
- `SEED_FRONTEND_USER_FULL_NAME`
- `SEED_FRONTEND_USER_ROLE`
- `SEED_SUPER_ADMIN_ID`
- `SEED_SUPER_ADMIN_EMAIL`
- `SEED_SUPER_ADMIN_PASSWORD`
- `SEED_SUPER_ADMIN_FULL_NAME`
- `SEED_SUPER_ADMIN_ROLE`

## Filament admin

Sau khi migrate va seed xong, panel quan tri co san tai:

- `/admin`

Tai day chi tai khoan `super_admin` moi vao duoc.
Tai khoan frontend role `operator` se dang nhap duoc vao frontend/backend API, nhung se khong vao duoc Laravel Filament.

## Telegram webhook

Laravel co san webhook:

- `POST /api/telegram/webhook`

Webhook nay nhan update `my_chat_member` tu Telegram khi bot duoc them vao group, supergroup, channel hoac private chat.
Neu `TELEGRAM_WEBHOOK_SECRET` duoc set trong `.env`, Telegram can gui dung header `X-Telegram-Bot-Api-Secret-Token`.

Khi bot vao chat moi, Laravel se tu dong tao hoac cap nhat record trong danh sach `TelegramRecipients`.
Record moi duoc tao mac dinh o trang thai tat thong bao de admin bat lai trong Filament neu can.
