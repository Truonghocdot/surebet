"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchDashboardSnapshot,
  fetchMatchedFixtures,
  fetchOpportunityBoard,
  fetchOpportunities
} from "@/features/dashboard/api/mock-dashboard-api";
import type {
  MatchedFixturesSnapshot,
  OpportunityBoard
} from "@/features/dashboard/schemas/crm-schemas";
import { backendWebSocketURL } from "@/lib/realtime-url";
import {
  applyRealtimeMatchedFixtures,
  applyRealtimeOddsQuotes,
  type RealtimeOddsQuote
} from "@/lib/realtime-opportunity-board";

export const crmQueryKeys = {
  dashboard: ["crm", "dashboard"] as const,
  matchedFixtures: ["crm", "matched-fixtures"] as const,
  opportunityBoard: ["crm", "opportunity-board"] as const,
  opportunities: ["crm", "opportunities"] as const
};

export function useDashboardSnapshotQuery() {
  return useQuery({
    queryKey: crmQueryKeys.dashboard,
    queryFn: fetchDashboardSnapshot
  });
}

export function useOpportunitiesQuery() {
  return useQuery({
    queryKey: crmQueryKeys.opportunities,
    queryFn: fetchOpportunities
  });
}

export function useOpportunityBoardQuery() {
  return useQuery({
    queryKey: crmQueryKeys.opportunityBoard,
    queryFn: fetchOpportunityBoard,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false
  });
}

export function useMatchedFixturesQuery() {
  return useQuery({
    queryKey: crmQueryKeys.matchedFixtures,
    queryFn: fetchMatchedFixtures
  });
}

type RealtimeStatus = "connecting" | "live" | "reconnecting";

export function useRealtimeWebSocket() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<RealtimeStatus>("connecting");

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let closed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let boardRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    let secondaryRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    let lastBoardRefreshAt = 0;
    let lastSecondaryRefreshAt = 0;

    const flushBoardQuery = () => {
      boardRefreshTimer = null;
      lastBoardRefreshAt = Date.now();
      void queryClient.invalidateQueries({ queryKey: crmQueryKeys.opportunityBoard });
    };

    const flushSecondaryQueries = () => {
      secondaryRefreshTimer = null;
      lastSecondaryRefreshAt = Date.now();
      void queryClient.invalidateQueries({ queryKey: crmQueryKeys.dashboard });
      void queryClient.invalidateQueries({ queryKey: crmQueryKeys.opportunities });
      void queryClient.invalidateQueries({ queryKey: crmQueryKeys.matchedFixtures });
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
          if (message.type === "odds_updated") {
            const quotes = extractRealtimeOddsQuotes(message);
            const hasBoardQuote = quotes.some(isRealtimeBoardQuote);
            if (hasBoardQuote) {
              queryClient.setQueryData<OpportunityBoard>(
                crmQueryKeys.opportunityBoard,
                (current) => current
                  ? applyRealtimeOddsQuotes(current, quotes).board
                  : current
              );
            }
            if (quotes.length > 0) {
              queryClient.setQueryData<MatchedFixturesSnapshot>(
                crmQueryKeys.matchedFixtures,
                (current) => current
                  ? applyRealtimeMatchedFixtures(current, quotes)
                  : current
              );
            }
            if (quotes.length === 0 || hasBoardQuote) {
              scheduleBoardRefresh();
            }
            scheduleSecondaryRefresh();
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
  }, [queryClient]);

  return status;
}

type RealtimeMessage = {
  type?: string;
  payload?: {
    payload?: {
      quotes?: unknown[];
    };
  };
};

function extractRealtimeOddsQuotes(message: RealtimeMessage): RealtimeOddsQuote[] {
  const quotes = message.payload?.payload?.quotes;
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
