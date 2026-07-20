# Surebet Platform

Hệ thống theo dõi kèo realtime từ `8xbet/default` và `jun88/cmd`, xác nhận lại cơ hội trực tiếp tại collector trước khi gửi Telegram.

## Thành phần

- `collector/`: hai Playwright worker, network-first cho 8xbet và DOM stream cho Jun88 CMD.
- `backend/`: Go API, collector WebSocket ingest, Redis current-state, detector và Telegram worker.
- `frontend/`: dashboard Next.js cho trận khớp, cơ hội và cấu hình vận hành.
- `deploy/`: Compose local và production.

## Chạy local

```bash
docker compose -f deploy/docker-compose.yml up -d postgres redis backend-api telegram-worker
cd collector && npm run run:8xbet-worker
cd collector && npm run run:jun88-cmd-worker
cd frontend && npm run dev
```

## Kiểm tra

```bash
cd backend && go test ./...
cd collector && npm run typecheck && npm run test:eightxbet-network-feed
cd frontend && npm run build
```

Kiến trúc runtime được mô tả tại [docs/architecture.md](docs/architecture.md).
