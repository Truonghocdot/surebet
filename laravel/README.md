# Surebet Laravel Data Tools

Service Laravel nay dung de quan ly schema va du lieu PostgreSQL bang cac lenh `php artisan`.
No dung chung database voi backend Go, khong thay the backend runtime.

## Lenh hay dung

Chay tu thu muc goc repo:

```bash
docker compose --profile tools run --rm laravel-data php artisan list
docker compose --profile tools run --rm laravel-data php artisan migrate
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
