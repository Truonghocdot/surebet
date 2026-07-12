"use client";

import { useEffect, useState, startTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataPanel } from "@/components/dashboard/data-panel";
import { SectionHeader } from "@/components/dashboard/section-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { QueryShell } from "@/features/dashboard/components/query-shell";
import {
  useCreateTelegramRecipientMutation,
  useDeleteTelegramRecipientMutation,
  useTelegramRecipientsQuery,
  useUpdateTelegramRecipientMutation
} from "@/features/admin/queries/use-telegram-recipient-queries";
import {
  sortTelegramRecipients
} from "@/features/admin/api/telegram-recipients-api";
import {
  upsertTelegramRecipientSchema,
  type TelegramRecipient
} from "@/features/admin/schemas/telegram-recipient-schemas";
import { useSessionStore } from "@/features/auth/store/session-store";

type FormState = {
  name: string;
  chat_id: string;
  is_active: boolean;
  notes: string;
};

const emptyForm: FormState = {
  name: "",
  chat_id: "",
  is_active: true,
  notes: ""
};

export function AdminTelegramRecipientsScreen() {
  const user = useSessionStore((state) => state.user);
  const query = useTelegramRecipientsQuery();
  const createMutation = useCreateTelegramRecipientMutation();
  const updateMutation = useUpdateTelegramRecipientMutation();
  const deleteMutation = useDeleteTelegramRecipientMutation();
  const [selectedID, setSelectedID] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState<string>("");

  const recipients = sortTelegramRecipients(query.data ?? []);
  const selectedRecipient =
    recipients.find((item) => item.id === selectedID) ?? null;

  useEffect(() => {
    if (!selectedRecipient) {
      setForm(emptyForm);
      return;
    }

    setForm({
      name: selectedRecipient.name,
      chat_id: selectedRecipient.chat_id,
      is_active: selectedRecipient.is_active,
      notes: selectedRecipient.notes
    });
  }, [selectedRecipient]);

  useEffect(() => {
    if (selectedID !== null) {
      return;
    }

    const first = recipients[0];
    if (!first) {
      return;
    }

    startTransition(() => {
      setSelectedID(first.id);
    });
  }, [recipients, selectedID]);

  if (!user) {
    return (
      <div className="dashboard-page">
        <SectionHeader
          eyebrow="Super Admin"
          title="Đang tải quyền quản trị"
          description="Dashboard đang hydrate phiên đăng nhập trước khi mở khu quản trị Telegram."
        />
      </div>
    );
  }

  if (user?.role !== "super_admin") {
    return (
      <div className="dashboard-page">
        <SectionHeader
          eyebrow="Quản trị"
          title="Khu vực chỉ dành cho super admin"
          description="Tài khoản hiện tại không có quyền quản lý người nhận Telegram."
        />
      </div>
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");

    const parsed = upsertTelegramRecipientSchema.safeParse(form);
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "Dữ liệu chưa hợp lệ.");
      return;
    }

    try {
      if (selectedRecipient) {
        const saved = await updateMutation.mutateAsync({
          id: selectedRecipient.id,
          input: parsed.data
        });
        setSelectedID(saved.id);
      } else {
        const created = await createMutation.mutateAsync(parsed.data);
        setSelectedID(created.id);
      }
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Không lưu được người nhận Telegram."
      );
    }
  }

  async function handleDelete() {
    if (!selectedRecipient) {
      return;
    }

    const confirmed = window.confirm(
      `Xóa người nhận "${selectedRecipient.name}" khỏi danh sách?`
    );
    if (!confirmed) {
      return;
    }

    try {
      await deleteMutation.mutateAsync(selectedRecipient.id);
      setSelectedID(null);
      setForm(emptyForm);
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Không xóa được người nhận Telegram."
      );
    }
  }

  return (
    <div className="dashboard-page">
      <SectionHeader
        eyebrow="Super Admin"
        title="Quản lý người nhận Telegram"
        description="Thay dần phần Filament nặng nề bằng một khu quản trị gọn trong dashboard. Record tạo từ webhook vẫn mặc định tắt thông báo cho tới khi mình bật lại."
      />

      <QueryShell<TelegramRecipient[]> {...query}>
        {(items) => {
          const activeCount = items.filter((item) => item.is_active).length;
          const webhookCount = items.filter((item) => item.source === "telegram_webhook").length;
          const inactiveWebhookCount = items.filter(
            (item) => item.source === "telegram_webhook" && !item.is_active
          ).length;

          return (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  title="Tổng recipients"
                  value={String(items.length)}
                  delta="Chat cá nhân, group, channel"
                  tone={items.length > 0 ? "neutral" : "warning"}
                />
                <StatCard
                  title="Đang bật"
                  value={String(activeCount)}
                  delta="Sẽ được worker dùng để gửi"
                  tone={activeCount > 0 ? "positive" : "warning"}
                />
                <StatCard
                  title="Tạo từ webhook"
                  value={String(webhookCount)}
                  delta="Được sync khi bot vào chat"
                  tone={webhookCount > 0 ? "positive" : "neutral"}
                />
                <StatCard
                  title="Webhook chưa bật"
                  value={String(inactiveWebhookCount)}
                  delta="Cần super admin xác nhận"
                  tone={inactiveWebhookCount > 0 ? "warning" : "neutral"}
                />
              </div>

              <div className="grid gap-4 md:gap-5 xl:grid-cols-[minmax(0,1.2fr)_420px]">
                <DataPanel
                  title="Danh sách người nhận"
                  description="Chọn một dòng để chỉnh sửa hoặc tạo mới một chat nhận thông báo."
                >
                  <div className="flex flex-col items-start gap-3 pb-4 sm:flex-row sm:items-center">
                    <Button
                      className="w-full sm:w-auto"
                      onClick={() => {
                        setSelectedID(null);
                        setForm(emptyForm);
                        setFormError("");
                      }}
                      type="button"
                      variant="secondary"
                    >
                      Tạo recipient mới
                    </Button>
                    <Badge variant="orange">Webhook mới tạo vẫn đang tắt</Badge>
                  </div>

                  <div className="grid gap-3">
                    {recipients.length === 0 ? (
                      <div className="rounded-[24px] border border-dashed border-[color:var(--line)] px-5 py-8 text-sm text-[var(--muted)]">
                        Chưa có recipient nào.
                      </div>
                    ) : null}

                    {recipients.map((item) => {
                      const active = item.id === selectedID;
                      return (
                        <button
                          className={`rounded-[24px] border px-4 py-4 text-left transition ${
                            active
                              ? "border-[var(--accent)] bg-[var(--surface-soft)] shadow-[inset_0_0_0_1px_rgba(11,138,119,0.18)]"
                              : "border-[color:var(--line)] bg-white/70 hover:bg-white"
                          }`}
                          key={item.id}
                          onClick={() => setSelectedID(item.id)}
                          type="button"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="font-semibold text-[var(--ink)]">{item.name}</p>
                              <p className="mt-1 break-all text-sm text-[var(--muted)]">
                                {item.chat_id}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Badge variant={item.is_active ? "teal" : "red"}>
                                {item.is_active ? "Đang bật" : "Đang tắt"}
                              </Badge>
                              <Badge variant={item.source === "telegram_webhook" ? "orange" : "slate"}>
                                {item.source || "manual"}
                              </Badge>
                            </div>
                          </div>

                          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
                            <span>{item.chat_type || "chat?"}</span>
                            <span>{item.membership_status || "membership?"}</span>
                            <span>{formatRelative(item.updated_at)}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </DataPanel>

                <DataPanel
                  title={selectedRecipient ? "Chỉnh sửa recipient" : "Tạo recipient mới"}
                  description="Form này thay cho màn hình Filament của TelegramRecipients."
                >
                  <form className="grid gap-4" onSubmit={handleSubmit}>
                    <div>
                      <Label htmlFor="recipient-name">Tên hiển thị</Label>
                      <Input
                        id="recipient-name"
                        onChange={(event) =>
                          setForm((current) => ({ ...current, name: event.target.value }))
                        }
                        placeholder="Ví dụ: Surebet Ops"
                        value={form.name}
                      />
                    </div>

                    <div>
                      <Label htmlFor="recipient-chat-id">Chat ID Telegram</Label>
                      <Input
                        id="recipient-chat-id"
                        onChange={(event) =>
                          setForm((current) => ({ ...current, chat_id: event.target.value }))
                        }
                        placeholder="123456789 hoặc -1001234567890"
                        value={form.chat_id}
                      />
                    </div>

                    <div className="rounded-[22px] border border-[color:var(--line)] bg-[var(--surface-soft)] px-4 py-4">
                      <label className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-[var(--ink)]">Bật thông báo</p>
                          <p className="text-sm text-[var(--muted)]">
                            Chỉ recipient đang bật mới được `telegram-worker` gửi surebet.
                          </p>
                        </div>
                        <input
                          checked={form.is_active}
                          className="mt-1 size-5 shrink-0 accent-[var(--accent)]"
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              is_active: event.target.checked
                            }))
                          }
                          type="checkbox"
                        />
                      </label>
                    </div>

                    <div>
                      <Label htmlFor="recipient-notes">Ghi chú</Label>
                      <textarea
                        className="min-h-[112px] w-full rounded-[20px] border border-[color:var(--line)] bg-white px-4 py-3 text-base text-[var(--ink)] shadow-sm outline-none focus:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]/20 sm:rounded-[22px] sm:text-sm"
                        id="recipient-notes"
                        onChange={(event) =>
                          setForm((current) => ({ ...current, notes: event.target.value }))
                        }
                        placeholder="Ghi chú nội bộ cho chat này"
                        value={form.notes}
                      />
                    </div>

                    {selectedRecipient ? (
                      <div className="rounded-[20px] border border-[color:var(--line)] bg-[var(--surface-soft)] px-4 py-4 text-sm sm:rounded-[22px]">
                        <p className="mb-3 font-semibold text-[var(--ink)]">Metadata webhook</p>
                        <div className="grid gap-2 text-[var(--muted)]">
                          <p>Nguồn: {selectedRecipient.source || "manual"}</p>
                          <p>Loại chat: {selectedRecipient.chat_type || "chưa rõ"}</p>
                          <p>Username: {selectedRecipient.telegram_username || "không có"}</p>
                          <p>Membership: {selectedRecipient.membership_status || "không có"}</p>
                          <p>
                            Lần cuối bot được thấy:{" "}
                            {selectedRecipient.last_seen_at
                              ? formatDateTime(selectedRecipient.last_seen_at)
                              : "chưa có"}
                          </p>
                        </div>
                      </div>
                    ) : null}

                    {formError ? (
                      <p className="text-sm text-[var(--danger)]">{formError}</p>
                    ) : null}

                    <div className="flex flex-col gap-3 sm:flex-row">
                      <Button
                        className="w-full sm:w-auto"
                        disabled={createMutation.isPending || updateMutation.isPending}
                        type="submit"
                      >
                        {selectedRecipient ? "Lưu thay đổi" : "Tạo recipient"}
                      </Button>
                      {selectedRecipient ? (
                        <Button
                          className="w-full sm:w-auto"
                          disabled={deleteMutation.isPending}
                          onClick={handleDelete}
                          type="button"
                          variant="danger"
                        >
                          Xóa recipient
                        </Button>
                      ) : null}
                    </div>
                  </form>
                </DataPanel>
              </div>
            </>
          );
        }}
      </QueryShell>
    </div>
  );
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("vi-VN");
}

function formatRelative(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) {
    return `${seconds} giây trước`;
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)} phút trước`;
  }
  return `${Math.floor(seconds / 3600)} giờ trước`;
}
