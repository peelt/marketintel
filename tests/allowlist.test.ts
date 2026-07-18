import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { allowedEmails, getAllowedEmail, isAllowedEmail } from "@/lib/auth/allowlist";

/**
 * The allowlist is the app-layer entitlement gate. AUTH_ALLOWED_EMAIL is a
 * comma-separated list; a single address must behave exactly as it did before
 * multi-user support, and membership must be case/space-insensitive.
 */

const ORIGINAL = process.env.AUTH_ALLOWED_EMAIL;
beforeEach(() => {
  delete process.env.AUTH_ALLOWED_EMAIL;
});
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.AUTH_ALLOWED_EMAIL;
  else process.env.AUTH_ALLOWED_EMAIL = ORIGINAL;
});

describe("isAllowedEmail", () => {
  it("single address (no comma) behaves as before", () => {
    process.env.AUTH_ALLOWED_EMAIL = "peel@mxmg.com";
    expect(isAllowedEmail("peel@mxmg.com")).toBe(true);
    expect(isAllowedEmail("PEEL@MXMG.COM")).toBe(true); // case-insensitive
    expect(isAllowedEmail("  peel@mxmg.com  ")).toBe(true); // trimmed
    expect(isAllowedEmail("someone@else.com")).toBe(false);
  });

  it("comma-separated list admits every listed address, and no others", () => {
    process.env.AUTH_ALLOWED_EMAIL = "peel@mxmg.com, peeltaggart@gmail.com";
    expect(isAllowedEmail("peel@mxmg.com")).toBe(true);
    expect(isAllowedEmail("peeltaggart@gmail.com")).toBe(true);
    expect(isAllowedEmail("PeelTaggart@Gmail.com")).toBe(true);
    expect(isAllowedEmail("stranger@gmail.com")).toBe(false);
  });

  it("tolerates messy spacing/casing/empties in the env value", () => {
    process.env.AUTH_ALLOWED_EMAIL = " A@B.co ,, PEELTAGGART@GMAIL.COM ,";
    expect(allowedEmails()).toEqual(["a@b.co", "peeltaggart@gmail.com"]);
    expect(isAllowedEmail("a@b.co")).toBe(true);
  });

  it("unset/empty allows no one (never fails open)", () => {
    expect(isAllowedEmail("peel@mxmg.com")).toBe(false);
    expect(isAllowedEmail(null)).toBe(false);
    expect(isAllowedEmail(undefined)).toBe(false);
    process.env.AUTH_ALLOWED_EMAIL = "   ";
    expect(isAllowedEmail("peel@mxmg.com")).toBe(false);
    expect(getAllowedEmail()).toBeNull();
  });

  it("getAllowedEmail returns the first configured address (dev hint)", () => {
    process.env.AUTH_ALLOWED_EMAIL = "peel@mxmg.com, peeltaggart@gmail.com";
    expect(getAllowedEmail()).toBe("peel@mxmg.com");
  });
});
