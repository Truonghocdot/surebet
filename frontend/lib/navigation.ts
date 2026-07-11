import type { Route } from "next";
import {
  Activity,
  BellRing,
  ArrowLeftRight,
  Network,
  type LucideIcon
} from "lucide-react";
import type { SessionUser } from "@/features/auth/store/session-store";

export type NavItem = {
  label: string;
  href: Route;
  description?: string;
  icon: LucideIcon;
};

export function navigationItems(user: Pick<SessionUser, "role">): NavItem[] {
  const items: NavItem[] = [
    {
      label: "Tổng quan",
      href: "/dashboard",
      icon: Activity
    },
    {
      label: "Cơ hội",
      href: "/opportunities",
      icon: ArrowLeftRight
    },
    {
      label: "Trận khớp",
      href: "/matches",
      icon: Network
    }
  ];

  if (user.role === "super_admin") {
    items.push({
      label: "Telegram",
      href: "/admin",
      description: "Quản lý chat nhận thông báo",
      icon: BellRing
    });
  }

  return items;
}
