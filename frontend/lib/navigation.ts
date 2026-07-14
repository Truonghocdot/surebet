import type { Route } from "next";
import {
  Activity,
  BellRing,
  Cable,
  Calculator,
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
    items.push({
      label: "Collector",
      href: "/collector-config",
      description: "Cấu hình URL scrape tập trung",
      icon: Cable
    });
    items.push({
      label: "Máy tính",
      href: "/calculator",
      description: "Nhập odds để chia vốn hai cửa",
      icon: Calculator
    });
  }

  return items;
}
