import crypto from "node:crypto";
import type {
  BookmakerCode,
  SimulatedPlaceBetHandler,
  SimulatedPlaceBetRequest,
  SimulatedPlaceBetResult,
} from "./contracts.js";

export type SimulatedPlaceBetScenario = {
  outcome: "ticket_accepted" | "odds_changed";
  offeredOdds?: number | ((request: SimulatedPlaceBetRequest) => number);
};

export class SimulatedBetValidationError extends Error {
  readonly code = "SIMULATED_BET_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "SimulatedBetValidationError";
  }
}

export function createSimulatedPlaceBetHandler(
  bookmakerId: BookmakerCode,
  scenario: SimulatedPlaceBetScenario,
): SimulatedPlaceBetHandler {
  const results = new Map<string, {
    fingerprint: string;
    result: SimulatedPlaceBetResult;
  }>();

  return async (request) => {
    const cached = results.get(request.idempotencyKey);
    const fingerprint = simulatedRequestFingerprint(request);
    if (cached) {
      if (cached.fingerprint !== fingerprint) {
        throw new SimulatedBetValidationError(
          "idempotency key was reused with a different simulated bet payload",
        );
      }
      return cached.result;
    }

    validateRequest(request);
    const observedAt = new Date().toISOString();
    let result: SimulatedPlaceBetResult;
    if (scenario.outcome === "odds_changed") {
      const configuredOdds = typeof scenario.offeredOdds === "function"
        ? scenario.offeredOdds(request)
        : scenario.offeredOdds;
      const offeredOdds = configuredOdds ?? defaultChangedOdds(request.expectedOdds);
      if (!validMalayOdds(offeredOdds)) {
        throw new SimulatedBetValidationError("simulated offered odds must be valid Malay odds");
      }
      if (offeredOdds === request.expectedOdds) {
        throw new SimulatedBetValidationError(
          "simulated changed odds must differ from expected odds",
        );
      }
      result = {
        result: "odds_changed",
        observedAt,
        submittedOdds: request.expectedOdds,
        offeredOdds,
        confirmationRequired: true,
      };
    } else {
      result = {
        result: "ticket_accepted",
        observedAt,
        ticketId: simulatedTicketId(bookmakerId, request),
        acceptedOdds: request.expectedOdds,
        stakeVnd: request.stakeVnd,
      };
    }

    if (results.size >= 10_000) {
      const oldest = results.keys().next().value;
      if (oldest !== undefined) results.delete(oldest);
    }
    results.set(request.idempotencyKey, { fingerprint, result });
    return result;
  };
}

export function configuredSimulatedPlaceBetHandler(
  bookmakerId: BookmakerCode,
): SimulatedPlaceBetHandler {
  return createSimulatedPlaceBetHandler(bookmakerId, { outcome: "ticket_accepted" });
}

function validateRequest(request: SimulatedPlaceBetRequest) {
  if (!request.actionId || !request.opportunityId || !request.legId || !request.idempotencyKey) {
    throw new SimulatedBetValidationError("simulated bet identity is incomplete");
  }
  if (!request.fixtureId || !request.marketId || !request.outcomeId) {
    throw new SimulatedBetValidationError("simulated selection identity is incomplete");
  }
  if (!validMalayOdds(request.expectedOdds)) {
    throw new SimulatedBetValidationError("expected odds must be valid Malay odds");
  }
  if (!Number.isSafeInteger(request.stakeVnd) || request.stakeVnd <= 0) {
    throw new SimulatedBetValidationError("stakeVnd must be a positive integer");
  }
  const expiresAt = Date.parse(request.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new SimulatedBetValidationError("simulated bet command has expired");
  }
}

function defaultChangedOdds(expectedOdds: number) {
  const increased = Math.round((expectedOdds + 0.01) * 100) / 100;
  if (increased !== 0 && increased !== expectedOdds) return increased;
  return Math.round((expectedOdds - 0.01) * 100) / 100;
}

function validMalayOdds(value: number) {
  return Number.isFinite(value) && value !== 0 && value >= -1 && value <= 1;
}

function simulatedTicketId(bookmakerId: BookmakerCode, request: SimulatedPlaceBetRequest) {
  const source = bookmakerId === "8xbet" ? "8X" : "J88";
  const stablePart = crypto
    .createHash("sha256")
    .update(`${bookmakerId}\u0000${request.idempotencyKey}`)
    .digest("hex")
    .slice(0, 20)
    .toUpperCase();
  return `SIM-${source}-${stablePart}`;
}

function simulatedRequestFingerprint(request: SimulatedPlaceBetRequest) {
  return JSON.stringify({
    actionId: request.actionId,
    opportunityId: request.opportunityId,
    legId: request.legId,
    sequence: request.sequence,
    fixtureId: request.fixtureId,
    marketId: request.marketId,
    outcomeId: request.outcomeId,
    expectedOdds: request.expectedOdds,
    stakeVnd: request.stakeVnd,
  });
}
