"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { DataPanel } from "@/components/dashboard/data-panel";
import { SectionHeader } from "@/components/dashboard/section-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { QueryShell } from "@/features/dashboard/components/query-shell";
import { useOpportunityBoardQuery } from "@/features/dashboard/queries/use-crm-queries";
import type {
  OpportunityBoard,
  OpportunityBoardFixture,
  OpportunityBoardSource
} from "@/features/dashboard/schemas/crm-schemas";

type MatchedSourceSummary = {
  id: string;
  bookmakerID: string;
  lobbyID: string;
  quoteCount: number;
  marketCount: number;
  latestCollectedAt: string;
};

type MatchedFixtureSummary = {
  id: string;
  matchName: string;
  leagueNames: string[];
  matchState: string;
  sourceCount: number;
  quoteCount: number;
  marketCount: number;
  latestCollectedAt: string;
  sources: MatchedSourceSummary[];
};

export function MatchedFixturesScreen() {
  const query = useOpportunityBoardQuery();
  useFreshnessClock();

  return (
    <div className="dashboard-page">
      <SectionHeader eyebrow="Trận khớp" title="Các trận đang xuất hiện ở nhiều sảnh" />

      <QueryShell<OpportunityBoard> {...query}>
        {(board) => <MatchedFixturesContent board={board} />}
      </QueryShell>
    </div>
  );
}

function MatchedFixturesContent({ board }: { board: OpportunityBoard }) {
  const items = board.items.map(summarizeFixture);
  const activeSources = new Set(
    items.flatMap((item) => item.sources.map((source) => source.id))
  ).size;
  const totalQuotes = items.reduce((total, item) => total + item.quoteCount, 0);
  const latestCollectedAt = items.reduce(
    (latest, item) => latestTimestamp(latest, item.latestCollectedAt),
    ""
  );

  return (
    <div className="mt-4 space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          delta={items.length > 0 ? "Hai sảnh cùng mở kèo" : "Đang chờ dữ liệu trùng"}
          title="Trận đang khớp"
          tone={items.length > 0 ? "positive" : "warning"}
          value={String(items.length)}
        />
        <StatCard
          delta="Tính trên các trận đã khớp"
          title="Sảnh có dữ liệu"
          tone={activeSources > 0 ? "positive" : "neutral"}
          value={String(activeSources)}
        />
        <StatCard
          delta="Các cửa cược tiêu chuẩn đang mở"
          title="Cửa cược hiện tại"
          tone={totalQuotes > 0 ? "neutral" : "warning"}
          value={String(totalQuotes)}
        />
        <StatCard
          delta="Thời điểm nhận dữ liệu mới nhất"
          title="Cập nhật gần nhất"
          tone={latestCollectedAt ? "positive" : "warning"}
          value={latestCollectedAt ? formatFreshness(latestCollectedAt) : "Chưa có"}
        />
      </div>

      <DataPanel description="" title="Danh sách trận khớp">
        {items.length > 0 ? (
          <>
            <div className="grid gap-3 md:hidden">
              {items.map((item) => (
                <MatchedFixtureCard item={item} key={item.id} />
              ))}
            </div>

            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[940px] border-separate border-spacing-y-2 text-left">
                <thead>
                  <tr className="text-xs uppercase tracking-[0.16em] text-slate-400">
                    <th className="pb-2 font-medium">Trận đấu</th>
                    <th className="pb-2 font-medium">Giải</th>
                    <th className="pb-2 font-medium">Trạng thái</th>
                    <th className="pb-2 font-medium">Sảnh khớp</th>
                    <th className="pb-2 font-medium">Dòng kèo</th>
                    <th className="pb-2 font-medium">Mới nhất</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <MatchedFixtureRow item={item} key={item.id} />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="border border-dashed border-[color:var(--line)] bg-[var(--surface-soft)] px-6 py-10 text-center">
            <p className="font-semibold text-[var(--ink)]">
              Chưa có trận nào khớp giữa các sảnh
            </p>
          </div>
        )}
      </DataPanel>
    </div>
  );
}

function useFreshnessClock() {
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => setTick((value) => value + 1), 1_000);
    return () => window.clearInterval(interval);
  }, []);
}

function MatchedFixtureCard({ item }: { item: MatchedFixtureSummary }) {
  return (
    <article className="rounded-lg border border-[color:var(--line)] bg-[var(--surface-soft)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="min-w-0 flex-1 font-semibold leading-6 text-[var(--ink)]">
          {item.matchName}
        </p>
        <Badge variant={stateBadgeVariant(item.matchState)}>
          {stateLabel(item.matchState)}
        </Badge>
      </div>

      <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
        {item.leagueNames.length > 0 ? item.leagueNames.join(", ") : "Chưa rõ giải"}
      </p>

      <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
        <MatchedFixtureField label="Sảnh" value={String(item.sourceCount)} />
        <MatchedFixtureField label="Dòng kèo" value={String(item.marketCount)} />
        <MatchedFixtureField label="Cửa cược" value={String(item.quoteCount)} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {item.sources.map((source) => (
          <SourceLabel key={source.id} source={source} />
        ))}
      </div>

      <p className="mt-3 text-xs text-[var(--muted)]">
        {formatFreshness(item.latestCollectedAt)}
      </p>
    </article>
  );
}

