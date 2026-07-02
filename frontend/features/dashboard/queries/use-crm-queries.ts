"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchAccounts,
  fetchBookmakerSettings,
  fetchDashboardSnapshot,
  fetchFeatureFlags,
  fetchOpportunities,
  fetchOrders,
  fetchRiskCheckpoints,
  updateBookmakerSetting
} from "@/features/dashboard/api/mock-dashboard-api";
import {
  opportunitySchema,
  type UpdateBookmakerSettingInput
} from "@/features/dashboard/schemas/crm-schemas";

export const crmQueryKeys = {
  dashboard: ["crm", "dashboard"] as const,
  opportunities: ["crm", "opportunities"] as const,
  orders: ["crm", "orders"] as const,
  accounts: ["crm", "accounts"] as const,
  risk: ["crm", "risk"] as const,
  flags: ["crm", "flags"] as const,
  settings: ["crm", "settings"] as const
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

export function useOrdersQuery() {
  return useQuery({
    queryKey: crmQueryKeys.orders,
    queryFn: fetchOrders
  });
}

export function useAccountsQuery() {
  return useQuery({
    queryKey: crmQueryKeys.accounts,
    queryFn: fetchAccounts
  });
}

export function useRiskCheckpointsQuery() {
  return useQuery({
    queryKey: crmQueryKeys.risk,
    queryFn: fetchRiskCheckpoints
  });
}

export function useFeatureFlagsQuery() {
  return useQuery({
    queryKey: crmQueryKeys.flags,
    queryFn: fetchFeatureFlags
  });
}

export function useBookmakerSettingsQuery() {
  return useQuery({
    queryKey: crmQueryKeys.settings,
    queryFn: fetchBookmakerSettings
  });
}

export function useUpdateBookmakerSettingMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: UpdateBookmakerSettingInput) =>
      updateBookmakerSetting(payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: crmQueryKeys.settings }),
        queryClient.invalidateQueries({ queryKey: crmQueryKeys.accounts }),
        queryClient.invalidateQueries({ queryKey: crmQueryKeys.dashboard })
      ]);
    }
  });
}
