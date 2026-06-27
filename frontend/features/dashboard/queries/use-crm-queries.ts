"use client";

import { useQuery } from "@tanstack/react-query";
import {
  fetchAccounts,
  fetchDashboardSnapshot,
  fetchFeatureFlags,
  fetchOpportunities,
  fetchOrders,
  fetchRiskCheckpoints
} from "@/features/dashboard/api/mock-dashboard-api";

export const crmQueryKeys = {
  dashboard: ["crm", "dashboard"] as const,
  opportunities: ["crm", "opportunities"] as const,
  orders: ["crm", "orders"] as const,
  accounts: ["crm", "accounts"] as const,
  risk: ["crm", "risk"] as const,
  flags: ["crm", "flags"] as const
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

