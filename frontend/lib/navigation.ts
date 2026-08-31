import type { Route } from "next";
import {
  Activity,
  Bot,
  Cable,
  Waypoints,
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
      label: "Đối khớp",
      href: "/matching",
      description: "Theo dõi số trận trùng giữa hai nguồn",
      icon: Waypoints
    },
    {
      label: "Auto-bet",
      href: "/auto-bet",
      description: "Theo dõi action và exposure Jun88",
      icon: Bot
    }
  ];

  if (user.role === "super_admin") {
    items.push({
      label: "Collector",
      href: "/collector-config",
      description: "Cấu hình URL scrape tập trung",
      icon: Cable
    });
  }

  return items;
}
