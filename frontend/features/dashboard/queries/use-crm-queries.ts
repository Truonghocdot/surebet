"use client";

import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchDashboardSnapshot } from "@/features/dashboard/api/crm-api";
import { opportunitySchema } from "@/features/dashboard/schemas/crm-schemas";
import { backendWebSocketURL } from "@/lib/realtime-url";
import { useSessionStore } from "@/features/auth/store/session-store";
import { isOpportunityVisibleForRole } from "@/lib/opportunity-visibility";
import { useRealtimeNotificationStore } from "@/store/realtime-notification-store";
import { buildOpportunityNotificationDetails } from "@/lib/opportunity-notification";

export const crmQueryKeys = {
  dashboard: ["crm", "dashboard"] as const
};

export function useDashboardSnapshotQuery() {
  return useQuery({
    queryKey: crmQueryKeys.dashboard,
    queryFn: fetchDashboardSnapshot,
    // Realtime websocket invalidates this query on odds changes. The interval
    // is only a fallback when the socket is unavailable.
    refetchInterval: 15_000,
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
    let dashboardRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    let lastDashboardRefreshAt = 0;

    const flushDashboardQuery = () => {
      dashboardRefreshTimer = null;
      lastDashboardRefreshAt = Date.now();
      void queryClient.invalidateQueries({ queryKey: crmQueryKeys.dashboard });
    };

    const scheduleDashboardRefresh = () => {
      if (dashboardRefreshTimer || closed) {
        return;
      }

      const elapsed = Date.now() - lastDashboardRefreshAt;
      const delay = elapsed >= 1_000 ? 0 : 1_000 - elapsed;
      dashboardRefreshTimer = setTimeout(flushDashboardQuery, delay);
    };

    const connect = () => {
      if (closed) {
        return;
      }

      socket = new WebSocket(backendWebSocketURL());

      socket.onopen = () => {
        setStatus("live");
        scheduleDashboardRefresh();
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as RealtimeMessage;
          if (message.type === "connected") {
            setStatus("live");
            return;
          }
          if (message.type === "odds_updated" || message.type === "fixture_odds_snapshot") {
            scheduleDashboardRefresh();
            setStatus("live");
          }
          if (message.type === "surebet_verification_updated") {
            const verification = extractRealtimeVerification(message);
            if (verification && (
              !verification.opportunity ||
              isOpportunityVisibleForRole(verification.opportunity, roleRef.current)
            )) {
              if (verification.status === "confirmed" && verification.opportunity) {
                pushNotification(opportunityNotification("confirmed", verification.opportunity));
              }
            }
            scheduleDashboardRefresh();
            setStatus("live");
          }
          if (message.type === "surebet_candidate_detected") {
            const candidate = extractRealtimeCandidate(message);
            if (candidate && isOpportunityVisibleForRole(candidate, roleRef.current)) {
              pushNotification(opportunityNotification("candidate", candidate));
            }
            scheduleDashboardRefresh();
            setStatus("live");
          }
          if (
            message.type === "auto_bet_live_updated" ||
            message.type === "bet_exposure_updated"
          ) {
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
      if (dashboardRefreshTimer) {
        clearTimeout(dashboardRefreshTimer);
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
};

type RealtimeVerificationEvent = {
  opportunity_id: string;
  status: "confirmed" | "rejected" | "expired";
  reason?: string;
  confirmed_at?: string;
  valid_until?: string;
  opportunity?: ReturnType<typeof opportunitySchema.parse>;
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
