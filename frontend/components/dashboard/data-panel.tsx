import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

type DataPanelProps = {
  title: string;
  description: string;
  children: ReactNode;
};

export function DataPanel({ title, description, children }: DataPanelProps) {
  return (
    <Card className="p-6 md:p-7">
      <h2 className="font-display text-xl font-semibold text-[var(--ink)]">
        {title}
      </h2>
      <p className="mt-2 text-sm leading-7 text-[var(--muted)]">{description}</p>
      <div className="mt-6">{children}</div>
    </Card>
  );
}

