"use client";

import { ArrowLeftRight, Calculator, ShieldAlert } from "lucide-react";
import { useState, type ReactNode } from "react";
import { DataPanel } from "@/components/dashboard/data-panel";
import { SectionHeader } from "@/components/dashboard/section-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSessionStore } from "@/features/auth/store/session-store";
import { cn } from "@/lib/utils";

type OddsFormat = "malay" | "decimal";
type StakeMode = "ratio" | "total" | "left" | "right";

const moneyPresets = [100_000, 200_000, 500_000, 1_000_000];

export function SurebetCalculatorScreen() {
  const user = useSessionStore((state) => state.user);
  const [oddsFormat, setOddsFormat] = useState<OddsFormat>("malay");
  const [leftOdds, setLeftOdds] = useState("");
  const [rightOdds, setRightOdds] = useState("");
  const [totalStake, setTotalStake] = useState("");
  const [leftStakeInput, setLeftStakeInput] = useState("");
  const [rightStakeInput, setRightStakeInput] = useState("");
  const [stakeMode, setStakeMode] = useState<StakeMode>("ratio");

  if (!user) {
    return (
      <div className="dashboard-page">
        <SectionHeader
          eyebrow="Super Admin"
          title="Đang tải máy tính surebet"
          description="Dashboard đang hydrate phiên đăng nhập trước khi mở công cụ tính odds."
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
          description="Tài khoản hiện tại không có quyền dùng máy tính chia vốn surebet."
        />
      </div>
    );
  }

  const leftRaw = parseNumberish(leftOdds);
  const rightRaw = parseNumberish(rightOdds);
  const totalStakeValue = parseNumberish(totalStake);
  const leftStakeRaw = parseNumberish(leftStakeInput);
  const rightStakeRaw = parseNumberish(rightStakeInput);

  const leftDecimal = toDecimalOdds(leftRaw, oddsFormat);
  const rightDecimal = toDecimalOdds(rightRaw, oddsFormat);
  const totalStakeAmount =
    totalStakeValue !== null && totalStakeValue > 0 ? totalStakeValue : null;
  const leftStakeAmount =
    leftStakeRaw !== null && leftStakeRaw > 0 ? leftStakeRaw : null;
  const rightStakeAmount =
    rightStakeRaw !== null && rightStakeRaw > 0 ? rightStakeRaw : null;

  const leftError =
    leftOdds.trim() === ""
      ? ""
      : leftRaw === null
        ? "Không đọc được odds."
        : leftDecimal === null
          ? oddsValidationMessage(oddsFormat)
          : "";
  const rightError =
    rightOdds.trim() === ""
      ? ""
      : rightRaw === null
        ? "Không đọc được odds."
        : rightDecimal === null
          ? oddsValidationMessage(oddsFormat)
          : "";
  const totalStakeError =
    totalStake.trim() !== "" && totalStakeAmount === null
      ? "Tổng tiền phải lớn hơn 0."
      : "";
  const leftStakeError =
    leftStakeInput.trim() !== "" && leftStakeAmount === null
      ? "Tiền cửa A phải lớn hơn 0."
      : "";
  const rightStakeError =
    rightStakeInput.trim() !== "" && rightStakeAmount === null
      ? "Tiền cửa B phải lớn hơn 0."
      : "";

  const calculation =
    leftDecimal !== null && rightDecimal !== null
      ? stakeMode === "left" && leftStakeAmount !== null
        ? buildSurebetCalculation(leftDecimal, rightDecimal, {
            kind: "left",
            amount: leftStakeAmount
          })
        : stakeMode === "right" && rightStakeAmount !== null
          ? buildSurebetCalculation(leftDecimal, rightDecimal, {
              kind: "right",
              amount: rightStakeAmount
            })
          : stakeMode === "total" && totalStakeAmount !== null
            ? buildSurebetCalculation(leftDecimal, rightDecimal, {
                kind: "total",
                amount: totalStakeAmount
              })
            : buildSurebetCalculation(leftDecimal, rightDecimal, null)
      : null;

  const displayedLeftStake =
    stakeMode === "left"
      ? leftStakeInput
      : calculation
        ? formatEditableMoney(calculation.leftStake)
        : leftStakeInput;
  const displayedRightStake =
    stakeMode === "right"
      ? rightStakeInput
      : calculation
        ? formatEditableMoney(calculation.rightStake)
        : rightStakeInput;

  return (
    <div className="dashboard-page">
      <SectionHeader
        eyebrow="Super Admin"
        title="Máy tính chia vốn surebet"
        description="Nhập odds hai cửa để ra tỷ lệ phân bổ vốn. Nếu điền thêm tổng tiền, màn hình sẽ tính luôn số tiền nên đặt cho mỗi bên và lợi nhuận khóa."
      />

      <DataPanel
        title="Công cụ tính nhanh"
        description="Hỗ trợ 2 cửa. Bạn có thể nhập odds theo Malay hoặc Decimal, rồi đổi format bất kỳ lúc nào."
      >
        <div className="grid gap-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-2xl border border-[color:var(--line)] bg-[var(--surface-soft)] p-1">
              <FormatToggle
                active={oddsFormat === "malay"}
                label="Malay"
                onClick={() => setOddsFormat("malay")}
              />
              <FormatToggle
                active={oddsFormat === "decimal"}
                label="Decimal"
                onClick={() => setOddsFormat("decimal")}
              />
            </div>
            <Button
              onClick={() => {
                setLeftOdds("0.95");
                setRightOdds("-0.92");
                setTotalStake("1000000");
                setLeftStakeInput("");
                setRightStakeInput("");
                setOddsFormat("malay");
                setStakeMode("total");
              }}
              size="sm"
              type="button"
              variant="secondary"
            >
              Điền ví dụ
            </Button>
            <Button
              onClick={() => {
                setLeftOdds("");
                setRightOdds("");
                setTotalStake("");
                setLeftStakeInput("");
                setRightStakeInput("");
                setStakeMode("ratio");
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              Xóa nhanh
            </Button>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="grid gap-4">
              <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-end">
                <OddsField
                  description={
                    oddsFormat === "malay"
                      ? "Ví dụ: 0.95 hoặc -0.92"
                      : "Ví dụ: 1.95 hoặc 2.08"
                  }
                  error={leftError}
                  label="Odds cửa A"
                  onChange={setLeftOdds}
                  value={leftOdds}
                />

                <div className="flex items-center justify-center pb-1 md:pb-3">
                  <Button
                    aria-label="Đổi vị trí hai odds"
                    className="size-11 rounded-full"
                    onClick={() => {
                      setLeftOdds(rightOdds);
                      setRightOdds(leftOdds);
                    }}
                    type="button"
                    variant="secondary"
                  >
                    <ArrowLeftRight className="size-4" />
                  </Button>
                </div>

                <OddsField
                  description={
                    oddsFormat === "malay"
                      ? "Ví dụ: -0.77 hoặc 0.47"
                      : "Ví dụ: 2.30 hoặc 1.47"
                  }
                  error={rightError}
                  label="Odds cửa B"
                  onChange={setRightOdds}
                  value={rightOdds}
                />
              </div>

              <div className="rounded-[22px] border border-[color:var(--line)] bg-[var(--surface-soft)] p-4">
                <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                  <OddsField
                    description="Nếu để trống, hệ thống chỉ trả ra tỷ lệ phần trăm chia vốn."
                    error={totalStakeError}
                    label="Tổng tiền muốn vào"
                    onChange={(value) => {
                      setTotalStake(value);
                      setLeftStakeInput("");
                      setRightStakeInput("");
                      setStakeMode(value.trim() ? "total" : "ratio");
                    }}
                    value={totalStake}
                  />
                  <div className="flex flex-wrap gap-2">
                    {moneyPresets.map((preset) => (
                      <Button
                        className="min-w-24"
                        key={preset}
                        onClick={() => setTotalStake(String(preset))}
                        size="sm"
                        type="button"
                        variant="secondary"
                      >
                        {compactMoney(preset)}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-[22px] border border-[color:var(--line)] bg-white/72 p-4">
                <div className="mb-3">
                  <p className="text-sm font-semibold text-[var(--ink)]">
                    Hoặc nhập trực tiếp tiền cho một cửa
                  </p>
                  <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                    Gõ tiền ở cửa A hoặc cửa B, hệ thống sẽ tự tính cửa còn lại theo đúng
                    payout tương ứng.
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <OddsField
                    description="Ví dụ: 500000"
                    error={leftStakeError}
                    label="Tiền cửa A"
                    onChange={(value) => {
                      setLeftStakeInput(value);
                      setRightStakeInput("");
                      setTotalStake("");
                      setStakeMode(value.trim() ? "left" : "ratio");
                    }}
                    value={displayedLeftStake}
                  />
                  <OddsField
                    description="Ví dụ: 500000"
                    error={rightStakeError}
                    label="Tiền cửa B"
                    onChange={(value) => {
                      setRightStakeInput(value);
                      setLeftStakeInput("");
                      setTotalStake("");
                      setStakeMode(value.trim() ? "right" : "ratio");
                    }}
                    value={displayedRightStake}
                  />
                </div>
              </div>
            </div>

            <div className="grid gap-4">
              <InlineCard>
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-2xl bg-[var(--accent)]/12 p-2 text-[var(--accent)]">
                    <Calculator className="size-4" />
                  </div>
                  <div className="grid gap-2 text-sm leading-6 text-[var(--muted)]">
                    <p>
                      {oddsFormat === "malay"
                        ? "Malay hợp lệ nằm trong khoảng -1 đến 1, không nhận 0."
                        : "Decimal hợp lệ phải lớn hơn 1."}
                    </p>
                    <p>
                      Tỷ lệ chia vốn được tính theo công thức xác suất ngầm định:
                      <span className="mx-1 font-mono font-semibold text-[var(--ink)]">
                        1 / odds
                      </span>
                      cho mỗi cửa.
                    </p>
                  </div>
                </div>
              </InlineCard>

              <InlineCard>
                <p className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
                  Quy đổi đang dùng
                </p>
                <div className="mt-3 grid gap-2 text-sm text-[var(--muted)]">
                  <ConversionRow
                    label="Decimal cửa A"
                    value={leftDecimal !== null ? formatOdds(leftDecimal) : "-"}
                  />
                    <ConversionRow
                      label="Decimal cửa B"
                      value={rightDecimal !== null ? formatOdds(rightDecimal) : "-"}
                    />
                    <ConversionRow
                      label="Chế độ tiền"
                      value={
                        stakeMode === "left"
                          ? "Nhập cửa A"
                          : stakeMode === "right"
                            ? "Nhập cửa B"
                            : stakeMode === "total"
                              ? "Nhập tổng vốn"
                              : "Tỷ lệ"
                      }
                    />
                </div>
              </InlineCard>
            </div>
          </div>

          {calculation ? (
            <>
              <div className="grid gap-4 lg:grid-cols-4">
                <MetricCard
                  label="Tổng xác suất"
                  tone={calculation.isSurebet ? "positive" : "warning"}
                  value={formatPercent(calculation.combinedProbability * 100)}
                />
                <MetricCard
                  label="Biên lợi nhuận"
                  tone={calculation.isSurebet ? "positive" : "danger"}
                  value={formatPercent(calculation.profitPercentage)}
                />
                <MetricCard
                  label="Tỷ lệ cửa A"
                  tone="neutral"
                  value={formatPercent(calculation.leftShare * 100)}
                />
                <MetricCard
                  label="Tỷ lệ cửa B"
                  tone="neutral"
                  value={formatPercent(calculation.rightShare * 100)}
                />
              </div>

              <div
                className={cn(
                  "rounded-[22px] border px-4 py-4 text-sm leading-6",
                  calculation.isSurebet
                    ? "border-emerald-600/20 bg-emerald-500/10 text-emerald-950"
                    : "border-amber-500/25 bg-amber-500/10 text-amber-950"
                )}
              >
                {calculation.isSurebet ? (
                  <p>
                    Bộ odds này tạo được surebet. Chỉ cần chia vốn theo tỷ lệ bên dưới là
                    payout hai cửa sẽ gần bằng nhau.
                  </p>
                ) : (
                  <div className="flex items-start gap-3">
                    <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                    <p>
                      Bộ odds này chưa tạo surebet vì tổng xác suất đang lớn hơn hoặc bằng
                      100%. Tỷ lệ chia vốn vẫn được tính để bạn tham khảo hedge, nhưng lợi
                      nhuận khóa hiện đang âm.
                    </p>
                  </div>
                )}
              </div>

              <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                <InlineCard>
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
                    Tỷ lệ phân bổ vốn
                  </p>

                  <div className="mt-4 grid gap-4">
                    <ShareMeter
                      label="Cửa A"
                      share={calculation.leftShare}
                      value={formatPercent(calculation.leftShare * 100)}
                    />
                    <ShareMeter
                      label="Cửa B"
                      share={calculation.rightShare}
                      value={formatPercent(calculation.rightShare * 100)}
                    />
                  </div>

                  <div className="mt-5 grid gap-3 rounded-[18px] border border-[color:var(--line)] bg-white/75 p-4 text-sm text-[var(--muted)]">
                    <ConversionRow
                      label="Chuẩn hóa trên 1 đơn vị vốn"
                      value={`${formatUnit(calculation.leftShare)} / ${formatUnit(calculation.rightShare)}`}
                    />
                    <ConversionRow
                      label="Chuẩn hóa trên 100 đơn vị"
                      value={`${formatUnit(calculation.leftShare * 100)} / ${formatUnit(calculation.rightShare * 100)}`}
                    />
                  </div>
                </InlineCard>

                <InlineCard>
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
                    Tiền nên đặt
                  </p>

                  <div className="mt-4 grid gap-3">
                    <AmountRow
                      label="Cửa A"
                      value={
                        calculation.sourceKind !== "ratio"
                          ? formatMoney(calculation.leftStake)
                          : `= ${formatPercent(calculation.leftShare * 100)} tổng vốn`
                      }
                    />
                    <AmountRow
                      label="Cửa B"
                      value={
                        calculation.sourceKind !== "ratio"
                          ? formatMoney(calculation.rightStake)
                          : `= ${formatPercent(calculation.rightShare * 100)} tổng vốn`
                      }
                    />
                    <AmountRow
                      label="Tổng tiền vào"
                      value={formatMoney(calculation.totalStake)}
                    />
                    <AmountRow
                      label="Payout nếu A thắng"
                      value={
                        calculation.sourceKind !== "ratio"
                          ? formatMoney(calculation.leftPayout)
                          : formatUnit(calculation.leftDecimal * calculation.leftShare)
                      }
                    />
                    <AmountRow
                      label="Payout nếu B thắng"
                      value={
                        calculation.sourceKind !== "ratio"
                          ? formatMoney(calculation.rightPayout)
                          : formatUnit(calculation.rightDecimal * calculation.rightShare)
                      }
                    />
                    <AmountRow
                      emphasized
                      label="Lợi nhuận khóa"
                      value={
                        calculation.sourceKind !== "ratio"
                          ? formatSignedMoney(calculation.lockedProfit)
                          : formatPercent(calculation.profitPercentage)
                      }
                    />
                  </div>
                </InlineCard>
              </div>
            </>
          ) : (
            <div className="rounded-[22px] border border-dashed border-[color:var(--line)] bg-white/55 px-5 py-8 text-sm leading-6 text-[var(--muted)]">
              Điền đủ 2 odds hợp lệ để bắt đầu tính. Nếu bạn nhập thêm tổng tiền,
              màn hình sẽ chia luôn số tiền cho mỗi bên.
            </div>
          )}
        </div>
      </DataPanel>
    </div>
  );
}

function FormatToggle({
  active,
  label,
  onClick
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "rounded-[18px] px-4 py-2 text-sm font-semibold transition",
        active
          ? "bg-[var(--accent)] text-white shadow-[0_10px_24px_rgba(11,138,119,0.24)]"
          : "text-[var(--muted)] hover:bg-white hover:text-[var(--ink)]"
      )}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function OddsField({
  label,
  value,
  onChange,
  description,
  error
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  description: string;
  error?: string;
}) {
  return (
    <div className="grid gap-2">
      <Label className="text-sm font-semibold text-[var(--ink)]">{label}</Label>
      <Input
        error={error}
        inputMode="decimal"
        onChange={(event) => onChange(event.target.value)}
        placeholder={description}
        value={value}
      />
      <p className={cn("text-xs leading-5", error ? "text-[var(--danger)]" : "text-[var(--muted)]")}>
        {error || description}
      </p>
    </div>
  );
}

function MetricCard({
  label,
  value,
  tone
}: {
  label: string;
  value: string;
  tone: "positive" | "warning" | "danger" | "neutral";
}) {
  return (
    <div
      className={cn(
        "rounded-[22px] border p-4",
        tone === "positive" && "border-emerald-600/15 bg-emerald-500/10",
        tone === "warning" && "border-amber-500/20 bg-amber-500/10",
        tone === "danger" && "border-rose-500/20 bg-rose-500/10",
        tone === "neutral" && "border-[color:var(--line)] bg-white/70"
      )}
    >
      <p className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
        {label}
      </p>
      <p className="mt-3 font-mono text-2xl font-bold tabular-nums text-[var(--ink)]">
        {value}
      </p>
    </div>
  );
}

function InlineCard({
  className,
  children
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-[24px] border border-[color:var(--line)] bg-white/72 p-4 shadow-sm md:p-5",
        className
      )}
    >
      {children}
    </div>
  );
}

function ConversionRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[var(--muted)]">{label}</span>
      <span className="font-mono text-sm font-semibold tabular-nums text-[var(--ink)]">
        {value}
      </span>
    </div>
  );
}

function AmountRow({
  label,
  value,
  emphasized = false
}: {
  label: string;
  value: string;
  emphasized?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 rounded-[18px] border px-3 py-3",
        emphasized
          ? "border-[var(--accent)]/18 bg-[var(--accent)]/7"
          : "border-[color:var(--line)] bg-white/72"
      )}
    >
      <span className="text-sm text-[var(--muted)]">{label}</span>
      <span className="font-mono text-sm font-bold tabular-nums text-[var(--ink)]">
        {value}
      </span>
    </div>
  );
}

