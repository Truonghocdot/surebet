"use client";

import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchDashboardSnapshot,
  fetchOpportunityBoard
} from "@/features/dashboard/api/crm-api";
import {
  opportunitySchema,
  type OpportunityBoard
} from "@/features/dashboard/schemas/crm-schemas";
import { backendWebSocketURL } from "@/lib/realtime-url";
import { useSessionStore } from "@/features/auth/store/session-store";
import {
  filterOpportunityBoardForRole,
  isOpportunityVisibleForRole
} from "@/lib/opportunity-visibility";
import { useRealtimeNotificationStore } from "@/store/realtime-notification-store";
import {
  applyRealtimeOddsQuotes,
  applyRealtimeVerification,
  type RealtimeVerificationEvent,
  type RealtimeOddsQuote
} from "@/lib/realtime-opportunity-board";
import { buildOpportunityNotificationDetails } from "@/lib/opportunity-notification";
import { mergeOpportunityBoardsMonotonically } from "@/lib/opportunity-board-merge";

export const crmQueryKeys = {
  dashboard: ["crm", "dashboard"] as const,
  opportunityBoard: (role: string | null | undefined) =>
    ["crm", "opportunity-board", role ?? "anonymous"] as const
};

export function useDashboardSnapshotQuery() {
  return useQuery({
    queryKey: crmQueryKeys.dashboard,
    queryFn: fetchDashboardSnapshot,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false
  });
}

export function useOpportunityBoardQuery() {
  const role = useSessionStore((state) => state.user?.role);
  return useQuery({
    queryKey: crmQueryKeys.opportunityBoard(role),
    queryFn: ({ signal }) => fetchOpportunityBoard(signal),
    select: (board) => filterOpportunityBoardForRole(board, role),
    retry: false,
    structuralSharing: (previous, incoming) =>
      mergeOpportunityBoardsMonotonically(
        previous as OpportunityBoard | undefined,
        incoming as OpportunityBoard
      ),
    // Keep the REST safety net aligned with the v2 market freshness window.
    refetchInterval: 3_000,
    refetchIntervalInBackground: false
  });
}

export function useRealtimeWebSocket() {
  const queryClient = useQueryClient();
  const role = useSessionStore((state) => state.user?.role);
  const roleRef = useRef(role);
  const setStatus = useRealtimeNotificationStore((state) => state.setStatus);
  const pushNotification = useRealtimeNotificationStore((state) => state.pushNotification);

  useEffect(() => {
    roleRef.current = role;
  }, [role]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let closed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let boardRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    let secondaryRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    let boardMutationQueue = Promise.resolve();
    let lastBoardRefreshAt = 0;
    let lastSecondaryRefreshAt = 0;

    const flushBoardQuery = () => {
      boardRefreshTimer = null;
      lastBoardRefreshAt = Date.now();
      void queryClient.invalidateQueries({
        queryKey: crmQueryKeys.opportunityBoard(roleRef.current)
      });
    };

    const flushSecondaryQueries = () => {
      secondaryRefreshTimer = null;
      lastSecondaryRefreshAt = Date.now();
      void queryClient.invalidateQueries({ queryKey: crmQueryKeys.dashboard });
    };

    const scheduleBoardRefresh = () => {
      if (boardRefreshTimer || closed) {
        return;
      }

      const elapsed = Date.now() - lastBoardRefreshAt;
      const delay = elapsed >= 1_000 ? 0 : 1_000 - elapsed;
      boardRefreshTimer = setTimeout(flushBoardQuery, delay);
    };

    const scheduleSecondaryRefresh = () => {
      if (secondaryRefreshTimer || closed) {
        return;
      }

      const elapsed = Date.now() - lastSecondaryRefreshAt;
      const delay = elapsed >= 5_000 ? 0 : 5_000 - elapsed;
      secondaryRefreshTimer = setTimeout(flushSecondaryQueries, delay);
    };

    const enqueueRealtimeOdds = (quotes: RealtimeOddsQuote[]) => {
      const queryKey = crmQueryKeys.opportunityBoard(roleRef.current);
      boardMutationQueue = boardMutationQueue
        .catch(() => undefined)
        .then(async () => {
          await queryClient.cancelQueries({ queryKey }, { silent: true });
          if (closed) {
            return;
          }
          queryClient.setQueryData<OpportunityBoard>(queryKey, (current) => current
            ? applyRealtimeOddsQuotes(current, quotes).board
            : current
          );
          scheduleBoardRefresh();
        })
        .catch(() => {
          if (!closed) {
            scheduleBoardRefresh();
          }
        });
    };

    const enqueueRealtimeVerification = (verification: RealtimeVerificationEvent) => {
      const queryKey = crmQueryKeys.opportunityBoard(roleRef.current);
      boardMutationQueue = boardMutationQueue
        .catch(() => undefined)
        .then(async () => {
          await queryClient.cancelQueries({ queryKey }, { silent: true });
          if (closed) {
            return;
          }
          queryClient.setQueryData<OpportunityBoard>(queryKey, (current) => current
            ? applyRealtimeVerification(current, verification)
            : current
          );
          scheduleBoardRefresh();
        })
        .catch(() => {
          if (!closed) {
            scheduleBoardRefresh();
          }
        });
    };

    const connect = () => {
      if (closed) {
        return;
      }

      socket = new WebSocket(backendWebSocketURL());

      socket.onopen = () => {
        setStatus("live");
        scheduleBoardRefresh();
        scheduleSecondaryRefresh();
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as RealtimeMessage;
          if (message.type === "connected") {
            setStatus("live");
            return;
          }
          if (message.type === "odds_updated" || message.type === "fixture_odds_snapshot") {
            const quotes = extractRealtimeOddsQuotes(message);
            const hasBoardQuote = quotes.some(isRealtimeBoardQuote);
            if (hasBoardQuote) {
              enqueueRealtimeOdds(quotes);
            }
            if (quotes.length === 0) {
              scheduleBoardRefresh();
            }
            scheduleSecondaryRefresh();
            setStatus("live");
          }
          if (message.type === "surebet_verification_updated") {
            const verification = extractRealtimeVerification(message);
            if (verification && (
              !verification.opportunity ||
              isOpportunityVisibleForRole(verification.opportunity, roleRef.current)
            )) {
              enqueueRealtimeVerification(verification);
              if (verification.status === "confirmed" && verification.opportunity) {
                pushNotification(opportunityNotification("confirmed", verification.opportunity));
              }
            }
            scheduleBoardRefresh();
            scheduleSecondaryRefresh();
            setStatus("live");
          }
          if (message.type === "surebet_candidate_detected") {
            const candidate = extractRealtimeCandidate(message);
            if (candidate && isOpportunityVisibleForRole(candidate, roleRef.current)) {
              pushNotification(opportunityNotification("candidate", candidate));
              scheduleBoardRefresh();
              scheduleSecondaryRefresh();
            }
            setStatus("live");
          }
        } catch {
          setStatus("reconnecting");
        }
      };

      socket.onerror = () => {
        setStatus("reconnecting");
      };

      socket.onclose = () => {
        if (closed) {
          return;
        }
        setStatus("reconnecting");
        reconnectTimer = setTimeout(connect, 2_000);
      };
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      if (boardRefreshTimer) {
        clearTimeout(boardRefreshTimer);
      }
      if (secondaryRefreshTimer) {
        clearTimeout(secondaryRefreshTimer);
      }
      socket?.close();
    };
  }, [pushNotification, queryClient, setStatus]);
}

