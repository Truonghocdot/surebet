export type CollectorSource = {
  collectorId: string;
  bookmakerId: string;
  lobbyId: string;
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

export interface Collector {
  collect(): Promise<OddsSnapshot>;
}

