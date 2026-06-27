"use client";

import type { ReactNode } from "react";
import { Spinner } from "@/components/ui/spinner";

type QueryShellProps<T> = {
  isPending: boolean;
  isError: boolean;
  error?: unknown;
  data?: T;
  children: (data: T) => ReactNode;
};

export function QueryShell<T>({
  isPending,
  isError,
  error,
  data,
  children
}: QueryShellProps<T>) {
  if (isPending) {
    return (
      <div className="flex min-h-[220px] items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex min-h-[220px] items-center justify-center">
        <p className="max-w-md text-center text-sm text-[var(--danger)]">
          {error instanceof Error
            ? error.message
            : "Khong tai duoc du lieu giao dien. Thu tai lai sau."}
        </p>
      </div>
    );
  }

  return <>{children(data)}</>;
}

