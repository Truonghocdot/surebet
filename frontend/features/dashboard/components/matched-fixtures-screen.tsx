"use client";

import { Badge } from "@/components/ui/badge";
import { DataPanel } from "@/components/dashboard/data-panel";
import { SectionHeader } from "@/components/dashboard/section-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { QueryShell } from "@/features/dashboard/components/query-shell";
import { useMatchedFixturesQuery } from "@/features/dashboard/queries/use-crm-queries";
import type {
  MatchedFixture,
  MatchedFixturesSnapshot
} from "@/features/dashboard/schemas/crm-schemas";

export function MatchedFixturesScreen() {
  const query = useMatchedFixturesQuery();

  return (
    <div className="dashboard-page">
      <SectionHeader
        eyebrow="Trận khớp"
        title="Các trận đang xuất hiện ở nhiều sảnh"
        description="Danh sách này gom các dòng kèo hiện tại theo khóa trận đấu đã chuẩn hóa, giúp mình nhìn nhanh trận nào đang được nhiều sảnh cùng trả dữ liệu."
      />

      <QueryShell<MatchedFixturesSnapshot> {...query}>
        {(snapshot) => (
          <div className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                delta={
                  snapshot.summary.matched_fixtures > 0
                    ? "Có từ hai sảnh trở lên"
                    : "Đang chờ dữ liệu trùng"
                }
                title="Trận đang khớp"
                tone={snapshot.summary.matched_fixtures > 0 ? "positive" : "warning"}
                value={String(snapshot.summary.matched_fixtures)}
              />
              <StatCard
                delta="Tính trên các trận đã khớp"
                title="Sảnh có dữ liệu"
                tone={snapshot.summary.active_sources > 0 ? "positive" : "neutral"}
                value={String(snapshot.summary.active_sources)}
              />
              <StatCard
                delta="Các cửa cược đang còn hiệu lực"
                title="Dòng kèo hiện tại"
                tone={snapshot.summary.total_quotes > 0 ? "neutral" : "warning"}
                value={String(snapshot.summary.total_quotes)}
              />
              <StatCard
                delta="Thời điểm nhận dữ liệu mới nhất"
                title="Cập nhật gần nhất"
                tone={snapshot.summary.latest_collected_at ? "positive" : "warning"}
                value={
                  snapshot.summary.latest_collected_at
                    ? formatFreshness(snapshot.summary.latest_collected_at)
                    : "Chưa có"
                }
              />
            </div>

            <DataPanel
              description="Mỗi dòng là một trận đã match được giữa ít nhất hai sảnh. Số dòng kèo giúp mình biết trận đó đang có bao nhiêu nhóm kèo có thể dùng để so sánh tiếp."
              title="Danh sách trận khớp"
            >
              {snapshot.items.length > 0 ? (
                <>
                  <div className="grid gap-3 md:hidden">
                    {snapshot.items.map((item) => (
                      <MatchedFixtureCard item={item} key={item.id} />
                    ))}
                  </div>

                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full min-w-[980px] border-separate border-spacing-y-3 text-left">
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
                        {snapshot.items.map((item) => (
                          <MatchedFixtureRow item={item} key={item.id} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="rounded-[28px] border border-dashed border-[color:var(--line)] bg-[var(--surface-soft)] px-6 py-10 text-center">
                  <p className="font-semibold text-[var(--ink)]">
                    Chưa có trận nào khớp giữa các sảnh
                  </p>
                  <p className="mx-auto mt-2 max-w-xl text-sm text-[var(--muted)]">
                    Khi collector lấy được cùng một trận từ ít nhất hai sảnh, trận đó sẽ
                    xuất hiện tại đây để mình kiểm tra trước khi so sánh kèo.
                  </p>
                </div>
              )}
            </DataPanel>
          </div>
        )}
      </QueryShell>
    </div>
  );
}

function MatchedFixtureCard({ item }: { item: MatchedFixture }) {
  return (
    <article className="rounded-[22px] border border-[color:var(--line)] bg-[var(--surface-soft)] p-4 shadow-[inset_0_0_0_1px_var(--line)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-6 text-[var(--ink)]">{item.match_name}</p>
          <p className="mt-1 break-all text-xs text-[var(--muted)]">
            Khóa: {item.fixture_marker}
          </p>
        </div>
        <Badge variant={stateBadgeVariant(item.match_state)}>
          {stateLabel(item.match_state)}
        </Badge>
      </div>

      <div className="mt-4 grid gap-3">
        <MatchedFixtureField
          label="Giải"
          value={item.league_names.length > 0 ? item.league_names.join(", ") : "Chưa rõ"}
        />

        <div className="grid grid-cols-2 gap-3 text-sm">
          <MatchedFixtureField label="Sảnh" value={String(item.source_count)} />
          <MatchedFixtureField label="Dòng kèo" value={String(item.market_count)} />
          <MatchedFixtureField label="Cửa cược" value={String(item.quote_count)} />
          <MatchedFixtureField label="Mới nhất" value={formatFreshness(item.latest_collected_at)} />
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
            Sảnh khớp
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {item.sources.map((source) => (
              <span
                className="rounded-full border border-[color:var(--line)] bg-white/70 px-3 py-1 text-[11px] font-semibold text-[var(--ink)]"
                key={source.source_id}
                title={`${source.home_team} - ${source.away_team}`}
              >
                {source.bookmaker_id}/{source.lobby_id || "chung"} · {source.quote_count}
              </span>
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}

function MatchedFixtureRow({ item }: { item: MatchedFixture }) {
  return (
    <tr className="bg-[var(--surface-soft)] text-sm text-[var(--ink)] shadow-[inset_0_0_0_1px_var(--line)]">
      <td className="rounded-l-[20px] px-4 py-4">
        <div className="max-w-[320px]">
          <p className="font-semibold">{item.match_name}</p>
          <p className="mt-1 truncate text-xs text-[var(--muted)]">
            Khóa: {item.fixture_marker}
          </p>
        </div>
      </td>
      <td className="px-4 py-4">
        <div className="max-w-[240px] truncate">
          {item.league_names.length > 0 ? item.league_names.join(", ") : "Chưa rõ"}
        </div>
      </td>
      <td className="px-4 py-4">
        <Badge variant={stateBadgeVariant(item.match_state)}>
          {stateLabel(item.match_state)}
        </Badge>
      </td>
      <td className="px-4 py-4">
        <div className="flex max-w-[360px] flex-wrap gap-2">
          {item.sources.map((source) => (
            <span
              className="rounded-full border border-[color:var(--line)] bg-white/70 px-3 py-1 text-xs font-semibold text-[var(--ink)]"
              key={source.source_id}
              title={`${source.home_team} - ${source.away_team}`}
            >
              {source.bookmaker_id}/{source.lobby_id || "chung"} · {source.quote_count}
            </span>
          ))}
        </div>
      </td>
      <td className="px-4 py-4">
        <div className="font-semibold">{item.market_count}</div>
        <div className="mt-1 text-xs text-[var(--muted)]">
          {item.quote_count} cửa cược
        </div>
      </td>
      <td className="rounded-r-[20px] px-4 py-4 text-slate-500">
        {formatFreshness(item.latest_collected_at)}
      </td>
    </tr>
  );
}

function MatchedFixtureField({
  label,
  value
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
        {label}
      </p>
      <p className="mt-1 break-words leading-6 text-[var(--ink)]">{value}</p>
    </div>
  );
}

function stateLabel(value: string) {
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

function stateBadgeVariant(value: string) {
  if (value === "live") {
    return "teal";
  }
  if (value === "upcoming") {
    return "orange";
  }
  if (value === "finished") {
    return "slate";
  }
  return "red";
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
