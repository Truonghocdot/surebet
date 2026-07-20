# Lộ trình Vận hành

1. Chạy verification ở shadow đủ mẫu, theo dõi success rate, latency và parser-format error.
2. Chuyển strict khi hai collector fresh, confirm p95 dưới ngưỡng và không có format mismatch.
3. Thu thập traffic 8xbet để giảm dần mọi fallback dựa trên DOM.
4. Bổ sung metrics cho source freshness, confirmation reject reason và Telegram delivery latency.
5. Chỉ mở rộng bookmaker mới khi có parser feed ổn định và hard-confirm riêng.
