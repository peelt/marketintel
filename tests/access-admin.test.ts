import { describe, expect, it } from "vitest";
import { isAlreadyRegistered } from "@/lib/auth/access-admin";

/**
 * Approval creates the Supabase auth account, without which a first magic
 * link fails with "Signups not allowed for this instance" (signups are
 * disabled on the project). Approving an existing user must stay a no-op
 * rather than an error.
 */
describe("isAlreadyRegistered", () => {
  it("treats Supabase's existing-user errors as success", () => {
    for (const m of [
      "A user with this email address has already been registered",
      "User already registered",
      "duplicate key value violates unique constraint",
      "Email exists",
    ]) {
      expect(isAlreadyRegistered(m)).toBe(true);
    }
  });

  it("does not swallow a real failure", () => {
    for (const m of [
      "Signups not allowed for this instance",
      "Database error creating new user",
      "invalid email",
    ]) {
      expect(isAlreadyRegistered(m)).toBe(false);
    }
  });
});
