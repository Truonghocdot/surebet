export const statCardsSeed = [
  {
    title: "Cơ hội đang hoạt động",
    value: "128",
    delta: "+12.4%",
    tone: "positive"
  },
  {
    title: "Lệnh cần xác nhận",
    value: "17",
    delta: "4 ưu tiên cao",
    tone: "warning"
  },
  {
    title: "Tài khoản đang kết nối",
    value: "42/48",
    delta: "3 phiên cần làm mới",
    tone: "neutral"
  },
  {
    title: "Tỷ lệ thành công",
    value: "96.8%",
    delta: "+1.1% hôm nay",
    tone: "positive"
  }
] as const;

export const activeOpportunitiesSeed = [
  {
    fixture: "Arsenal vs Milan",
    market: "1X2",
    profit: "2.91%",
    spread: "0.11",
    freshness: "8 giây trước"
  },
  {
    fixture: "Lakers vs Heat",
    market: "Kèo thắng thua",
    profit: "1.84%",
    spread: "0.07",
    freshness: "11 giây trước"
  },
  {
    fixture: "PSG vs Dortmund",
    market: "Tài xỉu",
    profit: "2.33%",
    spread: "0.09",
    freshness: "14 giây trước"
  }
] as const;

export const orderTimelineSeed = [
  {
    id: "SB-2419",
    state: "Đang kiểm tra",
    operator: "Linh Tran",
    updatedAt: "10:24:11"
  },
  {
    id: "SB-2418",
    state: "Chờ xác nhận",
    operator: "Máy tự động",
    updatedAt: "10:23:58"
  },
  {
    id: "SB-2417",
    state: "Đang đặt cược",
    operator: "Minh Vo",
    updatedAt: "10:23:47"
  },
  {
    id: "SB-2416",
    state: "Thành công",
    operator: "Máy tự động",
    updatedAt: "10:22:39"
  }
] as const;

export const accountHealthSeed = [
  {
    bookmaker: "8xbet",
    account: "VN chính 01",
    balance: "$18,420",
    status: "Hoạt động"
  },
  {
    bookmaker: "jun88",
    account: "jun88 chính",
    balance: "$9,210",
    status: "Cần làm mới phiên"
  },
  {
    bookmaker: "jun88",
    account: "jun88 dự phòng",
    balance: "$11,045",
    status: "Hoạt động"
  }
] as const;

export const featureFlagsSeed = [
  {
    name: "Đặt cược tự động",
    scope: "Toàn hệ thống",
    value: "Tắt"
  },
  {
    name: "Kiểm tra rủi ro",
    scope: "Toàn hệ thống",
    value: "Bật"
  },
  {
    name: "Kiểm tra số dư",
    scope: "jun88",
    value: "Bật"
  }
] as const;

export const riskCheckpointsSeed = [
  {
    label: "Cơ hội vẫn còn tồn tại",
    status: "active"
  },
  {
    label: "Tỷ lệ mới nhất đã được lấy",
    status: "active"
  },
  {
    label: "Lợi nhuận vẫn lớn hơn ngưỡng",
    status: "active"
  },
  {
    label: "Tài khoản đang kết nối",
    status: "watch"
  },
  {
    label: "Điểm rủi ro nằm trong ngưỡng cho phép",
    status: "active"
  }
] as const;
