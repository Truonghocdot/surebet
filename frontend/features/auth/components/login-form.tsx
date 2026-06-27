"use client";

import { useActionState } from "react";
import {
  loginAction,
  type LoginState
} from "@/features/auth/server/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: LoginState = {};

export function LoginForm() {
  const [state, formAction, isPending] = useActionState(loginAction, initialState);

  return (
    <form action={formAction} className="space-y-5">
      <div>
        <Label htmlFor="email">Email</Label>
        <Input
          error={state.fieldErrors?.email}
          id="email"
          name="email"
          placeholder="operator@surebet.io"
          required
        />
        {state.fieldErrors?.email ? (
          <p className="mt-2 text-sm text-[var(--danger)]">
            {state.fieldErrors.email}
          </p>
        ) : null}
      </div>

      <div>
        <Label htmlFor="password">Mat khau</Label>
        <Input
          error={state.fieldErrors?.password}
          id="password"
          name="password"
          placeholder="Nhap mat khau"
          required
          type="password"
        />
        {state.fieldErrors?.password ? (
          <p className="mt-2 text-sm text-[var(--danger)]">
            {state.fieldErrors.password}
          </p>
        ) : null}
      </div>

      {state.formError ? (
        <p className="text-sm text-[var(--danger)]">{state.formError}</p>
      ) : null}

      <Button className="w-full" disabled={isPending} type="submit">
        {isPending ? "Dang xu ly..." : "Dang nhap he thong"}
      </Button>
    </form>
  );
}

