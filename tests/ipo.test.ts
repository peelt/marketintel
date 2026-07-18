import { describe, expect, it } from "vitest";
import { classifyIpo } from "@/lib/agents/ipo/metrics";
import { parseIpoEval } from "@/lib/agents/ipo/research";
import { cacheUsable } from "@/lib/agents/ipo/eval-cache";
import {
  assembleProspectusExcerpt,
  cleanIssuerName,
  dedupeByCik,
} from "@/lib/agents/ipo/discovery";
import { placeholderTicker } from "@/lib/agents/ipo/issuers";
import { parseNewsEvidence } from "@/lib/format";
import type { RawFiling, RawFilingSection } from "@/lib/data-sources/types";
import type { CandidateScore } from "@/lib/scoring/types";

function scored(overrides: {
  coverage?: number;
  business?: number | null;
  growth?: number | null;
  risk?: number | null;
  governance?: number | null;
}): CandidateScore {
  const {
    coverage = 0.9,
    business = 60,
    growth = 55,
    risk = 60,
    governance = 60,
  } = overrides;
  const sig = (key: string, raw: number | null) => ({
    score: raw,
    signals: { [key]: { raw, normalised: raw, weight: 1 } },
  });
  return {
    securityId: "s1",
    composite: 50, // deliberately mid — the composite must NOT drive labels
    coverage,
    criteria: {
      business_quality: sig("business_quality_grade", business),
      growth_prospects: sig("growth_grade", growth),
      risk_profile: sig("risk_grade", risk),
      governance: sig("governance_grade", governance),
    },
    evidence: [],
  };
}

const OPERATING = { isShellOrSpac: false };

describe("classifyIpo — absolute facts, never the blended composite", () => {
  it("withholds below the coverage floor", () => {
    const c = classifyIpo(scored({ coverage: 0.2 }), OPERATING);
    expect(c.classification).toBe("insufficient_data");
    expect(c.verdict).toContain("withheld");
  });

  it("withholds when the evaluation (the defining evidence) is missing", () => {
    const c = classifyIpo(
      scored({ business: null, growth: null, risk: null, governance: null, coverage: 0.5 }),
      OPERATING,
    );
    expect(c.classification).toBe("insufficient_data");
    expect(c.verdict).toContain("did not complete");
  });

  it("sets shells aside instead of grading them as businesses", () => {
    const c = classifyIpo(scored({ business: 5, growth: 5 }), { isShellOrSpac: true });
    expect(c.classification).toBe("shell_or_blank_check");
    expect(c.verdict).toContain("no operating business");
  });

  it("weak requires an absolute reason: business, severe risk, or poor governance", () => {
    expect(classifyIpo(scored({ business: 30 }), OPERATING).classification).toBe(
      "weak_profile",
    );
    expect(classifyIpo(scored({ risk: 25 }), OPERATING).classification).toBe(
      "weak_profile",
    );
    expect(classifyIpo(scored({ governance: 20 }), OPERATING).classification).toBe(
      "weak_profile",
    );
  });

  it("strong only when every dimension clears its bar", () => {
    const c = classifyIpo(
      scored({ business: 78, growth: 70, risk: 62, governance: 60 }),
      OPERATING,
    );
    expect(c.classification).toBe("strong_profile");
    // One dimension short → mixed, not strong.
    expect(
      classifyIpo(scored({ business: 78, growth: 40, risk: 62, governance: 60 }), OPERATING)
        .classification,
    ).toBe("mixed_profile");
  });

  it("verdicts describe the issuer, never advise the reader (I2)", () => {
    for (const c of [
      classifyIpo(scored({}), OPERATING),
      classifyIpo(scored({ business: 30 }), OPERATING),
      classifyIpo(scored({ business: 78, growth: 70, risk: 62 }), OPERATING),
      classifyIpo(scored({ business: 5 }), { isShellOrSpac: true }),
    ]) {
      expect(c.verdict.toLowerCase()).not.toMatch(/\b(you|your|buy|sell|should)\b/);
    }
  });
});

describe("parseIpoEval", () => {
  const valid = {
    business_quality_grade: 72,
    business_quality_note: "Recurring revenue with disclosed 120% net retention.",
    growth_grade: 65,
    growth_note: "Revenue grew from $80m to $140m per the MD&A.",
    risk_grade: 55,
    risk_note: "Customer concentration: top three customers are 40% of revenue.",
    governance_grade: 45,
    governance_note: "Dual-class structure with 10:1 super-voting shares.",
    offering_terms_grade: 60,
    offering_terms_note: "Primary raise; proceeds earmarked for capacity.",
    headline: "A subscription software vendor registering a primary raise.",
    summary: "The company sells subscription software.",
    proposed_ticker: "acme",
    is_shell_or_spac: false,
    confidence: "medium",
  };

  it("parses a valid payload and normalises the ticker to uppercase", () => {
    const e = parseIpoEval(JSON.stringify(valid))!;
    expect(e.businessQualityGrade).toBe(72);
    expect(e.riskGrade).toBe(55);
    expect(e.proposedTicker).toBe("ACME");
    expect(e.isShellOrSpac).toBe(false);
  });

  it("rejects out-of-range grades and missing fields", () => {
    expect(parseIpoEval(JSON.stringify({ ...valid, growth_grade: 140 }))).toBeNull();
    const { risk_note: _dropped, ...missing } = valid;
    expect(parseIpoEval(JSON.stringify(missing))).toBeNull();
    expect(parseIpoEval("not json")).toBeNull();
  });

  it("nulls an implausible ticker instead of polluting the securities table", () => {
    const e = parseIpoEval(
      JSON.stringify({ ...valid, proposed_ticker: "to be determined" }),
    )!;
    expect(e.proposedTicker).toBeNull();
  });
});

