export type BookmakerCode = "8xbet" | "jun88";

export type LobbyCode = "default" | "ibc" | "bti" | "cmd" | "m8";

export type CollectorSource = {
  collectorId: string;
  bookmakerId: BookmakerCode;
  lobbyId: LobbyCode;
};

export type OddsSelection = {
  fixtureId: string;
  marketId: string;
  outcomeId: string;
  outcomeName: string;
  odds: number;
  availableStake: number;
  suspended: boolean;
};

export type OddsSnapshot = {
  source: CollectorSource;
  collectedAt: string;
  selections: OddsSelection[];
};

export type OddsDelta = {
  source: CollectorSource;
  collectedAt: string;
  fixtureId: string;
  marketId: string;
  outcomeId: string;
  outcomeName: string;
  odds: number;
  availableStake: number;
  suspended: boolean;
  op: "upsert" | "remove";
};

export type BookmakerSetting = {
  bookmakerCode: BookmakerCode;
  bookmakerName: string;
  url: string;
  username: string;
  password: string;
};

export type SessionBootstrapMode = "manual" | "headless";

export type SessionState = {
  bookmakerCode: BookmakerCode;
  originURL: string;
  bootstrapMode: SessionBootstrapMode;
  preparedAt: string;
  storageStatePath: string;
  sessionStoragePath?: string;
  accessibleLobbies: LobbyCode[];
  visitedOrigins?: string[];
};

export type Jun88LobbyAccess = {
  lobbyId: Exclude<LobbyCode, "default">;
  launchURL: string;
  expectedOriginPatterns?: string[];
};

export type CollectContext = {
  setting: BookmakerSetting;
  session?: SessionState;
};

export type CollectorHeartbeat = {
  collectorId: string;
  bookmakerId: BookmakerCode;
  lobbyId: LobbyCode;
  sentAt: string;
};

export interface Collector {
  collect(): Promise<OddsSnapshot>;
}

export interface CollectorRuntime {
  collect(context: CollectContext): Promise<OddsSnapshot>;
}

export interface StreamingCollectorRuntime extends CollectorRuntime {
  stream(context: CollectContext, sink: CollectorSink): Promise<void>;
}

export interface CollectorSink {
  pushBootstrap(snapshot: OddsSnapshot): Promise<void>;
  pushDelta(deltas: OddsDelta[]): Promise<void>;
  heartbeat(payload: CollectorHeartbeat): Promise<void>;
}

export interface StreamableCollector extends Collector {
  stream(sink: CollectorSink): Promise<void>;
}

export interface BookmakerSettingsProvider {
  getBookmakerSetting(bookmakerCode: BookmakerCode): Promise<BookmakerSetting>;
}

export interface SessionBootstrapper {
  prepare(setting: BookmakerSetting): Promise<SessionState>;
}

export interface SessionStateStore {
  read(bookmakerCode: BookmakerCode): Promise<SessionState | null>;
  write(state: SessionState): Promise<void>;
}
