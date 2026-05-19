import { getErrorMessage } from "@/lib/errors";

/**
 * Shared fetch helper for data-source adapters.
 *
 * - Enforces a sane timeout (default 20s).
 * - Retries idempotent (GET/HEAD) requests with exponential backoff.
 * - Optionally throttles per host to respect provider rate limits.
 * - Adds a configurable User-Agent (SEC EDGAR requires identification).
 *
 * Not a full-blown HTTP client — deliberately minimal. Providers that need
 * pagination, auth headers or POST bodies wrap this and add their specifics.
 */

export interface FetchOptions extends RequestInit {
  timeoutMs?: number;
  retries?: number;
  /** Min ms between requests to the same hostname. */
  hostThrottleMs?: number;
  userAgent?: string;
}

const lastHit: Map<string, number> = new Map();

export async function httpFetch(
  url: string,
  options: FetchOptions = {},
): Promise<Response> {
  const {
    timeoutMs = 20_000,
    retries = 2,
    hostThrottleMs = 0,
    userAgent,
    headers,
    ...init
  } = options;

  if (hostThrottleMs > 0) {
    const host = new URL(url).host;
    const last = lastHit.get(host) ?? 0;
    const wait = last + hostThrottleMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastHit.set(host, Date.now());
  }

  const mergedHeaders: Record<string, string> = {
    Accept: "application/json",
    ...(userAgent ? { "User-Agent": userAgent } : {}),
    ...(headers as Record<string, string> | undefined),
  };

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...init,
        headers: mergedHeaders,
        signal: controller.signal,
      });
      clearTimeout(timer);

      // Retry on 5xx and 429
      if (response.status >= 500 || response.status === 429) {
        if (attempt < retries) {
          await sleep(backoff(attempt));
          continue;
        }
      }
      return response;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      if (attempt < retries) {
        await sleep(backoff(attempt));
        continue;
      }
    }
  }

  throw new Error(
    `httpFetch failed for ${url}: ${getErrorMessage(lastError)}`,
  );
}

export async function httpJson<T>(
  url: string,
  options: FetchOptions = {},
): Promise<T> {
  const res = await httpFetch(url, options);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `httpJson ${res.status} ${res.statusText} for ${url} — ${body.slice(0, 200)}`,
    );
  }
  return (await res.json()) as T;
}

export async function httpText(
  url: string,
  options: FetchOptions = {},
): Promise<string> {
  const res = await httpFetch(url, options);
  if (!res.ok) {
    throw new Error(`httpText ${res.status} ${res.statusText} for ${url}`);
  }
  return res.text();
}

function backoff(attempt: number): number {
  return Math.min(8_000, 500 * Math.pow(2, attempt)) + Math.floor(Math.random() * 200);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
