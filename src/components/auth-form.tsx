"use client";
import { useActionState } from "react";
import Link from "next/link";
import type { ActionState } from "@/app/actions";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

export function AuthForm({
  mode, action, fastAccess,
}: {
  mode: "login" | "signup";
  action: Action;
  /** Optional one-click login (local desktop builds only). Rendered as its own form below the main one. */
  fastAccess?: () => Promise<void>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const isSignup = mode === "signup";
  return (
    <main style={{ maxWidth: 380, margin: "0 auto", padding: "5rem 1.25rem" }}>
      <h1 style={{ fontSize: 26, marginBottom: 4 }}>{isSignup ? "Create your account" : "Welcome back"}</h1>
      <p style={{ color: "var(--text-dim)", marginTop: 0 }}>
        {isSignup ? "Two months of synthetic data is one upload away." : "Log in to your dashboard."}
      </p>
      <form action={formAction} className="card" style={{ padding: 20, display: "grid", gap: 12, marginTop: 16 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 13, color: "var(--text-dim)" }}>Email</span>
          <input className="input" name="email" type="email" autoComplete="email" required />
        </label>
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 13, color: "var(--text-dim)" }}>Password</span>
          <input className="input" name="password" type="password" autoComplete={isSignup ? "new-password" : "current-password"} minLength={8} required />
        </label>
        {state.error && <p role="alert" style={{ color: "var(--danger)", margin: 0, fontSize: 14 }}>{state.error}</p>}
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "..." : isSignup ? "Create account" : "Log in"}
        </button>
      </form>
      {fastAccess && (
        <form action={fastAccess} style={{ marginTop: 12, display: "grid", gap: 6 }}>
          <button className="btn ghost" type="submit" style={{ width: "100%" }}>⚡ Fast access</button>
          <span style={{ fontSize: 12, color: "var(--text-dim)", textAlign: "center" }}>
            Skip the password on this Mac — it&apos;s your machine, your data.
          </span>
        </form>
      )}
      <p style={{ color: "var(--text-dim)", marginTop: 16, fontSize: 14 }}>
        {isSignup ? <>Have an account? <Link href="/login">Log in</Link></> : <>New here? <Link href="/signup">Sign up</Link></>}
      </p>
    </main>
  );
}
