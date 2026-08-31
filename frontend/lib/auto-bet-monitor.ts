import type {
  AutoBetAction,
  AutoBetMonitorSnapshot,
  BetExposure,
  CollectorAccountBalance
} from "../features/auto-bet/schemas/auto-bet-schemas";

const terminalActionStatuses = new Set([
  "completed",
  "dry_run_completed",
  "failed",
  "selection_rejected",
  "aborted_no_exposure",
  "unhedged_closed"
]);

const openExposureStatuses = new Set([
  "exposure_open",
  "hedging",
  "submission_unknown",
  "manual_review"
]);

export type AutoBetHealth =
  | "unavailable"
  | "critical"
  | "attention"
  | "monitoring"
  | "idle";

export type MonitoredBookmaker = "jun88-cmd" | "8xbet";

export function summarizeAutoBetSnapshot(snapshot: AutoBetMonitorSnapshot) {
  const actions = snapshot.actions.state === "available" ? snapshot.actions.items : [];
  const exposures = snapshot.exposures.state === "available" ? snapshot.exposures.items : [];
  const currentActions = actions.filter(isCurrentAction).sort(byUpdatedAtDesc);
  const trackedExposures = exposures.filter(shouldTrackExposure).sort(byOpenedAtDesc);
  const openExposures = exposures.filter((item) => isOpenExposureStatus(item.status));
  const unknownCount = [
    ...actions.filter((item) => item.status === "submission_unknown"),
    ...exposures.filter((item) => item.status === "submission_unknown")
  ].length;
  const criticalCount = exposures.filter((item) =>
    item.status === "unhedged_closed" || item.status === "manual_review"
  ).length;

  return {
    currentActions,
    trackedExposures,
    activeActionCount: currentActions.length,
    openExposureCount: openExposures.length,
    unknownCount,
    criticalCount,
    health: resolveHealth(snapshot, openExposures, unknownCount, criticalCount)
  };
}

export function isCurrentAction(action: AutoBetAction) {
  if (action.status === "submission_unknown") {
    return true;
  }
  return !action.completed_at && !terminalActionStatuses.has(action.status);
}

export function shouldTrackExposure(exposure: BetExposure) {
  return isOpenExposureStatus(exposure.status) || exposure.status === "unhedged_closed";
}

export function isOpenExposureStatus(status: string) {
  return openExposureStatuses.has(status);
}

export function selectLatestAccountBalance(
  items: CollectorAccountBalance[],
  bookmaker: MonitoredBookmaker
) {
  return items
    .filter((item) => identifyBookmaker(item) === bookmaker)
    .sort((left, right) => balanceTimestamp(right) - balanceTimestamp(left))[0] ?? null;
}

function resolveHealth(
  snapshot: AutoBetMonitorSnapshot,
  openExposures: BetExposure[],
  unknownCount: number,
  criticalCount: number
): AutoBetHealth {
  if (
    snapshot.actions.state === "unavailable"
    || snapshot.exposures.state === "unavailable"
    || snapshot.balances.state === "unavailable"
  ) {
    return "unavailable";
  }
  if (criticalCount > 0 || unknownCount > 0) {
    return "critical";
  }
  if (openExposures.some((item) => item.last_failure_code || item.last_failure_message)) {
    return "attention";
  }
  if (openExposures.length > 0) {
    return "monitoring";
  }
  return "idle";
}

function byUpdatedAtDesc(left: AutoBetAction, right: AutoBetAction) {
  return timestamp(right.updated_at) - timestamp(left.updated_at);
}

function byOpenedAtDesc(left: BetExposure, right: BetExposure) {
  return timestamp(right.opened_at) - timestamp(left.opened_at);
}

function timestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function identifyBookmaker(item: CollectorAccountBalance): MonitoredBookmaker | null {
  const identity = `${item.bookmaker_id} ${item.lobby_id} ${item.collector_id}`.toLowerCase();
  if (identity.includes("jun88")) {
    return "jun88-cmd";
  }
  if (identity.includes("8xbet") || identity.includes("eightxbet")) {
    return "8xbet";
  }
  return null;
}

function balanceTimestamp(item: CollectorAccountBalance) {
  return Math.max(timestamp(item.received_at), timestamp(item.observed_at));
}