function ShareMeter({
  label,
  share,
  value
}: {
  label: string;
  share: number;
  value: string;
}) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-[var(--ink)]">{label}</span>
        <span className="font-mono text-sm font-bold tabular-nums text-[var(--ink)]">
          {value}
        </span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-[linear-gradient(90deg,var(--accent),#5fd0b2)]"
          style={{ width: `${Math.max(share * 100, 4)}%` }}
        />
      </div>
    </div>
  );
}

function buildSurebetCalculation(
  leftDecimal: number,
  rightDecimal: number,
  source:
    | {
        kind: "total" | "left" | "right";
        amount: number;
      }
    | null
) {
  const leftImplied = 1 / leftDecimal;
  const rightImplied = 1 / rightDecimal;
  const combinedProbability = leftImplied + rightImplied;
  const leftShare = leftImplied / combinedProbability;
  const rightShare = rightImplied / combinedProbability;
  const sourceKind = source?.kind ?? "ratio";
  const defaultBaseStake = 100;

  let leftStake = defaultBaseStake * leftShare;
  let rightStake = defaultBaseStake * rightShare;

  if (source?.kind === "total") {
    leftStake = source.amount * leftShare;
    rightStake = source.amount * rightShare;
  }
  if (source?.kind === "left") {
    leftStake = source.amount;
    rightStake = (leftStake * leftDecimal) / rightDecimal;
  }
  if (source?.kind === "right") {
    rightStake = source.amount;
    leftStake = (rightStake * rightDecimal) / leftDecimal;
  }

  const totalStake = leftStake + rightStake;
  const leftPayout = leftStake * leftDecimal;
  const rightPayout = rightStake * rightDecimal;
  const lockedProfit = Math.min(leftPayout, rightPayout) - totalStake;
  const expectedReturn = (1 / combinedProbability) - 1;

  return {
    sourceKind,
    leftDecimal,
    rightDecimal,
    combinedProbability,
    leftShare,
    rightShare,
    totalStake,
    leftStake,
    rightStake,
    leftPayout,
    rightPayout,
    lockedProfit,
    profitPercentage: expectedReturn * 100,
    isSurebet: combinedProbability < 1
  };
}

