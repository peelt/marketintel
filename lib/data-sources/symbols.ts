/**
 * Shared ticker → provider-symbol mapping.
 *
 * Yahoo and Finnhub use the same suffix convention for non-US exchanges
 * (".L" for LSE, ".TO" for TSX, ...). US tickers are bare.
 *
 * LSE tickers that end in a dot (e.g. Aviva is "AV." on the LSE) must have
 * the trailing dot stripped before the suffix is appended — "AV..L" matches
 * nothing on either provider; the correct symbol is "AV.L".
 */
export function suffixSymbol(ticker: string, exchange: string): string {
  const base = ticker.replace(/\.+$/, "");
  const upper = exchange.toUpperCase();
  if (upper === "LSE" || upper === "LON") return `${base}.L`;
  if (upper === "TSX") return `${base}.TO`;
  if (upper === "TSXV") return `${base}.V`;
  if (upper === "HKEX") return `${base}.HK`;
  if (upper === "ASX") return `${base}.AX`;
  return ticker; // US default
}
