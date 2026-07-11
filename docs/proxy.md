Get Proxy với key xoay
Video hướng dẫn sử dụng

Sử dụng GET Hoặc POST
https://proxyxoay.shop/api/get.php
key="nhận được khi bạn mua hàng"
nhamang= "Được liệt kê bên dưới"

Random
tinhthanh= "Mã tỉnh liệt kê bên dưới"

0.Random
whitelist= "khai thêm ipv4 được phép sử dụng"
Link mẫu theo lựa chọn ở trên:
https://proxyxoay.shop/api/get.php?key=[key@xoay]&&nhamang=random&&tinhthanh=0&whitelist=
Kết quả thành công: status=100
{
"status": 100,
"message": "proxy nay se die sau 1777s",
"proxyhttp": "42.117.243.215:10836::",
"proxysocks5": "42.117.243.215:30836::",
"Nha Mang": "fpt",
"Vi Tri": "HaNoi1",
"Token expiration date": "22:52 19-02-2025"
} 
				
Lỗi status=102 - Lỗi status=101

Tich hop vao collector repo nay:

- `COLLECTOR_PROXY_MODE=proxyxoay`
- `COLLECTOR_PROXY_PROTOCOL=http`
- `COLLECTOR_PROXY_CACHE_ENABLED=true`
- `COLLECTOR_PROXY_CACHE_FILE=tmp/collector/proxyxoay-cache.json`
- `COLLECTOR_PROXYXOAY_KEY=...`
- `COLLECTOR_PROXYXOAY_NHAMANG=random`
- `COLLECTOR_PROXYXOAY_TINHTHANH=0`
- `COLLECTOR_PROXYXOAY_WHITELIST=`

Collector se uu tien dung lai proxy da lay thanh cong tu file cache khi worker restart.
Chi khi cache khong dung duoc nua moi goi lai API ProxyXoay.

Neu muon dung proxy tinh:

- `COLLECTOR_PROXY_MODE=static`
- `COLLECTOR_PROXY_SERVER=http://host:port`
  hoac `host:port:user:pass`
