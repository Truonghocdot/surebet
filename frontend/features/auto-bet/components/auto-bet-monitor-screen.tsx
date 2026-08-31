"use client";

import { useEffect, useState } from "react";
import { Loader2, Power } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/dashboard/section-header";
import {
  useAutoBetControlMutation,
  useAutoBetMonitorQuery
} from "@/features/auto-bet/queries/use-auto-bet-query";

export function AutoBetMonitorScreen() {
  const query = useAutoBetMonitorQuery();
  const mutation = useAutoBetControlMutation();
  const control = query.data?.control;
  const [enabled, setEnabled] = useState(false);
  const [totalStake, setTotalStake] = useState("100000");

  useEffect(() => {
    if (!control) {
      return;
    }
    setEnabled(control.enabled);
    setTotalStake(String(control.total_stake_vnd));
  }, [control]);

  const persist = (nextEnabled = enabled) => {
    const amount = Number(totalStake);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      return;
    }
    mutation.mutate({ enabled: nextEnabled, total_stake_vnd: amount });
  };

  return (
    <div className="dashboard-page">
      <SectionHeader
        eyebrow="Điều khiển"
        title="Auto-bet"
        description="Bật hoặc tắt lệnh tự động và đặt tổng tiền cho mỗi cơ hội."
      />

      <Card className="max-w-2xl p-5 md:p-7">
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-[var(--ink)]">Trạng thái auto-bet</p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {enabled ? "Đang bật, hệ thống được phép xử lý cơ hội mới." : "Đang tắt, không phát lệnh mới."}
              </p>
            </div>
            <Button
              aria-pressed={enabled}
              className="shrink-0 gap-2"
              disabled={query.isLoading || mutation.isPending}
              onClick={() => {
                const next = !enabled;
                setEnabled(next);
                persist(next);
              }}
              type="button"
              variant={enabled ? "primary" : "secondary"}
            >
              {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Power className="size-4" />}
              {enabled ? "Tắt auto-bet" : "Bật auto-bet"}
            </Button>
          </div>

          <label className="grid gap-2" htmlFor="auto-bet-total-stake">
            <span className="text-sm font-semibold text-[var(--ink)]">Tổng tiền mỗi lệnh (VND)</span>
            <Input
              id="auto-bet-total-stake"
              inputMode="numeric"
              min={1}
              onBlur={() => persist()}
              onChange={(event) => setTotalStake(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
              step={1000}
              type="number"
              value={totalStake}
            />
            <span className="text-xs text-[var(--muted)]">Jun88 quy đổi 1 đơn vị = 1.000 VND; 8xbet dùng trực tiếp VND.</span>
          </label>

          {query.isError || mutation.isError ? (
            <p className="text-sm text-red-700">Không cập nhật được trạng thái auto-bet. Kiểm tra kết nối backend.</p>
          ) : null}
          {control ? (
            <p className="text-xs text-[var(--muted)]">
              Cập nhật lần cuối: {new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "medium" }).format(new Date(control.updated_at))}
            </p>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
