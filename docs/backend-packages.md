# Package Backend

- `cmd/api`: HTTP API, collector WebSocket, frontend WebSocket và wiring service.
- `cmd/telegram-worker`: đọc hàng đợi notification đã verified và gọi Telegram API.
- `internal/api`: Gin handlers và route authorization.
- `internal/auth`, `internal/middleware`: session token và phân quyền.
- `internal/collector`: session collector, ingest frame, confirm request và event publisher.
- `internal/odds`: normalization và current odds query.
- `internal/calculator`: matching fixture/market và surebet detector.
- `internal/surebet`: candidate query, hard confirmation và verified registry.
- `internal/telegram`: recipient policy, formatter, notifier và worker.
- `internal/repository/gormstore`: PostgreSQL repositories.
- `internal/repository/redisstore`: odds current-state và verified opportunity.
- `internal/realtime`: frontend WebSocket hub.
- `internal/runtimeconfig`: cấu hình collector lưu trong runtime settings.
- `internal/eventbus`: typed event dùng nội bộ giữa ingest publisher và realtime hub; không phải message broker ngoài tiến trình.
