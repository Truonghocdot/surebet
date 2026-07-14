"use client";

import { useEffect, useRef, useState } from "react";
import { DataPanel } from "@/components/dashboard/data-panel";
import { SectionHeader } from "@/components/dashboard/section-header";
import { QueryShell } from "@/features/dashboard/components/query-shell";
import {
  useOpportunityBoardQuery,
  useRealtimeWebSocket
} from "@/features/dashboard/queries/use-crm-queries";
import type {
  OpportunityBoard,
  OpportunityBoardFixture,
  OpportunityBoardMarket,
  OpportunityBoardOutcome
} from "@/features/dashboard/schemas/crm-schemas";

export function OpportunitiesScreen() {
  const query = useOpportunityBoardQuery();
  const realtimeStatus = useRealtimeWebSocket();

  return (
    <div className="dashboard-page">
      <SectionHeader
        eyebrow="So sánh kèo"
        title="Bảng trận khớp giữa các nhà cái"
      />

      <DataPanel description="" title="Danh sách so sánh">
        <RealtimeIndicator status={realtimeStatus} />

        <QueryShell<OpportunityBoard> {...query}>
          {(board) =>
            board.items.length > 0 ? (
              <OpportunityBoardTable board={board} />
            ) : (
              <EmptyBoard />
            )
          }
        </QueryShell>
      </DataPanel>
    </div>
  );
}

function RealtimeIndicator({ status }: { status: "connecting" | "live" | "reconnecting" }) {
  return (
    <div className="mb-5 inline-flex w-fit flex-wrap items-center gap-2 rounded-full border border-[color:var(--line)] bg-[var(--surface-soft)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
      <span
        className={`size-2 rounded-full ${
          status === "live"
            ? "bg-emerald-500"
            : status === "connecting"
              ? "bg-amber-500"
              : "bg-slate-400"
        }`}
      />
      {status === "live"
        ? "Đang nhận dữ liệu"
        : status === "connecting"
          ? "Đang kết nối"
          : "Đang kết nối lại"}
    </div>
  );
}

function OpportunityBoardTable({ board }: { board: OpportunityBoard }) {
  return (
    <div className="overflow-x-auto pb-2">
      <table className="w-full min-w-[1080px] border-separate border-spacing-0 text-left text-sm">
        <colgroup>
          <col className="w-[300px]" />
          <col className="w-[180px]" />
          <col className="w-[min(360px,35vw)]" />
          <col className="w-[min(360px,35vw)]" />
        </colgroup>
        <thead className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
          <tr>
            <th className="sticky left-0 z-20 border-b border-[color:var(--line)] bg-[var(--surface-soft)] px-4 py-3 font-semibold">
              Trận
            </th>
            <th className="sticky left-[300px] z-20 border-b border-[color:var(--line)] bg-[var(--surface-soft)] px-4 py-3 font-semibold">
              Sảnh
            </th>
            <th className="border-b border-[color:var(--line)] px-4 py-3 font-semibold">Kèo chấp</th>
            <th className="border-b border-[color:var(--line)] px-4 py-3 font-semibold">Tài xỉu</th>
          </tr>
        </thead>
        {board.items.map((fixture) => (
          <FixtureRows fixture={fixture} key={fixture.id} />
        ))}
      </table>
    </div>
  );
}

function FixtureRows({ fixture }: { fixture: OpportunityBoardFixture }) {
  return (
    <tbody className="align-top">
      {fixture.sources.map((source, index) => (
        <tr className="group" key={source.id}>
          {index === 0 ? <FixtureCell fixture={fixture} rowSpan={fixture.sources.length} /> : null}
          <td className="sticky left-[300px] z-10 border-b border-[color:var(--line)] bg-[var(--surface-soft)] px-4 py-4 group-hover:bg-white">
            <p className="break-words font-semibold text-[var(--ink)]">{source.bookmaker_id}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">{source.lobby_id || "default"}</p>
            <p className="mt-2 text-xs text-[var(--muted)]">
              {formatFreshness(source.latest_collected_at)}
            </p>
          </td>
          <td className="border-b border-[color:var(--line)] px-4 py-3 align-top">
            <MarketCell markets={source.handicap} />
          </td>
          <td className="border-b border-[color:var(--line)] px-4 py-3 align-top">
            <MarketCell markets={source.over_under} />
          </td>
        </tr>
      ))}
    </tbody>
  );
}

