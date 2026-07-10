"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchDashboardSnapshot,
  fetchOpportunities
} from "@/features/dashboard/api/mock-dashboard-api";
import { opportunitySchema } from "@/features/dashboard/schemas/crm-schemas";

export const crmQueryKeys = {
  dashboard: ["crm", "dashboard"] as const,
  opportunities: ["crm", "opportunities"] as const
};

export function useDashboardSnapshotQuery() {
  return useQuery({
    queryKey: crmQueryKeys.dashboard,
    queryFn: fetchDashboardSnapshot,
    refetchInterval: 5_000,
    refetchIntervalInBackground: true
  });
}

export function useOpportunitiesQuery() {
  return useQuery({
    queryKey: crmQueryKeys.opportunities,
    queryFn: fetchOpportunities,
    refetchInterval: 5_000,
    refetchIntervalInBackground: true
  });
}

export function useOpportunitiesStream() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<"connecting" | "live" | "fallback">("connecting");

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const source = new EventSource("/api/crm/opportunities/stream");

    source.onopen = () => {
      setStatus("live");
    };

    source.addEventListener("opportunities", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data);
        const opportunities = Array.isArray(payload)
          ? payload.map((item) => opportunitySchema.parse(item))
          : [];
        queryClient.setQueryData(crmQueryKeys.opportunities, opportunities);
        void queryClient.invalidateQueries({ queryKey: crmQueryKeys.dashboard });
        setStatus("live");
      } catch {
        setStatus("fallback");
      }
    });

    source.addEventListener("stream-error", () => {
      setStatus("fallback");
    });

    source.onerror = () => {
      setStatus("fallback");
    };

    return () => {
      source.close();
    };
  }, [queryClient]);

  return status;
}
