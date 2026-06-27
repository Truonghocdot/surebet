# Lộ trình Phát triển

## Giai đoạn 1: Nền tảng hệ thống

1. Hoàn thiện việc nạp cấu hình kèm validation.
2. Thêm wiring dependency injection cho API và worker.
3. Triển khai logging có cấu trúc và tracing tương thích OpenTelemetry.
4. Bổ sung adapter RabbitMQ, Redis và PostgreSQL phía sau các interface hiện có.

## Giai đoạn 2: Lớp dữ liệu và truy vấn

1. Viết migration PostgreSQL cho các thực thể giao dịch.
2. Triển khai repository Redis cho current odds và current surebets.
3. Xây dựng read model phục vụ dashboard.
4. Xác định chiến lược lưu trữ lịch sử phù hợp khi có nhu cầu thực tế.

## Giai đoạn 3: Pipeline collector

1. Xây dựng shared Playwright collector SDK trong `collector/shared`.
2. Hoàn thiện end-to-end cho một collector bookmaker tham chiếu.
3. Chuẩn hóa output của collector thành sự kiện `OddsUpdated`.
4. Bổ sung health check và latency instrumentation cho collector.

## Giai đoạn 4: Detection và validation

1. Triển khai bộ tính surebet.
2. Triển khai đầy đủ các bước trong validation pipeline theo đúng thứ tự.
3. Bổ sung luật risk engine và ngưỡng risk score.
4. Lưu kết quả validation và hiển thị chúng trên dashboard.

## Giai đoạn 5: An toàn thực thi

1. Triển khai distributed lock cho account, fixture và market.
2. Biến interface bookmaker adapter thành adapter Playwright thực tế cho từng nhà cái.
3. Hoàn thiện luồng manual confirmation và auto bet decision.
4. Bổ sung rollback và recovery cho các lỗi thực thi một phần.

## Giai đoạn 6: Frontend và vận hành

1. Xây dựng dashboard realtime cho current odds, surebets và bet orders.
2. Bổ sung màn hình quản trị feature flag và audit view.
3. Thiết lập alerting, metrics dashboard và SLO.
4. Chuẩn bị manifest Kubernetes và pipeline CI/CD.
