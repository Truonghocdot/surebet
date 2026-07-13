"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataPanel } from "@/components/dashboard/data-panel";
import { SectionHeader } from "@/components/dashboard/section-header";
import { QueryShell } from "@/features/dashboard/components/query-shell";
import { useSessionStore } from "@/features/auth/store/session-store";
import { useCollectorConfigQuery, useUpdateCollectorConfigMutation } from "@/features/admin/queries/use-collector-config-query";
import type { CollectorConfig } from "@/features/admin/schemas/collector-config-schemas";

const emptyConfig: CollectorConfig = {
  eightxbet_page_url: "",
  eightxbet_base_url: "",
  eightxbet_inplay_page_url: "",
  jun88_base_url: "",
  jun88_bti_page_url: "",
  jun88_saba_page_url: "",
  jun88_cmd_page_url: "",
  jun88_m9bet_page_url: "",
  collector_proxy_enabled: false,
  collector_proxy_protocol: "http",
  collector_proxy_server: "",
  collector_proxy_bypass: "",
  bti_proxy_enabled: false,
  bti_proxy_protocol: "http",
  bti_proxy_server: "",
  bti_proxy_bypass: ""
};

export function CollectorConfigScreen() {
  const user = useSessionStore((state) => state.user);
  const query = useCollectorConfigQuery();
  const updateMutation = useUpdateCollectorConfigMutation();
  const [form, setForm] = useState<CollectorConfig>(emptyConfig);
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (!query.data) {
      return;
    }
    setForm(query.data);
  }, [query.data]);

  if (!user) {
    return (
      <div className="dashboard-page">
        <SectionHeader
          eyebrow="Super Admin"
          title="Đang tải quyền quản trị"
          description="Dashboard đang hydrate phiên đăng nhập trước khi mở cấu hình collector."
        />
      </div>
    );
  }

  if (user.role !== "super_admin") {
    return (
      <div className="dashboard-page">
        <SectionHeader
          eyebrow="Quản trị"
          title="Khu vực chỉ dành cho super admin"
          description="Tài khoản hiện tại không có quyền chỉnh cấu hình collector."
        />
      </div>
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    try {
      await updateMutation.mutateAsync(form);
      setMessage("Đã lưu cấu hình collector vào backend cache và DB.");
    } catch (currentError) {
      setError(
        currentError instanceof Error
          ? currentError.message
          : "Không lưu được cấu hình collector."
      );
    }
  }

  return (
    <div className="dashboard-page">
      <SectionHeader
        eyebrow="Super Admin"
        title="Cấu hình URL scrape collector"
        description="Các collector sẽ lấy cấu hình URL và proxy từ backend cache thay vì đọc trực tiếp từ env cục bộ."
      />

      <QueryShell<CollectorConfig> {...query}>
        {() => (
          <DataPanel
            title="Biến cấu hình collector"
            description="Lưu xong ở đây, worker collector sẽ dùng backend làm nguồn cấu hình tập trung. Nếu collector đang chạy lâu, hãy restart collector để nhận URL/proxy mới ngay."
          >
            <form className="grid gap-5" onSubmit={handleSubmit}>
              <section className="grid gap-4">
                <div>
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">
                    URL nguồn
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                    Giữ toàn bộ URL scrape ở một nơi để dễ cập nhật khi làm việc trên
                    điện thoại hoặc màn hình nhỏ.
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <ConfigField
                    label="EIGHTXBET_PAGE_URL"
                    value={form.eightxbet_page_url}
                    onChange={(value) =>
                      setForm((current) => ({ ...current, eightxbet_page_url: value }))
                    }
                  />
                  <ConfigField
                    label="EIGHTXBET_BASE_URL"
                    value={form.eightxbet_base_url}
                    onChange={(value) =>
                      setForm((current) => ({ ...current, eightxbet_base_url: value }))
                    }
                  />
                  <ConfigField
                    label="EIGHTXBET_INPLAY_PAGE_URL"
                    value={form.eightxbet_inplay_page_url}
                    onChange={(value) =>
                      setForm((current) => ({
                        ...current,
                        eightxbet_inplay_page_url: value
                      }))
                    }
                  />
                  <ConfigField
                    label="JUN88_BASE_URL"
                    value={form.jun88_base_url}
                    onChange={(value) =>
                      setForm((current) => ({ ...current, jun88_base_url: value }))
                    }
                  />
                  <ConfigField
                    label="JUN88_BTI_PAGE_URL"
                    value={form.jun88_bti_page_url}
                    onChange={(value) =>
                      setForm((current) => ({ ...current, jun88_bti_page_url: value }))
                    }
                  />
                  <ConfigField
                    label="JUN88_SABA_PAGE_URL"
                    value={form.jun88_saba_page_url}
                    onChange={(value) =>
                      setForm((current) => ({ ...current, jun88_saba_page_url: value }))
                    }
                  />
                  <ConfigField
                    label="JUN88_CMD_PAGE_URL"
                    value={form.jun88_cmd_page_url}
                    onChange={(value) =>
                      setForm((current) => ({ ...current, jun88_cmd_page_url: value }))
                    }
                  />
                  <ConfigField
                    label="JUN88_M9BET_PAGE_URL"
                    value={form.jun88_m9bet_page_url}
                    onChange={(value) =>
                      setForm((current) => ({ ...current, jun88_m9bet_page_url: value }))
                    }
                  />
                </div>
              </section>

              <section className="grid gap-4">
                <div>
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">
                    Proxy collector mặc định
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                    Áp dụng cho toàn bộ collector mặc định, trừ những collector có
                    override riêng.
                  </p>
                </div>

                <ProxyToggleField
                  checked={form.collector_proxy_enabled}
                  description="Bật hoặc tắt proxy tĩnh mặc định cho luồng collector."
                  label="Bật proxy tĩnh mặc định"
                  onChange={(checked) =>
                    setForm((current) => ({ ...current, collector_proxy_enabled: checked }))
                  }
                />
                <div className="grid gap-4 md:grid-cols-3">
                  <ConfigField
                    label="COLLECTOR_PROXY_PROTOCOL"
                    value={form.collector_proxy_protocol}
                    onChange={(value) =>
                      setForm((current) => ({ ...current, collector_proxy_protocol: value }))
                    }
                  />
                  <ConfigField
                    label="COLLECTOR_PROXY_SERVER"
                    value={form.collector_proxy_server}
                    onChange={(value) =>
                      setForm((current) => ({ ...current, collector_proxy_server: value }))
                    }
                  />
                  <ConfigField
                    label="COLLECTOR_PROXY_BYPASS"
                    value={form.collector_proxy_bypass}
                    onChange={(value) =>
                      setForm((current) => ({ ...current, collector_proxy_bypass: value }))
                    }
                  />
                </div>
              </section>

              <section className="grid gap-4">
                <div>
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">
                    Proxy riêng cho BTI
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                    Dùng khi BTI bị geo-block và cần ép collector BTI đi một proxy tĩnh
                    riêng.
                  </p>
                </div>

                <ProxyToggleField
                  checked={form.bti_proxy_enabled}
                  description="Bật hoặc tắt proxy riêng chỉ dành cho collector BTI."
                  label="Bật proxy riêng cho BTI"
                  onChange={(checked) =>
                    setForm((current) => ({ ...current, bti_proxy_enabled: checked }))
                  }
                />
                <div className="grid gap-4 md:grid-cols-3">
                  <ConfigField
                    label="BTI_PROXY_PROTOCOL"
                    value={form.bti_proxy_protocol}
                    onChange={(value) =>
                      setForm((current) => ({ ...current, bti_proxy_protocol: value }))
                    }
                  />
                  <ConfigField
                    label="BTI_PROXY_SERVER"
                    value={form.bti_proxy_server}
                    onChange={(value) =>
                      setForm((current) => ({ ...current, bti_proxy_server: value }))
                    }
                  />
                  <ConfigField
                    label="BTI_PROXY_BYPASS"
                    value={form.bti_proxy_bypass}
                    onChange={(value) =>
                      setForm((current) => ({ ...current, bti_proxy_bypass: value }))
                    }
                  />
                </div>
              </section>

              {message ? <p className="text-sm text-[var(--accent)]">{message}</p> : null}
              {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}

              <div className="flex flex-col gap-3 sm:flex-row">
                <Button
                  className="w-full sm:w-auto"
                  disabled={updateMutation.isPending}
                  type="submit"
                >
                  Lưu cấu hình
                </Button>
                <Button
                  className="w-full sm:w-auto"
                  disabled={updateMutation.isPending}
                  onClick={() => {
                    setForm(query.data ?? emptyConfig);
                    setError("");
                    setMessage("");
                  }}
                  type="button"
                  variant="secondary"
                >
                  Khôi phục dữ liệu đang tải
                </Button>
              </div>
            </form>
          </DataPanel>
        )}
      </QueryShell>
    </div>
  );
}

function ConfigField({
  label,
  value,
  onChange
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <Label htmlFor={label}>{label}</Label>
      <Input
        id={label}
        onChange={(event) => onChange(event.target.value)}
        placeholder={`Nhập ${label}`}
        value={value}
      />
    </div>
  );
}

function ProxyToggleField({
  checked,
  label,
  description,
  onChange
}: {
  checked: boolean;
  label: string;
  description: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="rounded-[22px] border border-[color:var(--line)] bg-[var(--surface-soft)] px-4 py-4">
      <label className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-[var(--ink)]">{label}</p>
          <p className="text-sm text-[var(--muted)]">{description}</p>
        </div>
        <input
          checked={checked}
          className="mt-1 size-5 shrink-0 accent-[var(--accent)]"
          onChange={(event) => onChange(event.target.checked)}
          type="checkbox"
        />
      </label>
    </div>
  );
}
