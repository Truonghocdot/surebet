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
  jun88_base_url: "",
  jun88_bti_page_url: "",
  jun88_saba_page_url: "",
  jun88_cmd_page_url: "",
  jun88_m9bet_page_url: ""
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
        description="Các collector sẽ lấy cấu hình này từ backend thay vì đọc trực tiếp từ env cục bộ."
      />

      <QueryShell<CollectorConfig> {...query}>
        {() => (
          <DataPanel
            title="Biến cấu hình collector"
            description="Lưu xong ở đây, worker collector sẽ dùng backend làm nguồn cấu hình tập trung. Nếu collector đang chạy lâu, hãy restart collector để nhận cấu hình mới ngay."
          >
            <form className="grid gap-4" onSubmit={handleSubmit}>
              <ConfigField
                label="EIGHTXBET_PAGE_URL"
                value={form.eightxbet_page_url}
                onChange={(value) => setForm((current) => ({ ...current, eightxbet_page_url: value }))}
              />
              <ConfigField
                label="EIGHTXBET_BASE_URL"
                value={form.eightxbet_base_url}
                onChange={(value) => setForm((current) => ({ ...current, eightxbet_base_url: value }))}
              />
              <ConfigField
                label="JUN88_BASE_URL"
                value={form.jun88_base_url}
                onChange={(value) => setForm((current) => ({ ...current, jun88_base_url: value }))}
              />
              <ConfigField
                label="JUN88_BTI_PAGE_URL"
                value={form.jun88_bti_page_url}
                onChange={(value) => setForm((current) => ({ ...current, jun88_bti_page_url: value }))}
              />
              <ConfigField
                label="JUN88_SABA_PAGE_URL"
                value={form.jun88_saba_page_url}
                onChange={(value) => setForm((current) => ({ ...current, jun88_saba_page_url: value }))}
              />
              <ConfigField
                label="JUN88_CMD_PAGE_URL"
                value={form.jun88_cmd_page_url}
                onChange={(value) => setForm((current) => ({ ...current, jun88_cmd_page_url: value }))}
              />
              <ConfigField
                label="JUN88_M9BET_PAGE_URL"
                value={form.jun88_m9bet_page_url}
                onChange={(value) => setForm((current) => ({ ...current, jun88_m9bet_page_url: value }))}
              />

              {message ? <p className="text-sm text-[var(--accent)]">{message}</p> : null}
              {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}

              <div className="flex flex-wrap gap-3">
                <Button disabled={updateMutation.isPending} type="submit">
                  Lưu cấu hình
                </Button>
                <Button
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
