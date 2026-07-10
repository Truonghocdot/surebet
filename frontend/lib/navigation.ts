import type { Route } from "next";
import {
  Activity,
  ArrowLeftRight,
  type LucideIcon
} from "lucide-react";

export type NavItem = {
  label: string;
  href: Route;
  description: string;
  icon: LucideIcon;
};

export const navigationItems: NavItem[] = [
  {
    label: "Tổng quan",
    href: "/dashboard",
    description: "Feed scrape và cơ hội surebet",
    icon: Activity
  },
  {
    label: "Cơ hội",
    href: "/opportunities",
    description: "Danh sách cơ hội phát hiện được",
    icon: ArrowLeftRight
  }
];
