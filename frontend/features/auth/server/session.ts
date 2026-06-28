"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { loginSchema } from "@/features/auth/schemas/login-schema";
import type { SessionUser } from "@/features/auth/store/session-store";
import { fetchBackendJSON } from "@/lib/server-api";

const AUTH_COOKIE = "surebet_session";
const AUTH_TOKEN_COOKIE = "surebet_access_token";

export type LoginState = {
  formError?: string;
  fieldErrors?: Partial<Record<"email" | "password", string>>;
};

type BackendLoginResponse = {
  data: {
    access_token: string;
    token_type: string;
    expires_at: string;
    user: {
      id: string;
      email: string;
      full_name: string;
      role: string;
      last_login_at?: string;
    };
  };
};

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
      formError: "Thông tin đăng nhập chưa hợp lệ.",
      fieldErrors: {
        email: flattened.email?.[0],
        password: flattened.password?.[0]
      }
    };
  }

  let response: BackendLoginResponse;
  try {
    response = await fetchBackendJSON<BackendLoginResponse>("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify(parsed.data)
    });
  } catch (error) {
    return {
      formError:
        error instanceof Error ? error.message : "Không đăng nhập được vào backend."
    };
  }

  const cookieStore = await cookies();
  cookieStore.set(AUTH_COOKIE, JSON.stringify(response.data.user), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 12
  });
  cookieStore.set(AUTH_TOKEN_COOKIE, response.data.access_token, {
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
  cookieStore.delete(AUTH_TOKEN_COOKIE);
  redirect("/login");
}

export async function getSessionUser() {
  const cookieStore = await cookies();
  const raw = cookieStore.get(AUTH_COOKIE)?.value;

  if (!raw) {
    return null;
  }

  try {
    const user = JSON.parse(raw) as {
      email: string;
      full_name: string;
    };

    return {
      email: user.email,
      fullName: user.full_name || "Nhân sự vận hành"
    };
  } catch {
    return null;
  }
}