type RealtimeMessage = {
  type?: string;
  payload?: unknown;
};

type RealtimeVerificationPayload = {
    opportunity_id?: unknown;
    status?: unknown;
    reason?: unknown;
    confirmed_at?: unknown;
    valid_until?: unknown;
    opportunity?: unknown;
    payload?: {
      quotes?: unknown[];
    };
};

function extractRealtimeVerification(
  message: RealtimeMessage
): RealtimeVerificationEvent | null {
  const payload = message.payload as RealtimeVerificationPayload | undefined;
  if (!payload || typeof payload.opportunity_id !== "string" ||
    (payload.status !== "confirmed" && payload.status !== "rejected" && payload.status !== "expired")) {
    return null;
  }
  const opportunity = opportunitySchema.safeParse(payload.opportunity);
  return {
    opportunity_id: payload.opportunity_id,
    status: payload.status,
    reason: typeof payload.reason === "string" ? payload.reason : undefined,
    confirmed_at: typeof payload.confirmed_at === "string" ? payload.confirmed_at : undefined,
    valid_until: typeof payload.valid_until === "string" ? payload.valid_until : undefined,
    opportunity: opportunity.success ? opportunity.data : undefined
  };
}

function extractRealtimeCandidate(message: RealtimeMessage) {
  const candidate = opportunitySchema.safeParse(message.payload);
  if (!candidate.success || candidate.data.verification_status !== "candidate") {
    return null;
  }
  return candidate.data;
}

function opportunityNotification(
  kind: "candidate" | "confirmed",
  opportunity: ReturnType<typeof opportunitySchema.parse>
) {
  const details = buildOpportunityNotificationDetails(opportunity);
  return {
    kind,
    opportunityID: opportunity.id,
    fixtureID: opportunity.fixture_id,
    marketName: opportunity.market_name,
    profitPercentage: opportunity.profit_percentage,
    ...details
  };
}

function extractRealtimeOddsQuotes(message: RealtimeMessage): RealtimeOddsQuote[] {
  const quotes = (message.payload as RealtimeVerificationPayload | undefined)?.payload?.quotes;
  if (!Array.isArray(quotes)) {
    return [];
  }

  return quotes.filter(isRealtimeOddsQuote);
}

function isRealtimeOddsQuote(value: unknown): value is RealtimeOddsQuote {
  if (!value || typeof value !== "object") {
    return false;
  }
  const quote = value as Partial<RealtimeOddsQuote>;
  return (
    typeof quote.bookmaker_id === "string" &&
    typeof quote.lobby_id === "string" &&
    typeof quote.fixture_id === "string" &&
    typeof quote.market_id === "string" &&
    typeof quote.outcome_id === "string" &&
    typeof quote.odds === "number" &&
    typeof quote.collected_at === "string"
  );
}

function isRealtimeBoardQuote(quote: RealtimeOddsQuote) {
  const marketID = quote.market_id.trim().toLowerCase();
  return (
    marketID === "hdp-ah" ||
    marketID === "hdp-ah-1st" ||
    marketID === "o-u-ou" ||
    marketID === "o-u-ou-1st"
  );
}
