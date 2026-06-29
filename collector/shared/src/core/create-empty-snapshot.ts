import type { BookmakerCode, LobbyCode, OddsSnapshot } from "../contracts.js";

export function createEmptySnapshot(
  collectorId: string,
  bookmakerId: BookmakerCode,
  lobbyId: LobbyCode
): OddsSnapshot {
  return {
    source: {
      collectorId,
      bookmakerId,
      lobbyId
    },
    collectedAt: new Date().toISOString(),
    selections: []
  };
}

