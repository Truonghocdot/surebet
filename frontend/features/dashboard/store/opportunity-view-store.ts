import { create } from "zustand";

export type OpportunityViewMode = "all" | "high-profit" | "fresh";

type OpportunityViewState = {
  mode: OpportunityViewMode;
  setMode: (mode: OpportunityViewMode) => void;
};

export const useOpportunityViewStore = create<OpportunityViewState>((set) => ({
  mode: "all",
  setMode: (mode) => set({ mode })
}));

