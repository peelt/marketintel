/**
 * Coerce any thrown value into a string suitable for logging or display.
 * Mirrors the util introduced during the ym2 strict-mode remediation.
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
