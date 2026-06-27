export const statCardsSeed = [
  {
    title: "Surebet dang hoat dong",
    value: "128",
    delta: "+12.4%",
    tone: "positive"
  },
  {
    title: "Lenh can xac nhan",
    value: "17",
    delta: "4 uu tien cao",
    tone: "warning"
  },
  {
    title: "Account online",
    value: "42/48",
    delta: "3 session can refresh",
    tone: "neutral"
  },
  {
    title: "Ty le thanh cong",
    value: "96.8%",
    delta: "+1.1% hom nay",
    tone: "positive"
  }
] as const;

export const activeOpportunitiesSeed = [
  {
    fixture: "Arsenal vs Milan",
    market: "1X2",
    profit: "2.91%",
    spread: "0.11",
    freshness: "8s truoc"
  },
  {
    fixture: "Lakers vs Heat",
    market: "Moneyline",
    profit: "1.84%",
    spread: "0.07",
    freshness: "11s truoc"
  },
  {
    fixture: "PSG vs Dortmund",
    market: "Over/Under",
    profit: "2.33%",
    spread: "0.09",
    freshness: "14s truoc"
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
    status: "ACTIVE"
  },
  {
    bookmaker: "Bookmaker B",
    account: "Lobby 2 - Alpha",
    balance: "$9,210",
    status: "REFRESH NEEDED"
  },
  {
    bookmaker: "Bookmaker B",
    account: "Lobby 3 - Delta",
    balance: "$11,045",
    status: "ACTIVE"
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
    label: "Surebet van con ton tai",
    status: "active"
  },
  {
    label: "Odds moi nhat da duoc fetch",
    status: "active"
  },
  {
    label: "Profit van lon hon nguong",
    status: "active"
  },
  {
    label: "Account dang online",
    status: "watch"
  },
  {
    label: "Risk score nam trong nguong cho phep",
    status: "active"
  }
] as const;

