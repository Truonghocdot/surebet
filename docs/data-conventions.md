# Quy ước Dữ liệu

## Bảng PostgreSQL

- `users`
- `accounts`
- `bookmakers`
- `sessions`
- `bet_orders`
- `bet_order_legs`
- `bet_results`
- `audit_logs`
- `feature_flags`
- `configurations`

## Dữ liệu lịch sử

Ở giai đoạn hiện tại, dữ liệu lịch sử chưa tách sang một hệ lưu trữ phân tích riêng. Nếu cần lưu lịch sử odds, surebet, execution hoặc risk, chúng ta sẽ thiết kế lại adapter lưu trữ ở bước sau thay vì ràng buộc sớm vào một công nghệ cụ thể.

## Quy ước Redis key

Namespace prefix: `surebet`

Ví dụ:

- Current odds:
  - `surebet:odds:{bookmaker_id}:{lobby_id}:{fixture_id}:{market_id}:{outcome_id}`
- Current surebet:
  - `surebet:surebet:{opportunity_id}`
- Account session:
  - `surebet:session:{account_id}`
- Distributed lock:
  - `surebet:lock:{resource_type}:{resource_id}`
- Rate limit:
  - `surebet:ratelimit:{scope}`

## Quy ước locking

Các tài nguyên cần hỗ trợ distributed lock:

- Account
- Fixture
- Market
- Session refresh workflow nếu có

Redis lock nên dùng TTL ngắn, có cơ chế release rõ ràng và có thể gia hạn bằng heartbeat khi triển khai thực tế.
