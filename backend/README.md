# Backend Scaffold

Backend được tổ chức theo ranh giới clean architecture:

- `cmd/api`: entrypoint cho REST và websocket
- `cmd/worker`: entrypoint cho worker pipeline bất đồng bộ
- `internal/models`: entity và enum trạng thái hướng lưu trữ
- `internal/eventbus`: event contract và topology RabbitMQ
- `internal/repository`: abstraction cho persistence và quy ước Redis key
- `internal/validator`: contract cho safety pipeline theo thứ tự
- `internal/execution`: contract thực thi bookmaker và locking
- `internal/feature`: interface cho runtime feature switch
- `internal/risk`: contract đánh giá rủi ro
- `internal/api`: scaffold router Gin với placeholder endpoint

Hiện chưa có business logic. Toàn bộ package được tổ chức theo hướng interface-first và sẵn sàng để gắn adapter thực tế.

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
