# Backend Runtime

Backend Go chi con giu runtime API:

- `cmd/api`: entrypoint cho REST, websocket va collector ingest
- `internal/api`: router Gin va handlers runtime
- `internal/collector`: ingest bootstrap/delta/heartbeat tu collector
- `internal/odds`: doc odds hien tai
- `internal/surebet`: tinh va doc surebet
- `internal/repository`: adapter GORM doc/ghi PostgreSQL

Backend khong con quyen quan ly schema PostgreSQL va khong con seed du lieu.

## Schema va seeding

Toan bo migration, index va seed account duoc quan ly boi service Laravel trong [laravel](../laravel).

Hay dung:

- `cd ../laravel && php artisan migrate`
- `cd ../laravel && php artisan db:seed`
- hoac `cd ../laravel && php artisan migrate --seed`

API runtime chi mo ket noi PostgreSQL. Neu schema chua ton tai hoac seed account chua chay, backend se khong tu tao bang nua.

## Chính sách dependency

- Giữ dependency trực tiếp ở mức tối thiểu và chỉ thêm khi đã có use case thật sự
- Không import trực tiếp `github.com/bytedance/sonic`, `github.com/goccy/go-json` hoặc `github.com/json-iterator/go`
- Với `gin`, các package JSON này xuất hiện trong `go.mod` dưới dạng indirect dependency do cơ chế build tag nội bộ của framework
- Build mặc định hiện tại của backend vẫn đi theo `encoding/json`, không biên dịch các JSON backend tùy chọn nếu không bật build tag tương ứng

## Kiểm tra dependency

Có thể dùng các lệnh sau trong thư mục `backend/`:

- `make deps-audit`
  - Liệt kê toàn bộ dependency không thuộc standard library của build hiện tại
- `make deps-why-all`
  - Giải thích vì sao từng module xuất hiện trong graph
- `make deps-why-json`
  - Kiểm tra riêng ba JSON library transitively đi vào qua `gin`
- `make deps-runtime-json`
  - Nếu lệnh này không in gì, nghĩa là build mặc định không compile các JSON backend tùy chọn
