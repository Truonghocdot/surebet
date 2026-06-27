"use client";

import { Activity, ArrowLeftRight, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { LoginForm } from "@/features/auth/components/login-form";

const promises = [
  {
    icon: Activity,
    title: "Realtime monitoring",
    copy: "Theo doi current odds, surebet va trang thai tai khoan trong mot man hinh."
  },
  {
    icon: ShieldCheck,
    title: "Validation-first execution",
    copy: "Moi lenh dat cuoc deu di qua pipeline validation truoc khi den worker."
  },
  {
    icon: ArrowLeftRight,
    title: "CRM-style operations",
    copy: "Sidebar trai, dashboard module hoa va san sang cho role-based access."
  }
];

export default function LoginPage() {
  return (
    <main className="grid min-h-screen gap-7 bg-[var(--app-bg)] p-5 lg:grid-cols-[1.1fr_minmax(360px,460px)] lg:p-7">
      <section className="relative overflow-hidden rounded-[36px] bg-[linear-gradient(160deg,rgba(8,83,74,0.97),rgba(15,31,38,0.96)),linear-gradient(120deg,rgba(255,155,84,0.18),transparent)] p-8 text-white shadow-[var(--shadow)] lg:p-12">
        <div className="absolute bottom-[-6rem] right-[-2rem] size-[22rem] rounded-full bg-white/10 blur-3xl" />
        <p className="relative z-10 text-[0.78rem] font-semibold uppercase tracking-[0.22em] text-white/72">
          Surebet operations
        </p>
        <h1 className="relative z-10 mt-4 max-w-[10ch] font-display text-[clamp(3rem,6vw,5.2rem)] font-semibold leading-[0.92]">
          Dang nhap vao trung tam van hanh surebet.
        </h1>
        <p className="relative z-10 mt-5 max-w-3xl text-[15px] leading-8 text-white/80">
          Giao dien duoc to chuc theo kieu CRM de doi van hanh co the theo doi
          co hoi, xac nhan lenh, quan ly account va kiem soat rui ro trong cung
          mot workspace.
        </p>

        <div className="relative z-10 mt-12 space-y-5">
          {promises.map((item) => {
            const Icon = item.icon;

            return (
              <div className="flex items-start gap-4" key={item.title}>
                <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-[#9af0df]">
                  <Icon className="size-5" strokeWidth={1.8} />
                </div>
                <div>
                  <p className="font-semibold">{item.title}</p>
                  <p className="mt-1 text-sm leading-7 text-white/72">{item.copy}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <Card className="self-center border border-white/50 p-8 lg:p-10">
        <h2 className="font-display text-[2rem] font-semibold text-[var(--ink)]">
          Xin chao tro lai
        </h2>
        <p className="mt-2 text-[15px] leading-7 text-[var(--muted)]">
          Dung tai khoan van hanh de truy cap dashboard. Day la auth flow mock
          bang cookie, san sang thay bang API that sau nay.
        </p>
        <div className="mt-7">
          <LoginForm />
        </div>
      </Card>
    </main>
  );
}

