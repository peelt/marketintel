import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAllowedEmail, getAllowedEmail } from "@/lib/auth/allowlist";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  const { error, sent } = await searchParams;

  // If already logged in, go to dashboard.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user && isAllowedEmail(user.email)) {
    redirect("/dashboard");
  }

  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        marketintel is single-user. Only the configured email can sign in.
      </p>

      <form action={sendMagicLink} className="mt-8 space-y-3">
        <input
          name="email"
          type="email"
          required
          placeholder="you@example.com"
          autoComplete="email"
          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
        />
        <button
          type="submit"
          className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
        >
          Send magic link
        </button>
      </form>

      {sent && (
        <p className="mt-4 text-sm text-muted-foreground">
          If that email is allowed, a magic link has been sent.
        </p>
      )}
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {process.env.NODE_ENV !== "production" && getAllowedEmail() && (
        <p className="mt-12 text-xs text-muted-foreground">
          Dev hint: allowlist = {getAllowedEmail()}
        </p>
      )}
    </main>
  );
}

async function sendMagicLink(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  // Pretend-success on disallowed emails so we don't leak the allowlist.
  if (!isAllowedEmail(email)) {
    redirect("/login?sent=1");
  }

  const supabase = await createClient();
  const origin =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }
  redirect("/login?sent=1");
}
