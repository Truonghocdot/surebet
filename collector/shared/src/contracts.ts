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

export interface Collector {
  collect(): Promise<OddsSnapshot>;
}

export interface CollectorRuntime {
  collect(context: CollectContext): Promise<OddsSnapshot>;
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
