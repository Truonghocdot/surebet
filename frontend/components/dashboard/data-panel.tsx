import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

type DataPanelProps = {
  title: string;
  description: string;
  children: ReactNode;
};

export function DataPanel({ title, description, children }: DataPanelProps) {
  return (
    <Card className="p-4 sm:p-5 md:p-7">
      <h2 className="font-display text-lg font-semibold text-[var(--ink)] sm:text-xl">
        {title}
      </h2>
      {description ? (
        <p className="mt-2 text-sm leading-6 text-[var(--muted)] md:leading-7">
          {description}
        </p>
      ) : null}
      <div className="mt-5 md:mt-6">{children}</div>
    </Card>
  );
}
