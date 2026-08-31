"use client";

import {
  CircleAlert,
  CircleCheck,
  Clock3,
  RefreshCw,
  Waypoints
} from "lucide-react";
import { SectionHeader } from "@/components/dashboard/section-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { QueryShell } from "@/features/dashboard/components/query-shell";
import { useDashboardSnapshotQuery } from "@/features/dashboard/queries/use-crm-queries";
import type {
  DashboardSnapshot,
  FixtureMatchingMonitor
} from "@/features/dashboard/schemas/crm-schemas";
import { cn } from "@/lib/utils";
import { useRealtimeNotificationStore } from "@/store/realtime-notification-store";

const statePresentation = {
  matching: {
    label: "Đang đối khớp",
    description: "Hai nguồn đang có trận được nhận diện là cùng một sự kiện.",
    badge: "teal" as const,
    icon: CircleCheck,
    iconClassName: "bg-teal-50 text-teal-700"
  },
  waiting: {
    label: "Chưa có trận trùng",
    description: "Hai nguồn đều có dữ liệu hiện hành nhưng chưa tìm thấy trận trùng.",
    badge: "orange" as const,
    icon: Waypoints,
    iconClassName: "bg-orange-50 text-orange-700"
  },
  source_missing: {
    label: "Thiếu dữ liệu nguồn",
    description: "Ít nhất một nguồn chưa có odds hiện hành để thực hiện đối khớp.",
    badge: "red" as const,
    icon: CircleAlert,
    iconClassName: "bg-red-50 text-red-700"
  }
};

export function FixtureMatchingScreen() {
  const query = useDashboardSnapshotQuery();
  const realtimeStatus = useRealtimeNotificationStore((state) => state.status);

  return (
    <div className="dashboard-page">
      <SectionHeader
        eyebrow="Giám sát hệ thống"
        title="Trạng thái ghép trận"
        description="Theo dõi số trận đang được nhận diện trùng nhau giữa Jun88 CMD và 8xbet."
      />

      <QueryShell<DashboardSnapshot> {...query}>
        {(snapshot) => (
          <MatchingMonitor
            isRefreshing={query.isFetching}
            monitor={snapshot.matching}
            onRefresh={() => void query.refetch()}
            realtimeStatus={realtimeStatus}
          />
        )}
      </QueryShell>
    </div>
  );
}

function MatchingMonitor({
  isRefreshing,
  monitor,
  onRefresh,
  realtimeStatus
}: {
  isRefreshing: boolean;
  monitor: FixtureMatchingMonitor;
  onRefresh: () => void;
  realtimeStatus: "connecting" | "live" | "reconnecting";
}) {
  const presentation = statePresentation[monitor.state];
  const StatusIcon = presentation.icon;
  const realtime = realtimePresentation(realtimeStatus);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-4 border-b border-[color:var(--line)] px-5 py-5 sm:flex-row sm:items-center sm:justify-between md:px-7">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={presentation.badge}>{presentation.label}</Badge>
          <Badge variant={realtime.variant}>{realtime.label}</Badge>
        </div>
        <div className="flex items-center justify-between gap-3 sm:justify-end">
          <span className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
            <Clock3 className="size-3.5" />
            {formatClock(monitor.checked_at)}
          </span>
          <Button
            aria-label="Làm mới trạng thái ghép trận"
            className="size-10 rounded-2xl p-0"
            disabled={isRefreshing}
            onClick={onRefresh}
            title="Làm mới"
            type="button"
            variant="secondary"
          >
            <RefreshCw className={cn("size-4", isRefreshing && "animate-spin")} />
          </Button>
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(260px,0.9fr)_minmax(360px,1.1fr)]">
        <section className="flex min-h-[260px] flex-col justify-center px-5 py-8 md:px-8 md:py-10">
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "flex size-11 items-center justify-center rounded-2xl",
                presentation.iconClassName
              )}
            >
              <StatusIcon className="size-5" />
            </span>
            <p className="text-sm font-semibold text-[var(--muted)]">
              Trận đang khớp
            </p>
          </div>
          <p className="mt-5 font-display text-6xl font-semibold leading-none text-[var(--ink)]">
            {monitor.matched_fixtures}
          </p>
          <p className="mt-5 max-w-md text-sm leading-6 text-[var(--muted)]">
            {presentation.description}
          </p>
        </section>

        <section className="border-t border-[color:var(--line)] px-5 py-6 md:px-8 md:py-8 lg:border-l lg:border-t-0">
          <h2 className="font-display text-lg font-semibold text-[var(--ink)]">
            Dữ liệu theo nguồn
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Fixture có odds hiện hành trong cửa sổ dữ liệu backend.
          </p>

          <div className="mt-5 divide-y divide-[color:var(--line)] border-y border-[color:var(--line)]">
            {monitor.sources.map((source) => (
              <div
                className="grid grid-cols-[1fr_auto] items-center gap-4 py-5"
                key={source.id}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-xl",
                      source.has_data
                        ? "bg-teal-50 text-teal-700"
                        : "bg-red-50 text-red-700"
                    )}
                  >
                    {source.has_data ? (
                      <CircleCheck className="size-4" />
                    ) : (
                      <CircleAlert className="size-4" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold text-[var(--ink)]">{source.label}</p>
                    <p className="mt-1 truncate text-xs text-[var(--muted)]">
                      {source.latest_observed_at
                        ? `Ghi nhận ${formatFreshness(source.latest_observed_at)}`
                        : "Chưa ghi nhận odds hiện hành"}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-display text-2xl font-semibold text-[var(--ink)]">
                    {source.active_fixtures}
                  </p>
                  <p className="mt-1 text-xs text-[var(--muted)]">trận</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </Card>
  );
}

function realtimePresentation(status: "connecting" | "live" | "reconnecting") {
  switch (status) {
    case "live":
      return { label: "Realtime ổn định", variant: "teal" as const };
    case "reconnecting":
      return { label: "Realtime đang nối lại", variant: "orange" as const };
    default:
      return { label: "Realtime đang kết nối", variant: "slate" as const };
  }
}

function formatClock(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Chưa cập nhật";
  }
  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh"
  }).format(date);
}

function formatFreshness(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return "không xác định";
  }
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1_000));
  if (seconds < 60) {
    return `${seconds} giây trước`;
  }
  return `${Math.floor(seconds / 60)} phút trước`;
}