function MatchedFixtureRow({ item }: { item: MatchedFixtureSummary }) {
  return (
    <tr className="bg-[var(--surface-soft)] text-sm text-[var(--ink)]">
      <td className="rounded-l-lg border-y border-l border-[color:var(--line)] px-4 py-4">
        <p className="max-w-[300px] font-semibold">{item.matchName}</p>
      </td>
      <td className="border-y border-[color:var(--line)] px-4 py-4">
        <div className="max-w-[220px] truncate">
          {item.leagueNames.length > 0 ? item.leagueNames.join(", ") : "Chưa rõ"}
        </div>
      </td>
      <td className="border-y border-[color:var(--line)] px-4 py-4">
        <Badge variant={stateBadgeVariant(item.matchState)}>
          {stateLabel(item.matchState)}
        </Badge>
      </td>
      <td className="border-y border-[color:var(--line)] px-4 py-4">
        <div className="flex max-w-[320px] flex-wrap gap-2">
          {item.sources.map((source) => (
            <SourceLabel key={source.id} source={source} />
          ))}
        </div>
      </td>
      <td className="border-y border-[color:var(--line)] px-4 py-4">
        <div className="font-semibold">{item.marketCount}</div>
        <div className="mt-1 text-xs text-[var(--muted)]">
          {item.quoteCount} cửa cược
        </div>
      </td>
      <td className="rounded-r-lg border-y border-r border-[color:var(--line)] px-4 py-4 text-[var(--muted)]">
        {formatFreshness(item.latestCollectedAt)}
      </td>
    </tr>
  );
}

function SourceLabel({ source }: { source: MatchedSourceSummary }) {
  return (
    <span
      className="rounded border border-[color:var(--line)] bg-white/80 px-2 py-1 text-xs font-semibold text-[var(--ink)]"
      title={`${source.marketCount} dòng kèo, cập nhật ${formatFreshness(source.latestCollectedAt)}`}
    >
      {source.bookmakerID}/{source.lobbyID || "chung"} · {source.quoteCount}
    </span>
  );
}

function MatchedFixtureField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
        {label}
      </p>
      <p className="mt-1 leading-6 text-[var(--ink)]">{value}</p>
    </div>
  );
}

function summarizeFixture(fixture: OpportunityBoardFixture): MatchedFixtureSummary {
  const sources = fixture.sources.map(summarizeSource);
  const marketKeys = new Set<string>();
  for (const source of fixture.sources) {
    addMarketKeys(marketKeys, "handicap", source.handicap);
    addMarketKeys(marketKeys, "over_under", source.over_under);
  }

  return {
    id: fixture.id,
    matchName: fixture.match_name,
    leagueNames: fixture.league_names,
    matchState: fixture.match_state,
    sourceCount: sources.length,
    quoteCount: sources.reduce((total, source) => total + source.quoteCount, 0),
    marketCount: marketKeys.size,
    latestCollectedAt: fixture.latest_collected_at,
    sources
  };
}

function summarizeSource(source: OpportunityBoardSource): MatchedSourceSummary {
  const markets = [...source.handicap, ...source.over_under];
  const activeMarkets = markets.filter((market) =>
    market.outcomes.some(isActiveOutcome)
  );
  return {
    id: source.id,
    bookmakerID: source.bookmaker_id,
    lobbyID: source.lobby_id,
    quoteCount: markets.reduce(
      (total, market) =>
        total + market.outcomes.filter(isActiveOutcome).length,
      0
    ),
    marketCount: activeMarkets.length,
    latestCollectedAt: source.latest_collected_at
  };
}

function isActiveOutcome(
  outcome: OpportunityBoardSource["handicap"][number]["outcomes"][number]
) {
  return !outcome.is_stale && Number.isFinite(outcome.odds) && outcome.odds !== 0;
}

function addMarketKeys(
  keys: Set<string>,
  type: "handicap" | "over_under",
  markets: OpportunityBoardSource["handicap"]
) {
  for (const market of markets) {
    if (market.outcomes.some(isActiveOutcome)) {
      keys.add(`${type}\u0000${market.period}\u0000${market.line}`);
    }
  }
}

function stateLabel(value: string) {
  if (value === "live") return "Đang đá";
  if (value === "upcoming") return "Sắp đá";
  if (value === "finished") return "Đã xong";
  return "Chưa rõ";
}

function stateBadgeVariant(value: string) {
  if (value === "live") return "teal";
  if (value === "upcoming") return "orange";
  if (value === "finished") return "slate";
  return "red";
}

function formatFreshness(value: string) {
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 1_000)
  );
  if (seconds < 60) return `${seconds} giây trước`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)} phút trước`;
  return `${Math.floor(seconds / 3_600)} giờ trước`;
}

function latestTimestamp(current: string, next: string) {
  const currentTime = Date.parse(current);
  const nextTime = Date.parse(next);
  if (!Number.isFinite(nextTime)) return current;
  return !Number.isFinite(currentTime) || nextTime > currentTime ? next : current;
}
