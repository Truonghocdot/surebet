import { create } from "zustand";

export type SessionUser = {
  id?: string;
  email: string;
  fullName: string;
  role: string;
};

type SessionState = {
  user: SessionUser | null;
  setUser: (user: SessionUser | null) => void;
  clearUser: () => void;
};

export const useSessionStore = create<SessionState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
  clearUser: () => set({ user: null })
}));
