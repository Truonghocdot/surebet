export type CollectorStreamSource = {
  collector_id: string;
  bookmaker_id: string;
  lobby_id: string;
};

export type CollectorStreamRawIDs = {
  fixture_id: string;
  market_id: string;
  outcome_id: string;
};

export type CollectorStreamMarkers = {
  fixture_marker: string;
  market_marker: string;
  outcome_marker: string;
};
