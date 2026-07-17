import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchFilings, splitFilingSections } from "@/lib/data-sources/sec-edgar";

/**
 * EDGAR reader contract tests — the two audited v1 failures, pinned:
 *  1. searchFilings read only the first EFTS page (10 hits).
 *  2. splitFilingSections couldn't match "Item 1A." and collapsed S-1
 *     prospectuses (no Item headings) into a single prologue.
 */

beforeEach(() => {
  process.env.SEC_EDGAR_USER_AGENT = "test test@example.com";
});
afterEach(() => {
  delete process.env.SEC_EDGAR_USER_AGENT;
  vi.unstubAllGlobals();
});

describe("splitFilingSections — 10-K style", () => {
  const TEN_K = `
    <html><body>
    <p>UNITED STATES SECURITIES AND EXCHANGE COMMISSION Form 10-K</p>
    <p>TABLE OF CONTENTS</p>
    <p><b>Item 1.</b> Business</p>
    <p><b>Item 1A.</b> Risk Factors</p>
    <p><b>Item 7A.</b> Quantitative Disclosures</p>
    <p><b>Item 1.</b> Business — We make widgets across three continents and
    have done for forty years. ${"Detail sentence. ".repeat(30)}</p>
    <p><b>Item 1A.</b> Risk Factors — Our business faces material risks
    including supply concentration. ${"Risk sentence. ".repeat(30)}</p>
    <p><b>Item 7A.</b> Quantitative and Qualitative Disclosures About Market
    Risk — We hedge currency exposure. ${"Hedge sentence. ".repeat(30)}</p>
    </body></html>`;

  it("captures letter-suffixed items — Item 1A is the one that matters", () => {
    const sections = splitFilingSections("acc-1", TEN_K);
    const names = sections.map((s) => s.sectionName);
    expect(names).toContain("item_1a");
    expect(names).toContain("item_7a");
    const riskSection = sections.find((s) => s.sectionName === "item_1a")!;
    expect(riskSection.content).toContain("material risks");
  });

  it("dedupes table-of-contents echoes — the real body wins over the TOC line", () => {
    const sections = splitFilingSections("acc-1", TEN_K);
    const item1 = sections.filter((s) => s.sectionName === "item_1");
    expect(item1).toHaveLength(1);
    expect(item1[0].content).toContain("three continents");
  });
});

describe("splitFilingSections — S-1 prospectus (no Item headings)", () => {
  const S_1 = `
    <html><body>
    <p>PROSPECTUS — 10,000,000 Shares of Common Stock</p>
    <p>TABLE OF CONTENTS: PROSPECTUS SUMMARY RISK FACTORS USE OF PROCEEDS UNDERWRITING</p>
    <p>PROSPECTUS SUMMARY</p>
    <p>We are a growth company operating a subscription platform.
    ${"Summary sentence. ".repeat(30)}</p>
    <p>RISK FACTORS</p>
    <p>Investing in our common stock involves a high degree of risk, including
    customer concentration and a history of losses. ${"Risk sentence. ".repeat(30)}</p>
    <p>USE OF PROCEEDS</p>
    <p>We intend to use the net proceeds for working capital.
    ${"Proceeds sentence. ".repeat(30)}</p>
    <p>UNDERWRITING</p>
    <p>The underwriters named below have agreed to purchase shares.
    ${"Underwriting sentence. ".repeat(30)}</p>
    </body></html>`;

  it("falls back to prospectus headings and finds the risk factors", () => {
    const sections = splitFilingSections("acc-2", S_1);
    const names = sections.map((s) => s.sectionName);
    expect(names).toContain("risk_factors");
    expect(names).toContain("use_of_proceeds");
    expect(names).toContain("prospectus_summary");
    const risks = sections.find((s) => s.sectionName === "risk_factors")!;
    expect(risks.content).toContain("high degree of risk");
    // The TOC echo (headings run together) must not have swallowed the body.
    expect(risks.content.length).toBeGreaterThan(200);
  });
});

describe("searchFilings pagination", () => {
  function eftsPage(count: number, offset: number, total: number) {
    return {
      hits: {
        total: { value: total },
        hits: Array.from({ length: count }, (_, i) => ({
          _source: {
            adsh: `000000000-26-${String(offset + i).padStart(6, "0")}`,
            ciks: ["1234567"],
            display_names: [`Issuer ${offset + i}`],
            form: "S-1",
            file_date: "2026-07-10",
            file_type: "S-1",
          },
        })),
      },
    };
  }

  it("pages past the first 10 hits — the audited v1 truncation", async () => {
    const requested: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        requested.push(url);
        const from = Number(new URL(url).searchParams.get("from") ?? "0");
        const total = 23;
        const count = Math.min(10, total - from);
        return new Response(JSON.stringify(eftsPage(count, from, total)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const filings = await searchFilings({ forms: ["S-1"], max: 100 });
    expect(filings).toHaveLength(23);
    expect(requested).toHaveLength(3); // 10 + 10 + 3
    expect(filings[22].issuerName).toBe("Issuer 22");
  });

  it("respects max without fetching needless pages", async () => {
    const requested: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        requested.push(String(input));
        const from = Number(new URL(String(input)).searchParams.get("from") ?? "0");
        return new Response(JSON.stringify(eftsPage(10, from, 500)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const filings = await searchFilings({ forms: ["S-1"], max: 15 });
    expect(filings).toHaveLength(15);
    expect(requested).toHaveLength(2);
  });
});
