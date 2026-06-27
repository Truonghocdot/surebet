# Trách nhiệm các Package Backend

## Cấu trúc Go Module

- Module: `surebet/backend`
- Điểm vào:
  - `cmd/api`: cổng HTTP và websocket
  - `cmd/worker`: tiến trình chạy pipeline bất đồng bộ
- Tiện ích public có thể tái sử dụng:
  - `pkg/health`
- Phần kiến trúc chỉ dùng nội bộ:
  - `internal/...`

## Bản đồ package

- `internal/api`
  - Chỉ xử lý routing Gin và transport layer
  - Phụ thuộc vào DTO và service interface

- `internal/auth`
  - Contract cho cấp token, parse token và phân quyền account

- `internal/collector`
  - Ranh giới ingest dữ liệu từ collector Node/Playwright vào workflow backend

- `internal/odds`
  - Contract cho đọc và ghi current odds

- `internal/parser`
  - Contract cho parser của raw snapshot

- `internal/calculator`
  - Contract cho phát hiện surebet

- `internal/validator`
  - Interface cho validation pipeline theo thứ tự và model kết quả

- `internal/risk`
  - Interface đánh giá rủi ro và đầu ra risk score

- `internal/execution`
  - Contract cho execution engine, provider adapter và locking

- `internal/autobet`
  - Điều phối giữa feature flags, validation và chế độ execution

- `internal/websocket`
  - Contract cho broadcast realtime

- `internal/notification`
  - Abstraction cho gửi alert và notification

- `internal/repository`
  - Interface repository cho PostgreSQL, Redis và distributed lock

- `internal/eventbus`
  - Event payload strongly typed và topology RabbitMQ

- `internal/feature`
  - Contract cho feature switch runtime và phạm vi áp dụng

- `internal/config`
  - Cấu hình ứng dụng từ biến môi trường

- `internal/middleware`
  - Middleware cho transport layer của Gin

- `internal/models`
  - Domain entity dùng chung và các enum trạng thái

- `internal/dto`
  - Model request/response cho transport

- `internal/logger`
  - Abstraction cho logging

- `internal/metrics`
  - Abstraction cho metrics

## Quy tắc phụ thuộc

- `cmd/*` có thể phụ thuộc vào `internal/*` và `pkg/*`
- `internal/api` có thể phụ thuộc vào DTO và service interface, không phụ thuộc trực tiếp repository
- Domain contract chỉ nên phụ thuộc vào model và standard library
- Repository và adapter ngoài hệ thống nên implement interface được định nghĩa gần domain
- Không package nào được import transport package chỉ để dùng data type