function parseNumberish(value: string) {
  const normalized = value.trim().replace(/,/g, ".");
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

function toDecimalOdds(value: number | null, format: OddsFormat) {
  if (value === null) {
    return null;
  }

  if (format === "decimal") {
    return value > 1 ? value : null;
  }

  if (value === 0 || value < -1 || value > 1) {
    return null;
  }

  if (value > 0) {
    return 1 + value;
  }

  return 1 + 1 / Math.abs(value);
}

function oddsValidationMessage(format: OddsFormat) {
  if (format === "decimal") {
    return "Decimal phải lớn hơn 1.";
  }
  return "Malay phải nằm trong khoảng -1 đến 1 và khác 0.";
}

function formatOdds(value: number) {
  return trimTrailingZeros(value.toFixed(4));
}

function formatPercent(value: number) {
  return `${trimTrailingZeros(value.toFixed(2))}%`;
}

function formatUnit(value: number) {
  return trimTrailingZeros(value.toFixed(4));
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("vi-VN", {
    maximumFractionDigits: 2
  }).format(value);
}

function formatEditableMoney(value: number) {
  return trimTrailingZeros(value.toFixed(value >= 1000 ? 0 : 2));
}

function compactMoney(value: number) {
  if (value >= 1_000_000) {
    return `${trimTrailingZeros((value / 1_000_000).toFixed(1))}M`;
  }
  return `${trimTrailingZeros((value / 1_000).toFixed(0))}k`;
}

function formatSignedMoney(value: number) {
  const prefix = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${prefix}${formatMoney(Math.abs(value))}`;
}

function trimTrailingZeros(value: string) {
  return value.replace(/\.?0+$/, "");
}
