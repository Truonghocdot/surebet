"use client";

import { Activity, ArrowLeftRight, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { LoginForm } from "@/features/auth/components/login-form";

const promises = [
  {
    icon: Activity,
    title: "Giám sát thời gian thực",
    copy: "Theo dõi tỷ lệ cược mới nhất, cơ hội chênh lệch và trạng thái kết nối trong một màn hình."
  },
  {
    icon: ShieldCheck,
    title: "Kiểm tra dữ liệu trước khi dùng",
    copy: "Dữ liệu được rà soát trước khi hiển thị để tránh nhầm kèo hoặc tỷ lệ đã ngừng."
  },
  {
    icon: ArrowLeftRight,
    title: "Tập trung vào phần cần theo dõi",
    copy: "Bố cục rõ ràng, chỉ giữ dữ liệu quét được và các cơ hội so sánh đang còn hiệu lực."
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
