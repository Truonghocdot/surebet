"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchDashboardSnapshot,
  fetchMatchedFixtures,
  fetchOpportunities
} from "@/features/dashboard/api/mock-dashboard-api";
import { backendWebSocketURL } from "@/lib/realtime-url";

export const crmQueryKeys = {
  dashboard: ["crm", "dashboard"] as const,
  matchedFixtures: ["crm", "matched-fixtures"] as const,
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

    const refreshRealtimeQueries = () => {
      void queryClient.invalidateQueries({ queryKey: crmQueryKeys.dashboard });
      void queryClient.invalidateQueries({ queryKey: crmQueryKeys.opportunities });
      void queryClient.invalidateQueries({ queryKey: crmQueryKeys.matchedFixtures });
    };

    const connect = () => {
      if (closed) {
        return;
      }

      socket = new WebSocket(backendWebSocketURL());

      socket.onopen = () => {
        setStatus("live");
        refreshRealtimeQueries();
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as { type?: string };
          if (message.type === "connected") {
            setStatus("live");
            return;
          }
          if (message.type === "odds_updated") {
            refreshRealtimeQueries();
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
      socket?.close();
    };
  }, [queryClient]);

  return status;
}
