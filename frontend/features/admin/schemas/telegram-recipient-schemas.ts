import { z } from "zod";

export const telegramRecipientSchema = z.object({
  id: z.number(),
  name: z.string(),
  chat_id: z.string(),
  is_active: z.boolean(),
  notes: z.string(),
  source: z.string(),
  chat_type: z.string(),
  telegram_username: z.string(),
  membership_status: z.string(),
  last_seen_at: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string()
});

export const upsertTelegramRecipientSchema = z.object({
  name: z.string().trim().min(1, "Tên hiển thị là bắt buộc."),
  chat_id: z.string().trim().min(1, "Chat ID là bắt buộc."),
  is_active: z.boolean(),
  notes: z.string()
});

export type TelegramRecipient = z.infer<typeof telegramRecipientSchema>;
export type UpsertTelegramRecipientInput = z.infer<typeof upsertTelegramRecipientSchema>;
