"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchCollectorConfig,
  updateCollectorConfig
} from "@/features/admin/api/collector-config-api";
import type { CollectorConfig } from "@/features/admin/schemas/collector-config-schemas";

export const collectorConfigQueryKey = ["admin", "collector-config"] as const;

export function useCollectorConfigQuery() {
  return useQuery({
    queryKey: collectorConfigQueryKey,
    queryFn: fetchCollectorConfig
  });
}

export function useUpdateCollectorConfigMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CollectorConfig) => updateCollectorConfig(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: collectorConfigQueryKey });
    }
  });
}
