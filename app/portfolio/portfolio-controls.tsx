"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addHolding,
  deleteHolding,
  searchSecurities,
  type SecurityHit,
} from "./actions";

/**
 * Client controls for the My Portfolio page: an add flow (search → quantity →
 * optional price/date, "add another" loop) and per-row delete. Kept minimal —
 * the target is a first holding added in under 30 seconds with nothing
 * mandatory beyond ticker + quantity.
 */

export function AddHolding() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SecurityHit[]>([]);
  const [selected, setSelected] = useState<SecurityHit | null>(null);
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [date, setDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();
  const [saving, startSave] = useTransition();

  function runSearch(next: string) {
    setQuery(next);
    setSelected(null);
    if (next.trim().length < 1) {
      setHits([]);
      return;
    }
    startSearch(async () => {
      const res = await searchSecurities(next);
      setHits(res.ok ? (res.data ?? []) : []);
    });
  }

  function reset(keepMessage: string | null) {
    setQuery("");
    setHits([]);
    setSelected(null);
    setQuantity("");
    setPrice("");
    setDate("");
    setError(null);
    setJustAdded(keepMessage);
  }

  function submit() {
    setError(null);
    if (!selected) {
      setError("Pick a security first.");
      return;
    }
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError("Enter a quantity greater than zero.");
      return;
    }
    const parsedPrice = price.trim() === "" ? null : Number(price);
    if (parsedPrice != null && (!Number.isFinite(parsedPrice) || parsedPrice < 0)) {
      setError("Purchase price must be a positive number, or left blank.");
      return;
    }
    startSave(async () => {
      const res = await addHolding({
        securityId: selected.id,
        quantity: qty,
        purchasePrice: parsedPrice,
        purchaseCurrency: selected.currency,
        purchaseDate: date.trim() === "" ? null : date,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      reset(`Added ${selected.ticker}.`);
      router.refresh();
    });
  }

  return (
    <div className="card-cli p-5">
      <div className="font-mono-cli text-base font-bold text-il-navy">
        Add a holding
      </div>

      {!selected ? (
        <div className="mt-3">
          <label htmlFor="sec-search" className="label-cli">
            search by ticker or company name
          </label>
          <input
            id="sec-search"
            value={query}
            onChange={(e) => runSearch(e.target.value)}
            placeholder="e.g. VOD, Aviva, AAPL"
            autoComplete="off"
            className="input-cli"
          />
          {searching && (
            <p className="mt-2 font-mono-cli text-sm text-muted-foreground">
              ~ searching…
            </p>
          )}
          {!searching && query.trim().length >= 1 && hits.length === 0 && (
            <p className="mt-2 text-sm text-muted-foreground">
              No tracked security matches “{query}”. The screener currently
              covers the S&amp;P 500, FTSE 350 and the curated watchlists.
            </p>
          )}
          {hits.length > 0 && (
            <ul className="mt-2 divide-y divide-border rounded-lg border-2 border-border">
              {hits.map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(h);
                      setHits([]);
                      setJustAdded(null);
                    }}
                    className="flex w-full items-baseline justify-between px-3 py-2 text-left hover:bg-il-tint"
                  >
                    <span>
                      <span className="font-mono-cli font-bold text-il-navy">
                        {h.ticker}
                      </span>
                      <span className="ml-2 text-base text-muted-foreground">
                        {h.name}
                      </span>
                    </span>
                    <span className="font-mono-cli text-sm text-muted-foreground">
                      {h.exchange}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="mt-3">
          <div className="flex items-center justify-between rounded-lg border-2 border-border bg-il-tint px-3 py-2">
            <span>
              <span className="font-mono-cli font-bold text-il-navy">
                {selected.ticker}
              </span>
              <span className="ml-2 text-base text-muted-foreground">
                {selected.name} · {selected.exchange}
              </span>
            </span>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="font-mono-cli text-sm text-muted-foreground hover:text-il-orange"
            >
              change
            </button>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="qty" className="label-cli">
                quantity *
              </label>
              <input
                id="qty"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                inputMode="decimal"
                placeholder="100"
                className="input-cli"
              />
            </div>
            <div>
              <label htmlFor="price" className="label-cli">
                purchase price ({selected.currency}) — optional
              </label>
              <input
                id="price"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                inputMode="decimal"
                placeholder="leave blank if unknown"
                className="input-cli"
              />
            </div>
            <div>
              <label htmlFor="date" className="label-cli">
                purchase date — optional
              </label>
              <input
                id="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="input-cli"
              />
            </div>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={submit}
              disabled={saving}
              className="btn-cli btn-cli-sm"
            >
              {saving ? "adding…" : "add holding"}
            </button>
            <button
              type="button"
              onClick={() => reset(null)}
              className="font-mono-cli text-sm text-muted-foreground hover:text-il-orange"
            >
              cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <p
          className="mt-3 border-l-2 py-1 pl-3 font-mono-cli text-sm"
          style={{ borderColor: "#EE1D23", color: "#EE1D23" }}
        >
          ~ {error}
        </p>
      )}
      {justAdded && !error && (
        <p className="mt-3 font-mono-cli text-sm" style={{ color: "#22a87b" }}>
          ~ {justAdded} Add another above, or scroll down to see it valued.
        </p>
      )}
    </div>
  );
}

export function DeleteHoldingButton({ holdingId }: { holdingId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      aria-label="remove holding"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await deleteHolding(holdingId);
          router.refresh();
        })
      }
      className="font-mono-cli text-sm text-muted-foreground hover:text-il-orange"
    >
      {pending ? "…" : "remove"}
    </button>
  );
}
