export type BookmakerCode = "8xbet" | "jun88";

export type LobbyCode = "default" | "ibc" | "bti" | "cmd" | "m8";

export type CollectorSource = {
  collectorId: string;
  bookmakerId: BookmakerCode;
  lobbyId: LobbyCode;
};

export type OddsSelection = {
  fixtureId: string;
  homeTeam?: string;
  awayTeam?: string;
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
  homeTeam?: string;
  awayTeam?: string;
  marketId: string;
  outcomeId: string;
  outcomeName: string;
  odds: number;
  availableStake: number;
  suspended: boolean;
  op: "upsert" | "remove";
};

export type Jun88LobbyAccess = {
  lobbyId: Exclude<LobbyCode, "default">;
  launchURL: string;
  expectedOriginPatterns?: string[];
};

export type CollectContext = {
  pageURL: string;
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
