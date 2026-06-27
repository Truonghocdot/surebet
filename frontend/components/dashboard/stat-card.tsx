import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type StatCardProps = {
  title: string;
  value: string;
  delta: string;
  tone: "positive" | "warning" | "neutral";
};

export function StatCard({ title, value, delta, tone }: StatCardProps) {
  return (
    <Card className="p-6">
      <p className="text-sm text-[var(--muted)]">{title}</p>
      <p className="mt-3 font-display text-4xl font-semibold text-[var(--ink)]">
        {value}
      </p>
      <p
        className={cn(
          "mt-3 text-sm font-semibold",
          tone === "positive" && "text-teal-700",
          tone === "warning" && "text-orange-700",
          tone === "neutral" && "text-slate-500"
        )}
      >
        {delta}
      </p>
    </Card>
  );
}

