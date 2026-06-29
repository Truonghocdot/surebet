"use client";

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
import type { UpdateBookmakerSettingInput } from "@/features/dashboard/schemas/crm-schemas";

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
    queryFn: fetchDashboardSnapshot
  });
}

export function useOpportunitiesQuery() {
  return useQuery({
    queryKey: crmQueryKeys.opportunities,
    queryFn: fetchOpportunities
  });
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