function FixtureCell({ fixture, rowSpan }: { fixture: OpportunityBoardFixture; rowSpan: number }) {
  return (
    <td
      className="sticky left-0 z-10 border-b border-[color:var(--line)] bg-[var(--surface-soft)] px-4 py-4 group-hover:bg-white"
      rowSpan={rowSpan}
    >
      <div className="max-w-[268px]">
        <div className="flex flex-wrap items-start gap-2">
          <p className="font-semibold leading-5 text-[var(--ink)]">{fixture.match_name}</p>
          {fixture.has_surebet ? (
            <span className="rounded border border-emerald-600/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-emerald-800">
              Khớp
            </span>
          ) : null}
        </div>
        <p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--muted)]">
          {fixture.league_names.length > 0 ? fixture.league_names.join(", ") : "Chưa rõ giải"}
        </p>
        <div className="mt-3 flex items-center justify-between gap-2 text-xs text-[var(--muted)]">
          <span>{matchStateLabel(fixture.match_state)}</span>
          <span>{formatFreshness(fixture.latest_collected_at)}</span>
        </div>
      </div>
    </td>
  );
}

function MarketCell({ markets }: { markets: OpportunityBoardMarket[] }) {
  if (markets.length === 0) {
    return <span className="text-xs text-[var(--muted)]">-</span>;
  }

  return (
    <div className="grid gap-2">
      {markets.map((market) => (
        <section
          className="overflow-hidden rounded-lg border border-[color:var(--line)] bg-white/60"
          key={market.id}
        >
          <div className="flex items-center justify-between gap-3 border-b border-[color:var(--line)] bg-slate-50 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
            <span>{market.period}</span>
            <span>{market.line || "Không line"}</span>
          </div>
          <div className="grid gap-px bg-[color:var(--line)]">
            {market.outcomes.map((outcome) => (
              <OutcomeOdds outcome={outcome} key={outcome.outcome_id} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function OutcomeOdds({ outcome }: { outcome: OpportunityBoardOutcome }) {
  const signature = `${outcome.odds}\u0000${outcome.collected_at}\u0000${outcome.is_surebet_leg}`;
  const previousSignature = useRef<string | null>(null);
  const [isFlashing, setIsFlashing] = useState(false);

  useEffect(() => {
    const changed = previousSignature.current !== null && previousSignature.current !== signature;
    previousSignature.current = signature;

    if (!changed || !outcome.is_surebet_leg) {
      setIsFlashing(false);
      return;
    }

    setIsFlashing(true);
    const timeout = window.setTimeout(() => setIsFlashing(false), 900);
    return () => window.clearTimeout(timeout);
  }, [outcome.is_surebet_leg, signature]);

  return (
    <div
      className={`flex min-h-9 items-center justify-between gap-3 px-2.5 py-1.5 transition-colors ${
        outcome.is_surebet_leg
          ? "border-emerald-600/40 bg-emerald-500/15 text-emerald-950"
          : "bg-white/80 text-[var(--ink)]"
      } ${isFlashing ? "opportunity-odds-pulse" : ""}`}
    >
      <span className="min-w-0 break-words text-xs font-medium leading-4">{outcome.outcome_name}</span>
      <span className="shrink-0 font-mono text-sm font-bold tabular-nums">{outcome.odds}</span>
    </div>
  );
}

function EmptyBoard() {
  return (
    <div className="border border-dashed border-[color:var(--line)] bg-[var(--surface-soft)] px-6 py-10 text-center">
      <p className="font-semibold text-[var(--ink)]">Chưa có trận khớp giữa các nhà cái</p>
      <p className="mx-auto mt-2 max-w-xl text-sm text-[var(--muted)]">
        Bảng sẽ hiển thị khi một trận có dữ liệu từ ít nhất hai sảnh khác nhau.
      </p>
    </div>
  );
}

function formatFreshness(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) {
    return `${seconds} giây trước`;
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)} phút trước`;
  }
  return `${Math.floor(seconds / 3600)} giờ trước`;
}

function matchStateLabel(value: string) {
  if (value === "live") {
    return "Đang đá";
  }
  if (value === "upcoming") {
    return "Sắp đá";
  }
  if (value === "finished") {
    return "Đã xong";
  }
  return "Chưa rõ";
}
