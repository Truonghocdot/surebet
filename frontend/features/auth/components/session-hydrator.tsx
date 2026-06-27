"use client";

import { useEffect } from "react";
import {
  type SessionUser,
  useSessionStore
} from "@/features/auth/store/session-store";

export function SessionHydrator({ user }: { user: SessionUser }) {
  const setUser = useSessionStore((state) => state.setUser);

  useEffect(() => {
    setUser(user);
  }, [setUser, user]);

  return null;
}

