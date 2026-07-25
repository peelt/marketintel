import { describe, expect, it } from "vitest";
import { isNavActive } from "@/lib/nav";

describe("isNavActive", () => {
  it("marks the exact route active", () => {
    expect(isNavActive("/dashboard", "/dashboard")).toBe(true);
    expect(isNavActive("/reports", "/reports")).toBe(true);
    expect(isNavActive("/portfolio", "/portfolio")).toBe(true);
  });

  it("keeps a section active on its sub-pages", () => {
    expect(isNavActive("/reports/abc-123", "/reports")).toBe(true);
  });

  it("does NOT light up dashboard on its own admin children", () => {
    // The regression this guards: /dashboard is a prefix of /dashboard/ops,
    // which is its own nav entry — a naive startsWith selects both at once.
    expect(isNavActive("/dashboard/ops", "/dashboard")).toBe(false);
    expect(isNavActive("/dashboard/diagnostics", "/dashboard")).toBe(false);
    expect(isNavActive("/dashboard/ops", "/dashboard/ops")).toBe(true);
  });

  it("does not match unrelated or partially-similar routes", () => {
    expect(isNavActive("/reports", "/portfolio")).toBe(false);
    // prefix-of-a-word must not count: /report-archive is not under /reports
    expect(isNavActive("/reportsarchive", "/reports")).toBe(false);
  });
});
