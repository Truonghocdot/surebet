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
    label: "Dashboard",
    href: "/dashboard",
    description: "Tong quan realtime",
    icon: Activity
  },
  {
    label: "Opportunities",
    href: "/opportunities",
    description: "Surebet dang hoat dong",
    icon: ArrowLeftRight
  },
  {
    label: "Orders",
    href: "/orders",
    description: "Vong doi dat cuoc",
    icon: ShieldCheck
  },
  {
    label: "Accounts",
    href: "/accounts",
    description: "Tai khoan bookmaker",
    icon: Building2
  },
  {
    label: "Risk",
    href: "/risk",
    description: "Kiem soat canh bao",
    icon: TriangleAlert
  },
  {
    label: "Feature Flags",
    href: "/feature-flags",
    description: "Cong tac runtime",
    icon: Flag
  }
];
