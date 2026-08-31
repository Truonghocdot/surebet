export type BookmakerCode = "8xbet" | "jun88";

export type LobbyCode = "default" | "cmd";

export type CollectorSource = {
  collectorId: string;
  bookmakerId: BookmakerCode;
  lobbyId: LobbyCode;
};

export type OddsSelection = {
  fixtureId: string;
  sport?: string;
  homeTeam?: string;
  awayTeam?: string;
  leagueName?: string;
  matchState?: "upcoming" | "live" | "finished" | "unknown";
  eventStartAt?: string;
  marketId: string;
  outcomeId: string;
  outcomeName: string;
  odds: number;
  availableStake: number;
  suspended: boolean;
  sourceEventId?: string;
  rawOdds?: number;
  oddsFormat?: "indonesian" | "malay";
  /** Opaque bookmaker identity used to re-find the exact clickable selection. */
  providerRef?: string;
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
  sport?: string;
  homeTeam?: string;
  awayTeam?: string;
  leagueName?: string;
  matchState?: "upcoming" | "live" | "finished" | "unknown";
  eventStartAt?: string;
  marketId: string;
  outcomeId: string;
  outcomeName: string;
  odds: number;
  availableStake: number;
  suspended: boolean;
  sourceEventId?: string;
  rawOdds?: number;
  oddsFormat?: "indonesian" | "malay";
  providerRef?: string;
  op: "upsert" | "remove";
};

export type FixtureMarketOutcome = {
  outcomeId: string;
  outcomeName: string;
  side: "home" | "away" | "over" | "under";
  odds: number;
  rawOdds?: number;
  oddsFormat?: "indonesian" | "malay";
  providerRef?: string;
  availableStake: number;
  suspended: boolean;
};

export type FixtureMarket = {
  marketId: string;
  period: "FT" | "1H";
  normalizedLine: string;
  status: "open" | "suspended";
  outcomes: FixtureMarketOutcome[];
};

export type FixtureMarketSnapshot = {
  source: CollectorSource;
  fixtureId: string;
  sport?: string;
  homeTeam?: string;
  awayTeam?: string;
  leagueName?: string;
  matchState?: "upcoming" | "live" | "finished" | "unknown";
  eventStartAt?: string;
  sourceEventId?: string;
  observedAt: string;
  complete: boolean;
  markets: FixtureMarket[];
};

