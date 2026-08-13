# Surebet Laravel Data Tools

Service Laravel nay chi la CLI quan ly schema va du lieu PostgreSQL bang cac lenh `php artisan`.
No khong chay thuong truc va khong cung cap web admin.

## Lenh hay dung

Chay tu thu muc goc repo:

```bash
docker compose -f deploy/production/docker-compose.yml --env-file deploy/production/.env --profile tools run --rm laravel-cli php artisan list
docker compose -f deploy/production/docker-compose.yml --env-file deploy/production/.env --profile tools run --rm laravel-cli php artisan migrate
docker compose -f deploy/production/docker-compose.yml --env-file deploy/production/.env --profile tools run --rm laravel-cli php artisan db:seed
docker compose -f deploy/production/docker-compose.yml --env-file deploy/production/.env --profile tools run --rm laravel-cli php artisan migrate --seed
docker compose -f deploy/production/docker-compose.yml --env-file deploy/production/.env --profile tools run --rm laravel-cli php artisan odds:stats
docker compose -f deploy/production/docker-compose.yml --env-file deploy/production/.env --profile tools run --rm laravel-cli php artisan odds:retention --dry-run
docker compose -f deploy/production/docker-compose.yml --env-file deploy/production/.env --profile tools run --rm laravel-cli php artisan odds:retention --vacuum
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
- Frontend super admin:
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
