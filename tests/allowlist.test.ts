import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ownerEmails, getOwnerEmail, isOwnerEmail } from "@/lib/auth/allowlist";

/**
 * AUTH_ALLOWED_EMAIL is the OWNER list (comma-separated) — admins who can run
 * Setup and approve users. Everyday entitlement lives in app_users (DB, tested
 * via integration, not here). These pin the pure env parsing.
 */

const ORIGINAL = process.env.AUTH_ALLOWED_EMAIL;
beforeEach(() => {
  delete process.env.AUTH_ALLOWED_EMAIL;
});
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.AUTH_ALLOWED_EMAIL;
  else process.env.AUTH_ALLOWED_EMAIL = ORIGINAL;
});

describe("isOwnerEmail", () => {
  it("single owner (no comma) matches case/space-insensitively", () => {
    process.env.AUTH_ALLOWED_EMAIL = "peel@mxmg.com";
    expect(isOwnerEmail("peel@mxmg.com")).toBe(true);
    expect(isOwnerEmail("PEEL@MXMG.COM")).toBe(true);
    expect(isOwnerEmail("  peel@mxmg.com  ")).toBe(true);
    expect(isOwnerEmail("someone@else.com")).toBe(false);
  });

  it("comma-separated list admits every listed owner, and no others", () => {
    process.env.AUTH_ALLOWED_EMAIL = "peel@mxmg.com, second@owner.com";
    expect(isOwnerEmail("peel@mxmg.com")).toBe(true);
    expect(isOwnerEmail("second@owner.com")).toBe(true);
    expect(isOwnerEmail("stranger@gmail.com")).toBe(false);
  });

  it("tolerates messy spacing/casing/empties", () => {
    process.env.AUTH_ALLOWED_EMAIL = " A@B.co ,, SECOND@OWNER.COM ,";
    expect(ownerEmails()).toEqual(["a@b.co", "second@owner.com"]);
    expect(isOwnerEmail("a@b.co")).toBe(true);
  });

  it("unset/empty means no owners (never fails open)", () => {
    expect(isOwnerEmail("peel@mxmg.com")).toBe(false);
    expect(isOwnerEmail(null)).toBe(false);
    expect(isOwnerEmail(undefined)).toBe(false);
    process.env.AUTH_ALLOWED_EMAIL = "   ";
    expect(isOwnerEmail("peel@mxmg.com")).toBe(false);
    expect(getOwnerEmail()).toBeNull();
  });

  it("getOwnerEmail returns the first configured owner (dev hint)", () => {
    process.env.AUTH_ALLOWED_EMAIL = "peel@mxmg.com, second@owner.com";
    expect(getOwnerEmail()).toBe("peel@mxmg.com");
  });
});
