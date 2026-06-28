import type { Route } from "next";
import {
  Activity,
  ArrowLeftRight,
  Building2,
  Flag,
  ShieldCheck,
  TriangleAlert,
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
    description: "Tổng quan thời gian thực",
    icon: Activity
  },
  {
    label: "Cơ hội",
    href: "/opportunities",
    description: "Surebet đang hoạt động",
    icon: ArrowLeftRight
  },
  {
    label: "Lệnh cược",
    href: "/orders",
    description: "Vòng đời đặt cược",
    icon: ShieldCheck
  },
  {
    label: "Tài khoản",
    href: "/accounts",
    description: "Tài khoản bookmaker",
    icon: Building2
  },
  {
    label: "Rủi ro",
    href: "/risk",
    description: "Kiểm soát cảnh báo",
    icon: TriangleAlert
  },
  {
    label: "Feature flags",
    href: "/feature-flags",
    description: "Công tắc runtime",
    icon: Flag
  }
];
