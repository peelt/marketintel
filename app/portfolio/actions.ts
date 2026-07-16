"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "@/lib/auth/allowlist";
import { loadDefaultPortfolio, type PortfolioRow } from "@/lib/holdings/data";
import { getErrorMessage } from "@/lib/errors";

/**
 * Portfolio server actions. Every action runs under the user's RLS session
 * (createClient) — the service-role client never touches a request-reachable
 * path, so holdings can only ever read/write the caller's own rows. Purchase
 * price is stored for P/L display only and never joins scoring (I2).
 *
 * On-demand resolution of untracked tickers is deliberately NOT here: it would
 * need to INSERT into `securities`, a service-role write, on a request path.
 * 6a scopes to already-tracked names (~900: S&P 500 + FTSE 350 + curated);
 * broadening is a follow-up that routes resolution through Inngest.
 */

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAllowedEmail(user.email)) {
    throw new Error("not authorized");
  }
  return { supabase, user };
}

/** Get the user's default portfolio, creating one on first use. */
export async function ensureDefaultPortfolio(): Promise<
  ActionResult<PortfolioRow>
> {
  try {
    const { supabase, user } = await requireUser();
    const existing = await loadDefaultPortfolio(supabase, user.id);
    if (existing) return { ok: true, data: existing };

    const { data, error } = await supabase
      .from("portfolios")
      .insert({ user_id: user.id, name: "My Portfolio", base_currency: "GBP" })
      .select("id, name, base_currency")
      .single<PortfolioRow>();
    if (error) throw error;
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: getErrorMessage(err) };
  }
}

export interface SecurityHit {
  id: string;
  ticker: string;
  exchange: string;
  name: string;
  currency: string;
}

/** Autocomplete over TRACKED securities (ticker or name). Case-insensitive. */
export async function searchSecurities(
  query: string,
): Promise<ActionResult<SecurityHit[]>> {
  try {
    const { supabase } = await requireUser();
    const q = query.trim();
    if (q.length < 1) return { ok: true, data: [] };
    const safe = q.replace(/[%,()]/g, " ");
    const { data, error } = await supabase
      .from("securities")
      .select("id, ticker, exchange, name, currency")
      .is("delisted_at", null)
      .or(`ticker.ilike.${safe}%,name.ilike.%${safe}%`)
      .order("ticker", { ascending: true })
      .limit(12)
      .returns<SecurityHit[]>();
    if (error) throw error;
    return { ok: true, data: data ?? [] };
  } catch (err) {
    return { ok: false, error: getErrorMessage(err) };
  }
}

export interface AddHoldingInput {
  securityId: string;
  quantity: number;
  purchasePrice?: number | null;
  purchaseCurrency?: string | null;
  purchaseDate?: string | null;
  notes?: string | null;
}

export async function addHolding(
  input: AddHoldingInput,
): Promise<ActionResult> {
  try {
    const { supabase, user } = await requireUser();

    if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
      return { ok: false, error: "Quantity must be a positive number." };
    }
    if (
      input.purchasePrice != null &&
      (!Number.isFinite(input.purchasePrice) || input.purchasePrice < 0)
    ) {
      return { ok: false, error: "Purchase price can't be negative." };
    }

    // Ensure a portfolio exists and belongs to this user.
    const portfolioResult = await ensureDefaultPortfolio();
    if (!portfolioResult.ok || !portfolioResult.data) {
      return { ok: false, error: portfolioResult.ok ? "no portfolio" : portfolioResult.error };
    }

    // Confirm the security is tracked (defence in depth — the picker only
    // offers tracked names, but never trust the client's id blindly).
    const { data: sec } = await supabase
      .from("securities")
      .select("id, currency")
      .eq("id", input.securityId)
      .maybeSingle<{ id: string; currency: string }>();
    if (!sec) {
      return { ok: false, error: "That security isn't tracked yet." };
    }

    const { error } = await supabase.from("holdings").insert({
      portfolio_id: portfolioResult.data.id,
      security_id: input.securityId,
      quantity: input.quantity,
      purchase_price: input.purchasePrice ?? null,
      purchase_currency:
        input.purchasePrice != null
          ? (input.purchaseCurrency ?? sec.currency)
          : null,
      purchase_date: input.purchaseDate ?? null,
      notes: input.notes ?? null,
    });
    if (error) throw error;

    // Belt-and-braces: RLS already scopes to this user; referencing user keeps
    // the linter honest that the session was resolved.
    void user;
    revalidatePath("/portfolio");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: getErrorMessage(err) };
  }
}

export async function deleteHolding(holdingId: string): Promise<ActionResult> {
  try {
    const { supabase } = await requireUser();
    const { error } = await supabase.from("holdings").delete().eq("id", holdingId);
    if (error) throw error;
    revalidatePath("/portfolio");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: getErrorMessage(err) };
  }
}
