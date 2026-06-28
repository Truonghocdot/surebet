"use client";

import { Activity, ArrowLeftRight, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { LoginForm } from "@/features/auth/components/login-form";

const promises = [
  {
    icon: Activity,
    title: "Giám sát thời gian thực",
    copy: "Theo dõi current odds, surebet và trạng thái tài khoản trong một màn hình."
  },
  {
    icon: ShieldCheck,
    title: "Thực thi ưu tiên validation",
    copy: "Mọi lệnh đặt cược đều đi qua pipeline validation trước khi đến worker."
  },
  {
    icon: ArrowLeftRight,
    title: "Vận hành kiểu CRM",
    copy: "Sidebar trái, dashboard module hóa và sẵn sàng cho phân quyền theo vai trò."
  }
];

export default function LoginPage() {
  return (
    <main className="flex justify-center min-h-screen gap-7 bg-[var(--app-bg)] p-5 lg:p-7">
      <Card className=" col-span-3 self-center border border-white/50 p-8 lg:p-10 max-w-[568px] w-full">
        <h2 className="font-display text-[2rem] font-semibold text-[var(--ink)]">
          Xin chào trở lại
        </h2>
        <p className="mt-2 text-[15px] leading-7 text-[var(--muted)]">
          Đăng nhập để truy cập hệ thống.
        </p>
        <div className="mt-7 flex ">
          <LoginForm />
        </div>
      </Card>
    </main>
  );
}
