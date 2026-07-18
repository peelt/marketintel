import { describe, expect, it } from "vitest";
import { composeAlertEmail, type AlertItem } from "@/lib/alerts/compose";
import type { Delta, VerdictSnapshot } from "@/lib/holdings/deltas";

/**
 * Alert email composition — pure, no I/O. The email reuses describeDelta, so
 * these tests pin the alert-specific parts: subjects, links, escaping, and
 * the I2 language line (factual, never advice).
 */

function snap(overrides: Partial<VerdictSnapshot>): VerdictSnapshot {
  return {
    agentName: "metals",
    classification: "vulnerable",
    composite: 30,
    coverage: 0.8,
    runAt: "2026-07-18T12:00:00Z",
    reportId: "report-1",
    ...overrides,
  };
}

function worsened(): Delta {
  return {
    direction: "worsened",
    attention: true,
    latest: snap({ classification: "vulnerable" }),
    previous: snap({ classification: "well_positioned", reportId: "report-0" }),
  };
}

const AEM: AlertItem = {
  ticker: "AEM",
  name: "Agnico Eagle Mines",
  agentDisplay: "Precious Metals",
  delta: worsened(),
};

describe("composeAlertEmail", () => {
  it("returns null for no items — an empty alert is never sent", () => {
    expect(composeAlertEmail([], "https://investorlogical.com")).toBeNull();
  });

  it("single item: ticker-first subject, delta sentence, report link", () => {
    const email = composeAlertEmail([AEM], "https://investorlogical.com/")!;
    expect(email.subject).toBe("AEM: a desk changed its classification");
    expect(email.textBody).toContain(
      "Precious Metals moved AEM from well positioned to vulnerable.",
    );
    // Trailing slash on the app URL must not produce a double-slash link.
    expect(email.textBody).toContain("https://investorlogical.com/reports/report-1");
    expect(email.textBody).not.toContain(".com//");
    expect(email.htmlBody).toContain("reports/report-1");
  });

  it("multiple items: count subject and one line per item", () => {
    const second: AlertItem = {
      ...AEM,
      ticker: "MP",
      name: "MP Materials",
      agentDisplay: "Geopolitical Scanner",
      delta: {
        direction: "new",
        attention: true,
        latest: snap({ classification: "at_risk", agentName: "geopolitical" }),
        previous: null,
      },
    };
    const email = composeAlertEmail([AEM, second], "https://investorlogical.com")!;
    expect(email.subject).toBe("2 of your held names have new classifications");
    expect(email.textBody).toContain("AEM");
    expect(email.textBody).toContain(
      "Geopolitical Scanner newly classifies MP as at risk.",
    );
  });

  it("stays factual and impersonal — no advice language (I2)", () => {
    const email = composeAlertEmail([AEM], "https://investorlogical.com")!;
    const all = `${email.subject}\n${email.textBody}`.toLowerCase();
    // Directive language only — "recommendation" appears legitimately in the
    // disclaimer's NEGATION ("never a recommendation"), so ban the directive
    // forms, not the bare word.
    for (const banned of ["you should", "buy", "sell", "act now", "urgent", "we recommend"]) {
      expect(all).not.toContain(banned);
    }
    // The factual reason for the email IS stated.
    expect(email.textBody).toContain("never a recommendation");
  });

  it("escapes HTML in names", () => {
    const sneaky: AlertItem = {
      ...AEM,
      name: 'Agnico <script>alert("x")</script>',
    };
    const email = composeAlertEmail([sneaky], "https://investorlogical.com")!;
    expect(email.htmlBody).not.toContain("<script>");
    expect(email.htmlBody).toContain("&lt;script&gt;");
  });
});
