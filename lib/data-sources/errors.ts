import type { DataSourceName } from "./types";

/**
 * Error source: usually a registered adapter, but occasional one-off fetchers
 * (e.g. Wikipedia constituent tables) carry their own label.
 */
export type ErrorSource = DataSourceName | (string & {});

/**
 * Typed error taxonomy for data-source adapters.
 *
 * The point (plan §3.5b): schema drift must be distinguishable from a
 * delisting or a throttle. A silent zero from a provider whose response shape
 * changed is a data-integrity bug; a 404 for an acquired ticker is expected
 * housekeeping. Consumers (fallback wrapper, per-run failure report) branch
 * on `kind`, never on message strings.
 */

export type DataSourceErrorKind =
  | "schema_changed"
  | "not_found"
  | "rate_limited"
  | "blocked"
  | "network"
  | "not_configured";

export class DataSourceError extends Error {
  readonly kind: DataSourceErrorKind;
  readonly source: ErrorSource;

  constructor(
    kind: DataSourceErrorKind,
    source: ErrorSource,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(`[${source}/${kind}] ${message}`, options);
    this.name = "DataSourceError";
    this.kind = kind;
    this.source = source;
  }
}

/** Provider response no longer matches our Zod schema — the adapter needs updating. */
export class SchemaChangedError extends DataSourceError {
  constructor(source: ErrorSource, message: string, options?: { cause?: unknown }) {
    super("schema_changed", source, message, options);
    this.name = "SchemaChangedError";
  }
}

/** Symbol/series unknown to the provider — likely delisted, renamed, or out of coverage. */
export class NotFoundError extends DataSourceError {
  constructor(source: ErrorSource, message: string) {
    super("not_found", source, message);
    this.name = "NotFoundError";
  }
}

/** Provider throttled us (429). Retry later; don't treat as missing data. */
export class RateLimitedError extends DataSourceError {
  constructor(source: ErrorSource, message: string) {
    super("rate_limited", source, message);
    this.name = "RateLimitedError";
  }
}

/** Provider refused the request (401/403) — bad key, paywalled endpoint, or bot-blocked. */
export class BlockedError extends DataSourceError {
  constructor(source: ErrorSource, message: string) {
    super("blocked", source, message);
    this.name = "BlockedError";
  }
}

/** Adapter exists but its API key / config is absent. Fail fast, never guess. */
export class NotConfiguredError extends DataSourceError {
  constructor(source: ErrorSource, message: string) {
    super("not_configured", source, message);
    this.name = "NotConfiguredError";
  }
}

/** Map an HTTP status onto the taxonomy. Anything unrecognised is `network`. */
export function errorFromStatus(
  source: ErrorSource,
  status: number,
  context: string,
): DataSourceError {
  if (status === 404) return new NotFoundError(source, `404 for ${context}`);
  if (status === 429) return new RateLimitedError(source, `429 for ${context}`);
  if (status === 401 || status === 403) {
    return new BlockedError(source, `${status} for ${context}`);
  }
  return new DataSourceError("network", source, `HTTP ${status} for ${context}`);
}

export function isDataSourceError(err: unknown): err is DataSourceError {
  return err instanceof DataSourceError;
}

/** Kind for reporting: typed errors keep their kind, everything else is "unknown". */
export function errorKind(err: unknown): DataSourceErrorKind | "unknown" {
  return isDataSourceError(err) ? err.kind : "unknown";
}
