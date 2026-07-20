import { describe, expect, it } from "vitest";
import { deskSignalLine } from "@/lib/reports/desk-summary";

const rows = (...cls: (string | null)[]) => cls.map((classification) => ({ classification }));

describe("deskSignalLine", () => {
  it("leads with the dominant classification, count first", () => {
    const line = deskSignalLine(
      rows("mixed", "mixed", "beneficiary", "at_risk", "mixed", "beneficiary"),
    );
    expect(line).toBe("6 ranked · 3 mixed · 2 beneficiary · 1 at risk");
  });

  it("caps groups and reports the remainder", () => {
    const line = deskSignalLine(
      rows(
        "strong_overshoot",
        "mild_overshoot",
        "mild_overshoot",
        "proportionate",
        "underreaction",
      ),
      2,
    );
    // Two shown, three classifications remain beyond the cap → "+2 more".
    expect(line).toBe("5 ranked · 2 mild overshoot · 1 strong overshoot · +2 more");
  });

  it("breaks count ties by concern (flagged outranks benign)", () => {
    // one weak_profile (rank 2) vs one strong_profile (rank 0) — equal counts,
    // the flagged one leads.
    const line = deskSignalLine(rows("strong_profile", "weak_profile"), 2);
    expect(line).toBe("2 ranked · 1 weak profile · 1 strong profile");
  });

  it("ignores unclassified rows and returns null when nothing is classified", () => {
    expect(deskSignalLine(rows(null, null))).toBeNull();
    expect(deskSignalLine([])).toBeNull();
    expect(deskSignalLine(rows("mixed", null))).toBe("1 ranked · 1 mixed");
  });
});
