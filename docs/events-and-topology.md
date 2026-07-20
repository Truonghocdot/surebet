# Collector Event Protocol

Collector kết nối `GET /v2/collector/stream` bằng WebSocket JSON.

## Collector gửi

- `hello`: khai báo protocol, session và source.
- `snapshot_begin`, `quote_upsert`, `quote_remove`, `snapshot_commit`: đồng bộ current-state.
- `heartbeat`: báo phiên collector còn sống.
- `confirm_quote_response`: kết quả đọc lại odds trực tiếp theo yêu cầu backend.

## Backend gửi

- `hello_ack`: chấp nhận session.
- `resync_required`: yêu cầu snapshot đầy đủ.
- `confirm_quote_request`: yêu cầu hard-confirm một leg.
- `error`: frame không hợp lệ hoặc session stale.

## Realtime frontend

`/v1/ws` phát `odds_updated` và `surebet_verification_updated`. Frontend áp dụng patch realtime, còn REST poll 15 giây chỉ là reconcile dự phòng.

Không có RabbitMQ trong runtime hiện tại. Ingest, confirm và realtime đều đi qua WebSocket; current-state và registry verified nằm trong Redis.