export type Jun88LobbyAccess = {
  lobbyId: Exclude<LobbyCode, "default">;
  launchURL: string;
  loginURL?: string;
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

export type AccountBalanceObservation = {
  source: CollectorSource;
  observedAt: string;
  amount: number;
  currency: string;
  amountVnd?: number;
  displayText?: string;
};

export type QuoteConfirmationRequest = {
  requestId: string;
  fixtureId: string;
  marketId: string;
  outcomeId: string;
  timeoutMs: number;
};

export type QuoteConfirmationResult = {
  observedAt: string;
  selection: OddsSelection | null;
};

export type QuoteConfirmationHandler = (
  request: QuoteConfirmationRequest
) => Promise<QuoteConfirmationResult>;

export type SimulatedBetCommand = {
  requestId: string;
  actionId: string;
  opportunityId: string;
  legId: string;
  sequence: 1 | 2;
  fixtureId: string;
  marketId: string;
  outcomeId: string;
  expectedOdds: number;
  stakeVnd: number;
  expiresAt: string;
  timeoutMs: number;
};

export type SimulatedPlaceBetRequest = SimulatedBetCommand & {
  idempotencyKey: string;
};

export type SimulatedTicketAccepted = {
  result: "ticket_accepted";
  observedAt: string;
  ticketId: string;
  acceptedOdds: number;
  stakeVnd: number;
};

export type SimulatedOddsChanged = {
  result: "odds_changed";
  observedAt: string;
  submittedOdds: number;
  offeredOdds: number;
  confirmationRequired: true;
};

export type SimulatedPlaceBetResult = SimulatedTicketAccepted | SimulatedOddsChanged;

export type SimulatedPlaceBetHandler = (
  request: SimulatedPlaceBetRequest
) => Promise<SimulatedPlaceBetResult>;

export type LiveBetOddsFormat = "malay" | "indonesian";

export type LiveBetCorrelation = {
  requestId: string;
  actionId: string;
  attemptId: string;
  opportunityId: string;
  legId: string;
};

export type LiveBetSelectionIdentity = {
  fixtureId: string;
  marketId: string;
  outcomeId: string;
  providerRef: string;
};

export type LivePrepareBetRequest = LiveBetCorrelation & LiveBetSelectionIdentity & {
  expectedOdds: number;
  expectedRawOdds?: number;
  oddsFormat: LiveBetOddsFormat;
  quoteRevision?: string;
  expiresAt: string;
};

export type LiveBetPrepared = {
  result: "prepared";
  prepareId: string;
  slipFingerprint: string;
  displayedOdds: number;
  rawOdds: number;
  oddsFormat: LiveBetOddsFormat;
  minimumStakeVnd: number;
  maximumStakeVnd: number;
  stakeIncrementVnd: number;
  balanceVnd: number;
  sessionGeneration: string;
  observedAt: string;
};

export type LiveBetPrepareRejected = {
  result: "rejected";
  observedAt: string;
  error: string;
};

export type LivePrepareBetResult = LiveBetPrepared | LiveBetPrepareRejected;

export type LiveCommitBetRequest = LiveBetCorrelation & {
  prepareId: string;
  idempotencyKey: string;
  stakeVnd: number;
  expectedOdds: number;
  expiresAt: string;
};

export type LiveTicketAccepted = {
  result: "ticket_accepted";
  observedAt: string;
  ticketId: string;
  acceptedOdds: number;
  stakeVnd: number;
};

export type LiveOddsChanged = {
  result: "odds_changed";
  observedAt: string;
  submittedOdds: number;
  offeredOdds: number;
  confirmationRequired: true;
};

export type LiveBetRejected = {
  result: "rejected";
  observedAt: string;
  error: string;
};

export type LiveSubmissionUnknown = {
  result: "submission_unknown";
  observedAt: string;
  error: string;
};

export type LiveBetResult =
  | LiveTicketAccepted
  | LiveOddsChanged
  | LiveBetRejected
  | LiveSubmissionUnknown;

export type LiveCancelPreparedBetRequest = LiveBetCorrelation & {
  prepareId: string;
  expiresAt: string;
};

export type LiveCancelPreparedBetResult = {
  result: "cancelled" | "rejected";
  observedAt: string;
  error?: string;
};

export type LiveReconcileBetRequest = LiveBetCorrelation & {
  idempotencyKey: string;
  expiresAt: string;
};

/**
 * Runtime-owned live actions. The stream sink validates transport identity and
 * expiry; the bookmaker runtime validates the exact DOM/provider identity.
 */
export interface LiveBetHandler {
  prepare(request: LivePrepareBetRequest): Promise<LivePrepareBetResult>;
  commit(request: LiveCommitBetRequest): Promise<LiveBetResult>;
  cancel(request: LiveCancelPreparedBetRequest): Promise<LiveCancelPreparedBetResult>;
  reconcile(request: LiveReconcileBetRequest): Promise<LiveBetResult>;
}

export interface CollectorSink {
  pushBootstrap(snapshot: OddsSnapshot): Promise<void>;
  pushDelta(deltas: OddsDelta[]): Promise<void>;
  heartbeat(payload: CollectorHeartbeat): Promise<void>;
  pushAccountBalance?(balance: AccountBalanceObservation): Promise<void>;
  pushFixtureMarketSnapshot?(snapshot: FixtureMarketSnapshot): Promise<void>;
  observeFixtureMarketBatch?(fixtureId: string, observedAt: string): Promise<void>;
  observeFixtureMarketBatches?(fixtureIds: string[], observedAt: string): Promise<void>;
  setQuoteConfirmationHandler?(handler: QuoteConfirmationHandler | null): void;
  setSimulatedPlaceBetHandler?(handler: SimulatedPlaceBetHandler | null): void;
  setLiveBetHandler?(handler: LiveBetHandler | null): void;
}
