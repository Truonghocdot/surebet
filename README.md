# Surebet Platform

Bộ khung kiến trúc production-grade cho nền tảng Surebet + Auto Bet realtime.

Repository này hiện dừng ở mức kiến trúc, contract, topology và hạ tầng scaffold. Chưa triển khai logic đặt cược hay logic bookmaker cụ thể.

## Cấu trúc repository

- `backend/`: contract backend Go, API scaffold, worker scaffold, domain model và topology
- `collector/`: workspace Node.js cho collector Playwright theo từng bookmaker/lobby
- `frontend/`: scaffold dashboard Next.js
- `deploy/`: ví dụ cấu hình môi trường và tài nguyên bootstrap hạ tầng
- `docs/`: tài liệu kiến trúc, sơ đồ phụ thuộc, quy ước và roadmap

## Khởi động nhanh

1. Xem [docs/architecture.md](docs/architecture.md).
2. Khởi động hạ tầng với `docker compose up -d postgres redis rabbitmq`.
3. Chạy backend API bằng `cd backend && go run ./cmd/api`.

## Phạm vi hiện tại

- Domain model cho PostgreSQL và contract cho dữ liệu lịch sử
- Event contract strongly typed
- Queue topology và quy ước Redis key
- Interface cho feature switch và validation pipeline
- Entrypoint cho API và worker
- Docker Compose cho hạ tầng local và service scaffold

## Chủ động để lại cho bước sau

- Logic tính surebet
- Luật chấm điểm rủi ro
- Adapter thực thi theo từng bookmaker
- Triển khai Playwright thực tế
- Tích hợp authentication provider
- Implement persistence adapter
# surebet
