import { crmHttp } from "@/lib/http";
import {
  telegramRecipientSchema,
  type TelegramRecipient,
  type UpsertTelegramRecipientInput
} from "@/features/admin/schemas/telegram-recipient-schemas";

export async function fetchTelegramRecipients() {
  const response = await crmHttp.get("/admin/telegram-recipients");
  return (response.data as unknown[]).map((item) => telegramRecipientSchema.parse(item));
}

export async function createTelegramRecipient(input: UpsertTelegramRecipientInput) {
  const response = await crmHttp.post("/admin/telegram-recipients", input);
  return telegramRecipientSchema.parse(response.data);
}

export async function updateTelegramRecipient(
  id: number,
  input: UpsertTelegramRecipientInput
) {
  const response = await crmHttp.put(`/admin/telegram-recipients/${id}`, input);
  return telegramRecipientSchema.parse(response.data);
}

export async function deleteTelegramRecipient(id: number) {
  await crmHttp.delete(`/admin/telegram-recipients/${id}`);
}

export function sortTelegramRecipients(items: TelegramRecipient[]) {
  return [...items].sort((left, right) => {
    if (left.is_active !== right.is_active) {
      return left.is_active ? -1 : 1;
    }
    return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
  });
}
