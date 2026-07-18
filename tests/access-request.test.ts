import { describe, expect, it } from "vitest";
import { validateAccessRequest } from "@/lib/auth/access-request";

describe("validateAccessRequest", () => {
  it("accepts a plain email, lowercased and trimmed, empty note → null", () => {
    const v = validateAccessRequest({
      email: "  Person@Example.COM ",
      note: "  ",
      honeypot: "",
    });
    expect(v).toEqual({ kind: "valid", email: "person@example.com", note: null });
  });

  it("keeps a real note", () => {
    const v = validateAccessRequest({
      email: "a@b.co",
      note: "I run a small fund.",
      honeypot: null,
    });
    expect(v.kind).toBe("valid");
    if (v.kind === "valid") expect(v.note).toBe("I run a small fund.");
  });

  it("rejects malformed emails with a friendly message", () => {
    for (const bad of ["", "nope", "a@b", "a b@c.com", "@example.com"]) {
      const v = validateAccessRequest({ email: bad, note: "", honeypot: "" });
      expect(v.kind).toBe("invalid");
    }
  });

  it("rejects over-long notes", () => {
    const v = validateAccessRequest({
      email: "a@b.co",
      note: "x".repeat(501),
      honeypot: "",
    });
    expect(v.kind).toBe("invalid");
  });

  it("goes silent when the honeypot is filled — bots learn nothing", () => {
    const v = validateAccessRequest({
      email: "real@looking.com",
      note: "legit note",
      honeypot: "Acme Corp",
    });
    expect(v).toEqual({ kind: "silent" });
  });
});
