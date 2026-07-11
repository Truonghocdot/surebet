"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createTelegramRecipient,
  deleteTelegramRecipient,
  fetchTelegramRecipients,
  updateTelegramRecipient
} from "@/features/admin/api/telegram-recipients-api";
import type { UpsertTelegramRecipientInput } from "@/features/admin/schemas/telegram-recipient-schemas";

export const adminQueryKeys = {
  telegramRecipients: ["admin", "telegram-recipients"] as const
};

export function useTelegramRecipientsQuery() {
  return useQuery({
    queryKey: adminQueryKeys.telegramRecipients,
    queryFn: fetchTelegramRecipients
  });
}

export function useCreateTelegramRecipientMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpsertTelegramRecipientInput) => createTelegramRecipient(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.telegramRecipients });
    }
  });
}

export function useUpdateTelegramRecipientMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: UpsertTelegramRecipientInput }) =>
      updateTelegramRecipient(id, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.telegramRecipients });
    }
  });
}

export function useDeleteTelegramRecipientMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => deleteTelegramRecipient(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.telegramRecipients });
    }
  });
}
