"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { loginSchema } from "@/features/auth/schemas/login-schema";
import type { SessionUser } from "@/features/auth/store/session-store";

const AUTH_COOKIE = "surebet_session";

export type LoginState = {
  formError?: string;
  fieldErrors?: Partial<Record<"email" | "password", string>>;
};

function deriveUser(email: string): SessionUser {
  const [namePart] = email.split("@");
  const fullName = namePart
    .split(".")
    .filter(Boolean)
    .map((item) => item.charAt(0).toUpperCase() + item.slice(1))
    .join(" ");

  return {
    email,
    fullName: fullName || "Operator"
  };
}

export async function loginAction(
  _prevState: LoginState,
  formData: FormData
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password")
  });

  if (!parsed.success) {
    const flattened = parsed.error.flatten().fieldErrors;

    return {
      formError: "Thong tin dang nhap chua hop le.",
      fieldErrors: {
        email: flattened.email?.[0],
        password: flattened.password?.[0]
      }
    };
  }

  const cookieStore = await cookies();
  cookieStore.set(AUTH_COOKIE, parsed.data.email, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 12
  });

  redirect("/dashboard");
}

export async function logoutAction() {
  const cookieStore = await cookies();
  cookieStore.delete(AUTH_COOKIE);
  redirect("/login");
}

export async function getSessionUser() {
  const cookieStore = await cookies();
  const email = cookieStore.get(AUTH_COOKIE)?.value;

  if (!email) {
    return null;
  }

  return deriveUser(email);
}

