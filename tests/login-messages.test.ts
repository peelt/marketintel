import { describe, expect, it } from "vitest";
import { loginErrorMessage } from "@/lib/auth/login-messages";

describe("loginErrorMessage", () => {
  it("turns the per-user interval into a plain wait", () => {
    // Supabase's own wording, shown raw to users until now.
    expect(
      loginErrorMessage(
        "For security purposes, you can only request this after 47 seconds.",
      ),
    ).toBe(
      "a link was just sent to that address — you can request another in 47 seconds.",
    );
    expect(loginErrorMessage("you can only request this after 1 second")).toContain(
      "in 1 second.",
    );
  });

  it("explains an hourly cap without naming the mechanism", () => {
    expect(loginErrorMessage("Email rate limit exceeded")).toBe(
      "too many sign-in emails just went out — wait a minute and try again.",
    );
  });

  it("owns a send failure rather than implying the user can fix it", () => {
    expect(loginErrorMessage("Error sending magic link email")).toContain(
      "that's our end, not yours",
    );
  });

  it("keeps an unrecognised provider error rather than hiding it", () => {
    expect(loginErrorMessage("Signups not allowed for otp")).toBe(
      "Signups not allowed for otp",
    );
  });

  it("handles an empty error", () => {
    expect(loginErrorMessage("   ")).toBe("That didn't send — try again in a moment.");
  });
});
