import { describe, expect, it } from "vitest";
import {
  composeAccessRequestNotice,
  composeApprovalNotice,
} from "@/lib/email/access-emails";

/**
 * Access-email composition — pure, no I/O. Pins subjects, the branded chrome,
 * the Setup/login links (no double-slash from a trailing slash), and HTML
 * escaping of untrusted requester input.
 */

describe("composeAccessRequestNotice (owner notice)", () => {
  it("subject names the requester; links to Setup", () => {
    const email = composeAccessRequestNotice({
      requesterEmail: "new@user.com",
      note: "keen to try it",
      appUrl: "https://investorlogical.com/",
    });
    expect(email.subject).toBe("Access request — new@user.com");
    expect(email.textBody).toContain("new@user.com");
    expect(email.textBody).toContain("keen to try it");
    // Trailing slash must not produce a double-slash link.
    expect(email.textBody).toContain("https://investorlogical.com/dashboard/ops");
    expect(email.textBody).not.toContain(".com//");
    expect(email.htmlBody).toContain("/dashboard/ops");
  });

  it("renders the branded shell (wordmark + footer disclaimer)", () => {
    const email = composeApprovalNotice({ appUrl: "https://investorlogical.com" });
    expect(email.htmlBody).toContain("investor");
    expect(email.htmlBody).toContain("logical");
    expect(email.htmlBody).toContain("never advice or a recommendation");
  });

  it("handles a missing note without crashing", () => {
    const email = composeAccessRequestNotice({
      requesterEmail: "new@user.com",
      note: null,
      appUrl: "https://investorlogical.com",
    });
    expect(email.textBody).toContain("Note: (none)");
    expect(email.htmlBody).toContain("(none)");
  });

  it("escapes HTML in the requester email and note (untrusted input)", () => {
    const email = composeAccessRequestNotice({
      requesterEmail: 'x@y.com" onmouseover="alert(1)',
      note: '<script>alert("x")</script>',
      appUrl: "https://investorlogical.com",
    });
    expect(email.htmlBody).not.toContain("<script>");
    expect(email.htmlBody).toContain("&lt;script&gt;");
    expect(email.htmlBody).not.toContain('onmouseover="alert(1)"');
  });
});

describe("composeApprovalNotice (user welcome)", () => {
  it("welcomes and links to login; no advice language (I2)", () => {
    const email = composeApprovalNotice({ appUrl: "https://investorlogical.com/" });
    expect(email.subject).toContain("approved");
    expect(email.textBody).toContain("https://investorlogical.com/login");
    expect(email.textBody).not.toContain(".com//");
    expect(email.htmlBody).toContain("/login");

    const all = `${email.subject}\n${email.textBody}`.toLowerCase();
    for (const banned of ["you should", "buy", "sell", "act now", "we recommend"]) {
      expect(all).not.toContain(banned);
    }
  });
});
