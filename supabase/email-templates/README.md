# Supabase auth email templates

Supabase composes and sends auth email itself (Postmark is only the SMTP
transport), so these CANNOT be applied by deploying. They are pasted into
**Supabase → Authentication → Email Templates**.

| File | Paste into | Subject |
|---|---|---|
| `confirm-signup.html` | Confirm signup | Confirm your email — Investorlogical |
| `magic-link.html` | Magic Link | Your Investorlogical sign-in link |

**Both matter.** `app/login/page.tsx` calls `signInWithOtp` with
`shouldCreateUser: true`, so an address signing in for the FIRST time is
created on the spot and Supabase sends **Confirm signup** — not Magic Link.
Styling only Magic Link leaves every newly-invited user's very first email
unbranded.

`{{ .ConfirmationURL }}` is Supabase's placeholder, filled at send time. Leave
it exactly as-is.

These files are generated from `lib/email/auth-templates.ts`, which uses the
same branded shell as the emails we do send (`lib/email/layout.ts`). Edit the
composer, not the HTML, then regenerate with `npx vitest -u` — the snapshots in
`tests/auth-templates.test.ts` fail on drift.
