"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchAutoBetMonitorSnapshot,
  updateAutoBetControl
} from "@/features/auto-bet/api/auto-bet-api";

export const autoBetQueryKey = ["crm", "auto-bet"] as const;

export function useAutoBetMonitorQuery() {
  return useQuery({
    queryKey: autoBetQueryKey,
    queryFn: fetchAutoBetMonitorSnapshot,
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: 1
  });
}

export function useAutoBetControlMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateAutoBetControl,
    onSuccess: (snapshot) => {
      queryClient.setQueryData(autoBetQueryKey, snapshot);
    }
  });
}