describe("ipo discovery — dedupe and issuer names", () => {
  const filing = (cik: string | undefined, filedAt: string): RawFiling => ({
    source: "sec_edgar",
    filingType: "S-1",
    filedAt,
    url: "https://example.test",
    issuerCik: cik,
    issuerName: "X",
    accessionNumber: `acc-${cik}-${filedAt}`,
  });

  it("keeps one filing per CIK — the latest — sorted newest first", () => {
    const out = dedupeByCik([
      filing("1", "2026-07-01T00:00:00Z"),
      filing("2", "2026-07-05T00:00:00Z"),
      filing("1", "2026-07-10T00:00:00Z"),
      filing(undefined, "2026-07-12T00:00:00Z"), // no CIK → dropped
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].issuerCik).toBe("1");
    expect(out[0].filedAt).toBe("2026-07-10T00:00:00Z");
  });

  it("strips EFTS identifier tails from display names", () => {
    expect(cleanIssuerName("Acme Corp  (ACME)  (CIK 0001234567)")).toBe("Acme Corp");
    expect(cleanIssuerName("Plainly Named Inc.")).toBe("Plainly Named Inc.");
  });

  it("placeholder ticker trims leading CIK zeros", () => {
    expect(placeholderTicker("0001234567")).toBe("CIK1234567");
  });
});

describe("assembleProspectusExcerpt", () => {
  const section = (name: string, content: string): RawFilingSection => ({
    accessionNumber: "a",
    sectionName: name,
    content,
  });

  it("refuses to assemble from fewer than two core sections", () => {
    expect(
      assembleProspectusExcerpt([
        section("underwriting", "The underwriters agree. ".repeat(50)),
        section("legal_matters", "Counsel opines. ".repeat(50)),
      ]),
    ).toBeNull();
  });

  it("includes the cover page and truncates over-budget sections", () => {
    const excerpt = assembleProspectusExcerpt([
      section("prologue", "PROSPECTUS 10,000,000 shares proposed symbol ACME"),
      section("prospectus_summary", "We are a growth company."),
      section("risk_factors", "Risk. ".repeat(10_000)), // > 18k chars
    ])!;
    expect(excerpt).toContain("## COVER PAGE");
    expect(excerpt).toContain("## PROSPECTUS SUMMARY");
    expect(excerpt).toContain("## RISK FACTORS");
    expect(excerpt).toContain("[…truncated]");
  });
});

describe("ipo eval cache — accession-aware + full-shape", () => {
  const payload = {
    accession: "0001-26-000001",
    businessQualityGrade: 70,
    businessQualityNote: "n",
    growthGrade: 60,
    growthNote: "n",
    riskGrade: 55,
    riskNote: "n",
    governanceGrade: 50,
    governanceNote: "n",
    offeringTermsGrade: 60,
    offeringTermsNote: "n",
    headline: "h",
    summary: "s",
    proposedTicker: null,
    isShellOrSpac: false,
    confidence: "medium" as const,
  };
  const now = new Date("2026-07-17T12:00:00Z");

  it("serves only a fresh entry whose accession still matches", () => {
    expect(cacheUsable(payload, "2026-07-10T00:00:00Z", "0001-26-000001", now)).toBe(true);
  });

  it("misses on an amendment (accession changed) even when fresh", () => {
    expect(cacheUsable(payload, "2026-07-10T00:00:00Z", "0001-26-000009", now)).toBe(false);
  });

  it("misses when stale, null, or missing a grade field (schema-change eviction)", () => {
    expect(cacheUsable(payload, "2026-05-01T00:00:00Z", "0001-26-000001", now)).toBe(false);
    expect(cacheUsable(null, "2026-07-10T00:00:00Z", "0001-26-000001", now)).toBe(false);
    // Accession matches but the grade shape is incomplete → re-grade.
    const { riskGrade: _dropped, ...missing } = payload;
    expect(cacheUsable(missing, "2026-07-10T00:00:00Z", "0001-26-000001", now)).toBe(false);
  });
});

describe("ipo evidence card shape", () => {
  it("parses with the shared structured-evidence parser (report card rendering)", () => {
    const text = `[ACME · business quality 72/100 · medium] A subscription software vendor registering a primary raise.\n\nThe company sells subscription software.\n\nRecurring revenue with disclosed retention.\n\nSources:\nS-1 filing (2026-07-10) — https://www.sec.gov/Archives/edgar/data/1234567/000123456726000001/0001234567-26-000001-index.htm`;
    const parsed = parseNewsEvidence(text)!;
    expect(parsed.ticker).toBe("ACME");
    expect(parsed.gradeLabel).toBe("business quality");
    expect(parsed.grade).toBe(72);
    expect(parsed.confidence).toBe("medium");
    expect(parsed.sources).toHaveLength(1);
    expect(parsed.sources[0].url).toContain("sec.gov");
  });
});
