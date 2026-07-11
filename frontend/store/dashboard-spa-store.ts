import { create } from "zustand";
import type { DashboardHref } from "@/lib/dashboard-spa";

type DashboardSpaState = {
  activeHref: DashboardHref | null;
  setActiveHref: (href: DashboardHref) => void;
};

export const useDashboardSpaStore = create<DashboardSpaState>((set) => ({
  activeHref: null,
  setActiveHref: (href) => set({ activeHref: href })
}));
