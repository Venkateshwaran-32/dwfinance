import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { loginAction, fastAccessAction } from "@/app/actions";
import { env, fastAccessEnabled } from "@/lib/env";

// Rendered per request so the shared-demo check below reads the runtime env, not the build-time one.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  // Shared demo copy (fake data only): never show a password form, sign straight back in.
  if (env.DEMO_OPEN_EMAIL) redirect("/demo");
  return <AuthForm mode="login" action={loginAction} fastAccess={fastAccessEnabled ? fastAccessAction : undefined} />;
}
