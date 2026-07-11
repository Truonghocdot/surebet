import { fetchBackendJSON } from "@/lib/server-api";

export type BackendTelegramRecipient = {
  id: number;
  name: string;
  chat_id: string;
  is_active: boolean;
  notes: string;
  source: string;
  chat_type: string;
  telegram_username: string;
  membership_status: string;
  last_seen_at?: string | null;
  created_at: string;
  updated_at: string;
};

export async function fetchBackendTelegramRecipients() {
  const payload = await fetchBackendJSON<{ data: BackendTelegramRecipient[] }>(
    "/v1/admin/telegram-recipients"
  );
  return payload.data;
}
