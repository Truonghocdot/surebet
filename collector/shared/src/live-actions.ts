import crypto from "node:crypto";
import type {
  LiveBetResult,
  LiveCommitBetRequest,
  LivePrepareBetRequest,
  LiveReconcileBetRequest,
} from "./contracts.js";

export type LiveBetFeatureFlags = {
  enabled: boolean;
  commitEnabled: boolean;
};

export function liveBetFeatureFlags(): LiveBetFeatureFlags {
  return {
    // The backend control plane owns the kill switch. The collector only
    // advertises the protocol capability so the switch can be changed
    // without restarting workers or editing collector environment files.
    enabled: true,
    commitEnabled: true,
  };
}

export function liveBetActionTimeoutMs() {
  return 10_000;
}

export function liveBetSessionGeneration(prefix: string) {
  return `${prefix}:${crypto.randomUUID()}`;
}

export function liveBetPrepareID(request: LivePrepareBetRequest, sessionGeneration: string) {
  return crypto.createHash("sha256").update(JSON.stringify({
    sessionGeneration,
    actionId: request.actionId,
    attemptId: request.attemptId,
    legId: request.legId,
    providerRef: request.providerRef,
    quoteRevision: request.quoteRevision ?? "",
  })).digest("hex");
}

export function liveBetSlipFingerprint(value: unknown) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function liveCommitFingerprint(request: LiveCommitBetRequest) {
  return JSON.stringify({
    actionId: request.actionId,
    attemptId: request.attemptId,
    opportunityId: request.opportunityId,
    legId: request.legId,
    prepareId: request.prepareId,
    stakeVnd: request.stakeVnd,
    expectedOdds: request.expectedOdds,
  });
}

export type CachedLiveCommit = {
  fingerprint: string;
  actionId: string;
  opportunityId: string;
  legId: string;
  state: "before_send" | "submit_started" | "response_received";
  result?: LiveBetResult;
};

/**
 * This cache is deliberately not an idempotency guarantee. It prevents a
 * second click within one worker process; backend persistence and bookmaker
 * reconciliation remain authoritative across restarts.
 */
export class ProcessLiveBetJournal {
  private readonly commits = new Map<string, CachedLiveCommit>();

  read(idempotencyKey: string) {
    return this.commits.get(idempotencyKey);
  }

  readForReconcile(request: LiveReconcileBetRequest) {
    const entry = this.commits.get(request.idempotencyKey);
    if (!entry) return undefined;
    if (entry.actionId !== request.actionId ||
      entry.opportunityId !== request.opportunityId ||
      entry.legId !== request.legId) {
      throw new Error("reconcile correlation does not match the live commit journal entry");
    }
    return entry;
  }

  begin(request: LiveCommitBetRequest) {
    const fingerprint = liveCommitFingerprint(request);
    const current = this.commits.get(request.idempotencyKey);
    if (current) {
      if (current.fingerprint !== fingerprint) {
        throw new Error("idempotency key was reused with a different live bet payload");
      }
      return { cached: true as const, entry: current };
    }
    const entry: CachedLiveCommit = {
      fingerprint,
      actionId: request.actionId,
      opportunityId: request.opportunityId,
      legId: request.legId,
      state: "before_send",
    };
    setBounded(this.commits, request.idempotencyKey, entry);
    return { cached: false as const, entry };
  }

  markSubmitStarted(idempotencyKey: string) {
    const entry = this.commits.get(idempotencyKey);
    if (!entry) throw new Error("live commit journal entry is missing");
    entry.state = "submit_started";
  }

  finish(idempotencyKey: string, result: LiveBetResult) {
    const entry = this.commits.get(idempotencyKey);
    if (!entry) throw new Error("live commit journal entry is missing");
    entry.state = "response_received";
    entry.result = result;
  }
}

export class SerialLiveBetActions {
  private tail = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.tail.catch(() => undefined).then(operation);
    this.tail = pending.then(() => undefined, () => undefined);
    return pending;
  }
}

export function assertUnexpired(expiresAt: string) {
  const timestamp = Date.parse(expiresAt);
  if (!Number.isFinite(timestamp) || timestamp <= Date.now()) {
    throw new Error("live bet command has expired");
  }
}

function setBounded<K, V>(map: Map<K, V>, key: K, value: V) {
  if (map.size >= 10_000) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, value);
}
