import { create } from "zustand";

type AppShellState = {
  mobileOpened: boolean;
  openMobileNav: () => void;
  closeMobileNav: () => void;
  toggleMobileNav: () => void;
};

export const useAppShellStore = create<AppShellState>((set) => ({
  mobileOpened: false,
  openMobileNav: () => set({ mobileOpened: true }),
  closeMobileNav: () => set({ mobileOpened: false }),
  toggleMobileNav: () =>
    set((state) => ({ mobileOpened: !state.mobileOpened }))
}));

