"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataPanel } from "@/components/dashboard/data-panel";
import { SectionHeader } from "@/components/dashboard/section-header";
import { QueryShell } from "@/features/dashboard/components/query-shell";
import {
  useBookmakerSettingsQuery,
  useUpdateBookmakerSettingMutation
} from "@/features/dashboard/queries/use-crm-queries";
import {
  updateBookmakerSettingSchema,
  type BookmakerSetting
} from "@/features/dashboard/schemas/crm-schemas";

type FormState = Record<
  string,
  {
    url: string;
    username: string;
    password: string;
  }
>;

export function SettingsScreen() {
  const settingsQuery = useBookmakerSettingsQuery();
  const updateMutation = useUpdateBookmakerSettingMutation();
  const [forms, setForms] = useState<FormState>({});
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    if (!settingsQuery.data) {
      return
    }

    const nextState: FormState = {};
    for (const item of settingsQuery.data) {
      nextState[item.bookmaker_code] = {
        url: item.url,
        username: item.username,
        password: item.password
      };
    }
    setForms(nextState);
  }, [settingsQuery.data]);

  const updateField = (
    bookmakerCode: string,
    field: "url" | "username" | "password",
    value: string
  ) => {
    setForms((current) => ({
      ...current,
      [bookmakerCode]: {
        ...current[bookmakerCode],
        [field]: value
      }
    }));
  };

  const handleSubmit = async (item: BookmakerSetting) => {
    const candidate = forms[item.bookmaker_code];
    const parsed = updateBookmakerSettingSchema.safeParse({
      bookmaker_code: item.bookmaker_code,
      url: candidate?.url ?? "",
      username: candidate?.username ?? "",
      password: candidate?.password ?? ""
    });

    if (!parsed.success) {
      setMessage(parsed.error.issues[0]?.message ?? "Dữ liệu cấu hình chưa hợp lệ.");
      return;
    }

    try {
      await updateMutation.mutateAsync(parsed.data);
      setMessage(`Đã lưu cấu hình cho ${item.bookmaker_name}.`);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Không lưu được cấu hình bookmaker."
      );
    }
  };

  return (
    <div className="dashboard-page">
      <SectionHeader
        eyebrow="Cấu hình"
        title="Cấu hình truy cập bookmaker"
        description="Thông tin này sẽ được backend quản lý tập trung để collector và các worker có thể dùng chung cùng một nguồn cấu hình."
      />

      {message ? (
        <Card className="border border-[color:var(--line)] px-5 py-4 text-sm text-[var(--ink)]">
          {message}
        </Card>
      ) : null}

      <DataPanel
        title="Thông tin truy cập 2 nhà cái"
        description="Chỉnh sửa URL, username và password đang được backend cấp cho collector và worker."
      >
        <QueryShell {...settingsQuery}>
          {(items) => (
            <div className="grid gap-4 lg:grid-cols-2">
              {items.map((item) => {
                const current = forms[item.bookmaker_code] ?? {
                  url: item.url,
                  username: item.username,
                  password: item.password
                };

                return (
                  <Card
                    className="border border-[color:var(--line)] p-6"
                    key={item.bookmaker_code}
                  >
                    <div className="mb-5">
                      <h3 className="font-display text-xl font-semibold">
                        {item.bookmaker_name}
                      </h3>
                      <p className="mt-1 text-sm text-[var(--muted)]">
                        Mã nhà cái: {item.bookmaker_code}
                      </p>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <Label htmlFor={`${item.bookmaker_code}-url`}>URL</Label>
                        <Input
                          id={`${item.bookmaker_code}-url`}
                          onChange={(event) =>
                            updateField(item.bookmaker_code, "url", event.target.value)
                          }
                          placeholder="https://bookmaker.example.com"
                          value={current.url}
                        />
                      </div>

                      <div>
                        <Label htmlFor={`${item.bookmaker_code}-username`}>
                          Tên đăng nhập
                        </Label>
                        <Input
                          id={`${item.bookmaker_code}-username`}
                          onChange={(event) =>
                            updateField(
                              item.bookmaker_code,
                              "username",
                              event.target.value
                            )
                          }
                          placeholder="Nhập username"
                          value={current.username}
                        />
                      </div>

                      <div>
                        <Label htmlFor={`${item.bookmaker_code}-password`}>
                          Mật khẩu
                        </Label>
                        <Input
                          id={`${item.bookmaker_code}-password`}
                          onChange={(event) =>
                            updateField(
                              item.bookmaker_code,
                              "password",
                              event.target.value
                            )
                          }
                          placeholder="Nhập mật khẩu"
                          type="password"
                          value={current.password}
                        />
                      </div>

                      <Button
                        className="w-full"
                        disabled={updateMutation.isPending}
                        onClick={() => handleSubmit(item)}
                        type="button"
                      >
                        {updateMutation.isPending
                          ? "Đang lưu..."
                          : `Lưu cấu hình ${item.bookmaker_name}`}
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </QueryShell>
      </DataPanel>
    </div>
  );
}
