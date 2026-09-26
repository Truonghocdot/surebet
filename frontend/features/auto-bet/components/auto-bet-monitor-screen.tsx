"use client";

import { useEffect, useState } from "react";
import { Loader2, Power, Save, WalletCards } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/dashboard/section-header";
import { selectLatestAccountBalance } from "@/lib/auto-bet-monitor";
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
  const [amountEdited, setAmountEdited] = useState(false);
  const amount = Number(totalStake);
  const amountValid = Number.isSafeInteger(amount) && amount > 0;
  const amountDirty = Boolean(amountEdited && control && amountValid && amount !== control.total_stake_vnd);
  const balances = query.data?.balances;
  const balanceItems = balances?.state === "available" ? balances.items : [];
  const jun88Balance = selectLatestAccountBalance(balanceItems, "jun88-cmd");
  const eightXBetBalance = selectLatestAccountBalance(balanceItems, "8xbet");

  useEffect(() => {
    if (!control || amountDirty) {
      return;
    }
    setEnabled(control.enabled);
    setTotalStake(String(control.total_stake_vnd));
  }, [amountDirty, control]);

  const persist = (nextEnabled = enabled) => {
    if (!amountValid) {
      return;
    }
    mutation.mutate(
      { enabled: nextEnabled, total_stake_vnd: amount },
      { onSuccess: () => setAmountEdited(false) }
    );
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
                if (!amountValid) {
                  return;
                }
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
              onChange={(event) => {
                setAmountEdited(true);
                setTotalStake(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  persist();
                }
              }}
              step={1000}
              type="number"
              value={totalStake}
            />
            <Button
              className="w-full sm:w-auto sm:justify-self-end"
              disabled={query.isLoading || mutation.isPending || !amountValid || !amountDirty}
              onClick={() => persist()}
              type="button"
              variant="secondary"
            >
              {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Lưu
            </Button>
            <span className="text-xs text-[var(--muted)]">Jun88 quy đổi 1 đơn vị = 1.000 VND; 8xbet dùng trực tiếp VND.</span>
          </label>

          <div className="grid gap-3 border-t border-[color:var(--line)] pt-5">
            <div className="flex items-center gap-2">
              <WalletCards className="size-4 text-[var(--accent)]" />
              <div>
                <p className="text-sm font-semibold text-[var(--ink)]">Số dư bookmaker</p>
                <p className="text-xs text-[var(--muted)]">
                  {balances?.state === "available"
                    ? `Cập nhật tự động, stale sau ${balances.stale_after_seconds ?? 45} giây.`
                    : balances?.error ?? "Chưa nhận được dữ liệu số dư."}
                </p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <BalancePanel label="Jun88 CMD" balance={jun88Balance} />
              <BalancePanel label="8xbet" balance={eightXBetBalance} />
            </div>
          </div>

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

function BalancePanel({
  label,
  balance
}: {
  label: string;
  balance: ReturnType<typeof selectLatestAccountBalance>;
}) {
  if (!balance) {
    return (
      <div className="grid min-h-24 content-center gap-1 rounded-xl border border-dashed border-[color:var(--line)] px-4 py-3">
        <p className="text-sm font-semibold text-[var(--ink)]">{label}</p>
        <p className="text-xs text-[var(--muted)]">Chưa có số dư từ collector.</p>
      </div>
    );
  }

  const amount = balance.display_text ?? `${balance.currency} ${balance.amount.toLocaleString("vi-VN")}`;
  const amountVnd = balance.amount_vnd !== undefined
    ? `${balance.amount_vnd.toLocaleString("vi-VN")} VND`
    : null;

  return (
    <div className="grid min-h-24 content-center gap-1 rounded-xl border border-[color:var(--line)] bg-[var(--surface-soft)] px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-[var(--ink)]">{label}</p>
        <span className={balance.stale ? "text-xs font-semibold text-amber-700" : "text-xs font-semibold text-emerald-700"}>
          {balance.stale ? "Cũ" : "Mới"}
        </span>
      </div>
      <p className="text-lg font-bold text-[var(--ink)]">{amount}</p>
      {amountVnd ? <p className="text-xs text-[var(--muted)]">≈ {amountVnd}</p> : null}
    </div>
  );
}
