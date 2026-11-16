import { describe, expect, it } from "vitest";
import {
  authEmailTemplates,
  confirmSignupTemplate,
  magicLinkTemplate,
} from "@/lib/email/auth-templates";

/**
 * Supabase sends auth email itself, so these templates are pasted into its
 * dashboard rather than deployed. The file snapshots ARE the paste-ready
 * artefacts in supabase/email-templates/ — edit the composer and re-run with
 * `npx vitest -u` to regenerate them; drift fails the suite.
 */

describe("auth email templates", () => {
  it("keeps Supabase's placeholder intact and unescaped", () => {
    for (const t of authEmailTemplates()) {
      // Escaping this would break the link Supabase substitutes at send time.
      expect(t.html).toContain("{{ .ConfirmationURL }}");
      expect(t.html).not.toContain("&lt;");
      expect(t.html).not.toContain("%7B%7B");
    }
  });

  it("covers BOTH templates a real sign-in can hit", () => {
    // shouldCreateUser: true means a first-time address gets "Confirm signup",
    // not "Magic Link" — styling only the latter leaves an invited user's very
    // first email unbranded.
    expect(authEmailTemplates().map((t) => t.target)).toEqual([
      "Confirm signup",
      "Magic Link",
    ]);
  });

  it("always prints the link, not just a button", () => {
    // A button alone is not a reliable delivery mechanism: if a client eats it
    // the reader has nothing to copy and cannot sign in at all.
    for (const t of authEmailTemplates()) {
      expect(t.html.split("{{ .ConfirmationURL }}").length - 1).toBeGreaterThanOrEqual(2);
      expect(t.html).toContain("paste this into your browser");
    }
  });

  it("renders in the house style", () => {
    for (const t of authEmailTemplates()) {
      expect(t.html).toContain("investor"); // two-tone text wordmark
      expect(t.html).toContain("#034566"); // family navy
      expect(t.subject).toContain("Investorlogical");
    }
  });

  it("matches the paste-ready file for Confirm signup", async () => {
    await expect(confirmSignupTemplate().html).toMatchFileSnapshot(
      "../supabase/email-templates/confirm-signup.html",
    );
  });

  it("matches the paste-ready file for Magic Link", async () => {
    await expect(magicLinkTemplate().html).toMatchFileSnapshot(
      "../supabase/email-templates/magic-link.html",
    );
  });
});
