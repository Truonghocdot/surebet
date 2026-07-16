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
  jun88_cmd_page_url: "",
  collector_proxyxoay_token: ""
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
        description="Các collector sẽ lấy cấu hình URL và token proxy xoay từ backend cache thay vì đọc trực tiếp từ env cục bộ."
      />

      <QueryShell<CollectorConfig> {...query}>
        {() => (
          <DataPanel
            title="Biến cấu hình collector"
            description="Lưu xong ở đây, worker collector sẽ dùng backend làm nguồn cấu hình tập trung. Với proxy xoay, collector sẽ recycle browser mỗi 60 giây để lấy proxy mới từ cache/API."
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
                    label="JUN88_CMD_PAGE_URL"
                    value={form.jun88_cmd_page_url}
                    onChange={(value) =>
                      setForm((current) => ({ ...current, jun88_cmd_page_url: value }))
                    }
                  />
                </div>
              </section>

              <section className="grid gap-4">
                <div>
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">
                    Proxy xoay mặc định
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                    Áp dụng chung cho eightxbet và jun88-cmd. Collector sẽ gọi ProxyXoay tối đa mỗi 60 giây, ghi vào cache, rồi dùng cache đó ở lần recycle browser kế tiếp.
                  </p>
                </div>

                <ConfigField
                  label="COLLECTOR_PROXYXOAY_KEY"
                  value={form.collector_proxyxoay_token}
                  onChange={(value) =>
                    setForm((current) => ({ ...current, collector_proxyxoay_token: value }))
                  }
                />
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
