import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearJwksCache, getCachedJwks } from "@/lib/auth/jwks";
import { verifyUser } from "@/lib/auth/verify";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The auth fast path: verify the session locally instead of paying a
 * round-trip to the auth server on every request. What these tests protect is
 * the SAFE direction — anything we can't verify locally must fall back to the
 * server, never be waved through.
 */

const KEY = { kty: "EC", key_ops: ["verify"], alg: "ES256", kid: "k1" };

function stubFetch(handler: (url: string) => Response): ReturnType<typeof vi.fn> {
  const spy = vi.fn(async (input: string | URL | Request) =>
    handler(String(input)),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

function jwks(keys: unknown[], status = 200): Response {
  return new Response(JSON.stringify({ keys }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  clearJwksCache();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.co";
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearJwksCache();
});

describe("getCachedJwks", () => {
  it("fetches once and serves the cache thereafter", async () => {
    const spy = stubFetch(() => jwks([KEY]));
    expect(await getCachedJwks()).toHaveLength(1);
    expect(await getCachedJwks()).toHaveLength(1);
    expect(await getCachedJwks()).toHaveLength(1);
    // Without this the per-request auth hop would just become a per-request
    // JWKS hop — the cache IS the optimisation.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent cold callers into one fetch", async () => {
    const spy = stubFetch(() => jwks([KEY]));
    const all = await Promise.all([
      getCachedJwks(),
      getCachedJwks(),
      getCachedJwks(),
    ]);
    expect(all.every((k) => k.length === 1)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("returns empty (never throws) when the key set can't be fetched", async () => {
    stubFetch(() => jwks([], 500));
    await expect(getCachedJwks()).resolves.toEqual([]);
  });

  it("drops malformed keys instead of caching a set that can't verify", async () => {
    stubFetch(() => jwks([{ alg: "ES256" }, KEY]));
    const keys = await getCachedJwks();
    expect(keys).toHaveLength(1);
    expect(keys[0].kid).toBe("k1");
  });

  it("does not cache an empty answer — it retries rather than pinning the fallback", async () => {
    let call = 0;
    const spy = stubFetch(() => {
      call++;
      return call === 1 ? jwks([]) : jwks([KEY]);
    });
    expect(await getCachedJwks()).toEqual([]);
    expect(await getCachedJwks()).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

/** Minimal stand-in for the bits of the client verifyUser touches. */
function client(auth: {
  getClaims?: unknown;
  getUser?: unknown;
}): SupabaseClient {
  return { auth } as unknown as SupabaseClient;
}

describe("verifyUser", () => {
  it("uses locally verified claims and never calls the auth server", async () => {
    stubFetch(() => jwks([KEY]));
    const getUser = vi.fn();
    const user = await verifyUser(
      client({
        getClaims: async () => ({
          data: { claims: { sub: "user-1", email: "a@b.com" } },
          error: null,
        }),
        getUser,
      }),
    );
    expect(user).toEqual({ id: "user-1", email: "a@b.com" });
    expect(getUser).not.toHaveBeenCalled();
  });

  it("reports no user for a signed-out request without a fallback round-trip", async () => {
    stubFetch(() => jwks([KEY]));
    const getUser = vi.fn();
    const user = await verifyUser(
      client({
        getClaims: async () => ({ data: null, error: null }),
        getUser,
      }),
    );
    expect(user).toBeNull();
    expect(getUser).not.toHaveBeenCalled();
  });

  it("falls back to the auth server when local verification errors", async () => {
    stubFetch(() => jwks([KEY]));
    const getUser = vi.fn(async () => ({
      data: { user: { id: "user-2", email: "c@d.com" } },
    }));
    const user = await verifyUser(
      client({
        getClaims: async () => ({ data: null, error: new Error("bad signature") }),
        getUser,
      }),
    );
    expect(user).toEqual({ id: "user-2", email: "c@d.com" });
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it("falls back when getClaims throws", async () => {
    stubFetch(() => jwks([KEY]));
    const getUser = vi.fn(async () => ({
      data: { user: { id: "user-3", email: null } },
    }));
    const user = await verifyUser(
      client({
        getClaims: async () => {
          throw new Error("boom");
        },
        getUser,
      }),
    );
    expect(user).toEqual({ id: "user-3", email: null });
  });

  it("falls back when no signing keys are available", async () => {
    stubFetch(() => jwks([], 500));
    const getClaims = vi.fn();
    const getUser = vi.fn(async () => ({ data: { user: null } }));
    const user = await verifyUser(client({ getClaims, getUser }));
    // No keys means nothing to verify against — ask the server, don't guess.
    expect(getClaims).not.toHaveBeenCalled();
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(user).toBeNull();
  });

  it("falls back when claims carry no subject", async () => {
    stubFetch(() => jwks([KEY]));
    const getUser = vi.fn(async () => ({ data: { user: null } }));
    const user = await verifyUser(
      client({
        getClaims: async () => ({ data: { claims: { email: "x@y.com" } }, error: null }),
        getUser,
      }),
    );
    expect(user).toBeNull();
    expect(getUser).toHaveBeenCalledTimes(1);
  });
});
