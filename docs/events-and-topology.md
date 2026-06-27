# Sự kiện và Topology Hàng đợi

## Sự kiện strongly typed

Được định nghĩa trong `backend/internal/eventbus/events.go`.

Các sự kiện:

- `OddsUpdated`
- `SurebetDetected`
- `ValidationPassed`
- `ValidationFailed`
- `BetRequested`
- `BetStarted`
- `BetAccepted`
- `BetRejected`
- `BetSettled`
- `AlertCreated`

Mỗi sự kiện đều có metadata:

- `event_id`
- `trace_id`
- `correlation_id`
- `producer`
- `version`
- `occurred_at`

## Topology RabbitMQ

Exchange:

- `surebet.domain`
- `surebet.execution`
- `surebet.alert`

Queue:

- `odds.normalizer`
- `surebet.detector`
- `validation.pipeline`
- `execution.requests`
- `execution.results`
- `persistence.writer`
- `websocket.broadcast`
- `alert.dispatcher`

## Routing key

- `odds.updated`
- `surebet.detected`
- `validation.passed`
- `validation.failed`
- `bet.requested`
- `bet.started`
- `bet.accepted`
- `bet.rejected`
- `bet.settled`
- `alert.created`

## Mục đích của từng consumer

- `odds.normalizer`
  - Chuẩn hóa payload từ collector và cập nhật cache current odds trong Redis

- `surebet.detector`
  - Chạy phát hiện surebet trên tập current odds mới nhất

- `validation.pipeline`
  - Thực thi các bước kiểm định an toàn theo đúng thứ tự

- `execution.requests`
  - Chuyển yêu cầu đặt cược thành job an toàn cho worker

- `execution.results`
  - Xử lý kết quả từ provider và kích hoạt persistence cùng realtime fanout

- `persistence.writer`
  - Lưu dữ liệu giao dịch và lịch sử append-only

- `websocket.broadcast`
  - Đẩy cập nhật realtime tới các client dashboard

- `alert.dispatcher`
  - Gửi cảnh báo hệ thống cho operator
