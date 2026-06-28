export const statCardsSeed = [
  {
    title: "Surebet đang hoạt động",
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
    title: "Account đang online",
    value: "42/48",
    delta: "3 session cần refresh",
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
    market: "Moneyline",
    profit: "1.84%",
    spread: "0.07",
    freshness: "11 giây trước"
  },
  {
    fixture: "PSG vs Dortmund",
    market: "Over/Under",
    profit: "2.33%",
    spread: "0.09",
    freshness: "14 giây trước"
  }
] as const;

export const orderTimelineSeed = [
  {
    id: "SB-2419",
    state: "VALIDATING",
    operator: "Linh Tran",
    updatedAt: "10:24:11"
  },
  {
    id: "SB-2418",
    state: "WAITING_CONFIRMATION",
    operator: "Auto Bet Engine",
    updatedAt: "10:23:58"
  },
  {
    id: "SB-2417",
    state: "BETTING",
    operator: "Minh Vo",
    updatedAt: "10:23:47"
  },
  {
    id: "SB-2416",
    state: "SUCCESS",
    operator: "Auto Bet Engine",
    updatedAt: "10:22:39"
  }
] as const;

export const accountHealthSeed = [
  {
    bookmaker: "Bookmaker A",
    account: "VN Prime 01",
    balance: "$18,420",
    status: "Hoạt động"
  },
  {
    bookmaker: "Bookmaker B",
    account: "Lobby 2 - Alpha",
    balance: "$9,210",
    status: "Cần làm mới session"
  },
  {
    bookmaker: "Bookmaker B",
    account: "Lobby 3 - Delta",
    balance: "$11,045",
    status: "Hoạt động"
  }
] as const;

export const featureFlagsSeed = [
  {
    name: "AUTO_BET",
    scope: "global",
    value: "OFF"
  },
  {
    name: "RISK_VALIDATION",
    scope: "global",
    value: "ON"
  },
  {
    name: "BALANCE_CHECK",
    scope: "bookmaker-b",
    value: "ON"
  }
] as const;

export const riskCheckpointsSeed = [
  {
    label: "Surebet vẫn còn tồn tại",
    status: "active"
  },
  {
    label: "Odds mới nhất đã được fetch",
    status: "active"
  },
  {
    label: "Lợi nhuận vẫn lớn hơn ngưỡng",
    status: "active"
  },
  {
    label: "Account đang online",
    status: "watch"
  },
  {
    label: "Risk score nằm trong ngưỡng cho phép",
    status: "active"
  }
] as const;
