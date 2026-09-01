"use client";

import {
  useActionState,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  loadReactionUniverse,
  requestDropAnalysis,
  type DropAnalysisState,
} from "@/app/(app)/dashboard/actions";
import {
  rankSecurityMatches,
  type SearchableSecurity,
} from "@/lib/reaction/ticker-search";

const INITIAL: DropAnalysisState = { status: "idle", message: "" };
const MAX_OPTIONS = 8;

interface ListRect {
  top: number;
  left: number;
  width: number;
}

/**
 * The hero interaction on the Reaction band: name a ticker, get it screened
 * now. The input is a live search over the Reaction universe — the whole
 * list (~850 names) is fetched ONCE on first focus and ranked in the browser
 * on every keystroke (lib/reaction/ticker-search.ts), so "voda" offers
 * Vodafone instantly instead of a round-trip per character. Picking an
 * option submits the security's id; free-typed tickers still work.
 *
 * The list renders through a portal, positioned from the input's rect: the
 * band is a .card-cli-module whose overflow:hidden (it clips the module-colour
 * stripe to the rounded corners) would otherwise cut the list off at the
 * card's edge.
 *
 * Runs are queued (Inngest), so the message sets the "report files in
 * minutes" expectation rather than pretending to be instant.
 */
export function ReactionAnalyseForm() {
  const [state, formAction, pending] = useActionState(
    requestDropAnalysis,
    INITIAL,
  );

  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [universe, setUniverse] = useState<SearchableSecurity[] | null>(null);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "failed">(
    "idle",
  );
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<SearchableSecurity | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState<ListRect | null>(null);
  // Portals need a document; the shell still server-renders, and the list is
  // closed there anyway.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Fetch the universe the first time the box is focused — never on page load.
  async function ensureUniverse() {
    if (universe || loadState === "loading") return;
    setLoadState("loading");
    const res = await loadReactionUniverse();
    if (res.ok) {
      setUniverse(res.data);
      setLoadState("idle");
    } else {
      // Fail soft: the box still submits free text, exactly as before.
      setLoadState("failed");
    }
  }

  const showList = open && !selected && query.trim().length > 0;
  const options =
    showList && universe ? rankSecurityMatches(query, universe, MAX_OPTIONS) : [];

  useLayoutEffect(() => {
    if (!showList) return;
    const measure = () => {
      const r = inputRef.current?.getBoundingClientRect();
      if (r) setRect({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [showList]);

  function onInput(next: string) {
    setQuery(next);
    // Editing after a pick means the pick no longer describes the input.
    setSelected(null);
    setActive(0);
    setOpen(true);
  }

  function pick(s: SearchableSecurity) {
    setSelected(s);
    setQuery(s.ticker);
    setOpen(false);
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showList || options.length === 0) {
      if (e.key === "Escape") setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % options.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + options.length) % options.length);
    } else if (e.key === "Enter") {
      // Enter picks the highlighted name; the form submits on the next Enter
      // (or the button), so a pick is never an accidental run.
      e.preventDefault();
      pick(options[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const list = (
    <div
      className="z-50 overflow-hidden rounded-lg border-2 border-border bg-white shadow-sm"
      style={{
        position: "fixed",
        top: rect?.top ?? 0,
        left: rect?.left ?? 0,
        width: rect?.width ?? 0,
      }}
      role="presentation"
    >
      {loadState === "loading" && !universe && (
        <div className="px-3 py-2 font-mono-cli text-sm text-muted-foreground">
          ~ loading names…
        </div>
      )}
      {loadState === "failed" && (
        <div className="px-3 py-2 font-mono-cli text-sm text-muted-foreground">
          ~ name list unavailable — type the ticker and press analyse
        </div>
      )}
      {universe && options.length === 0 && (
        <div className="px-3 py-2 text-sm text-muted-foreground">
          No match in the Reaction universe (S&amp;P 500 + FTSE 350).
        </div>
      )}
      {options.length > 0 && (
        <ul id={listId} role="listbox" aria-label="Matching names">
          {options.map((s, i) => (
            <li
              key={s.id}
              id={`${listId}-${s.id}`}
              role="option"
              aria-selected={i === active}
              className={`flex cursor-pointer items-baseline gap-3 px-3 py-2 ${
                i === active ? "bg-il-tint" : ""
              }`}
              onMouseEnter={() => setActive(i)}
              // mousedown, not click: it fires before the input's blur.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(s);
              }}
            >
              <span className="w-16 shrink-0 font-mono-cli text-sm font-bold text-il-navy">
                {s.ticker}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                {s.name ?? "—"}
              </span>
              <span className="shrink-0 font-mono-cli text-sm text-muted-foreground">
                {s.exchange}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <div>
      <div className="font-mono-cli text-base text-il-navy">~ analyse a drop</div>
      <p className="mt-2 text-base leading-relaxed text-muted-foreground">
        Name a ticker and the desk screens it now. A qualifying fall gets the
        full treatment — news researched, damage graded, verdict filed with
        every source cited.
      </p>
      <form action={formAction} className="mt-3 flex gap-2">
        <div className="min-w-0 flex-1">
          <input
            ref={inputRef}
            name="ticker"
            className="input-cli w-full"
            placeholder="e.g. NVDA, NXT.L or Vodafone"
            maxLength={40}
            required
            autoComplete="off"
            aria-label="Ticker or company name to analyse"
            role="combobox"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              showList && options[active]
                ? `${listId}-${options[active].id}`
                : undefined
            }
            value={query}
            disabled={pending}
            onFocus={() => {
              void ensureUniverse();
              setOpen(true);
            }}
            onBlur={() => {
              // Let a click on an option land before the list goes away.
              setTimeout(() => setOpen(false), 120);
            }}
            onChange={(e) => onInput(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {/* The pick travels as the security's id — the action re-checks it
              against the universe, so this is convenience, not trust. */}
          <input type="hidden" name="securityId" value={selected?.id ?? ""} />
          {showList && mounted && rect && createPortal(list, document.body)}
        </div>
        <button type="submit" className="btn-cli" disabled={pending}>
          {pending ? "queuing…" : "analyse"}
        </button>
      </form>
      {state.status !== "idle" && (
        <p
          className="mt-2 font-mono-cli text-sm"
          style={{ color: state.status === "error" ? "#ee1d23" : undefined }}
          role="status"
        >
          {state.message}
          {state.reportId && (
            <>
              {" "}
              <Link
                href={`/reports/${state.reportId}`}
                className="text-il-accent"
              >
                open report →
              </Link>
            </>
          )}
        </p>
      )}
      <p className="mt-3 font-mono-cli text-sm text-muted-foreground">
        ~ screens the latest closes — a fall happening mid-session files after
        tonight&apos;s close
      </p>
    </div>
  );
}
