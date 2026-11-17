"use client";

import Link, { useLinkStatus } from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { DotList } from "@/components/dot-list";
import { Skeleton } from "@/components/skeleton";
import { formatEditionDate, formatMonthLabel } from "@/lib/format";
import {
  EMPTY_INDEX,
  OVERSHOOT_BINS,
  calendarWeeks,
  deskOfReport,
  editionFindings,
  latestEdition,
  locateEdition,
  monthKey,
  overshootLevel,
  shiftMonth,
  type Edition,
  type EditionIndex,
} from "@/lib/reports/editions";

/**
 * The edition navigator: step to the previous / next edition, or pick a date
 * from a month calendar.
 *
 * It lives in the reports LAYOUT, not in the edition, so it stays mounted
 * while the edition beneath it swaps: keyboard focus, the month you paged to,
 * and quick ‹ ‹ ‹ stepping all survive a navigation. (The same reason the app
 * nav lives in the shell.) Which edition is open comes from the route.
 *
 * Two arrangements of one component:
 *  - xl and up: a sticky right rail with the calendar always visible — the
 *    page column is 56rem, so this uses margin that was empty.
 *  - below xl: a bar above the edition; the date discloses the same calendar
 *    INLINE (it pushes the edition down). Not a floating popover: nothing to
 *    position or clip, no outside-click handling, and on a phone the edition
 *    stays the first thing on the page.
 *
 * A disclosure of links, deliberately — not a dialog and not an ARIA grid.
 * The days are navigation, so they are a real <table> of <a>; a grid role
 * would promise the full date-picker keyboard model for what is a set of
 * links. Nothing here calls `toLocale*` or reads the clock during render, so
 * the server and the browser draw the same thing (see `useToday`).
 */

const NAVY = "#034566";
/** Reaction's module accent — glyph-scale only, per the family spec. */
const DOT = "#E2282C";
/** Navy outline (3:1 against white) with a cyan halo; cyan alone is ~2.4:1. */
const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#034566] focus-visible:ring-4 focus-visible:ring-[#00b5e2]/30";
const BOX = "rounded-lg border-2 border-border bg-white";
const WEEKDAYS: [string, string][] = [
  ["Mo", "Monday"],
  ["Tu", "Tuesday"],
  ["We", "Wednesday"],
  ["Th", "Thursday"],
  ["Fr", "Friday"],
  ["Sa", "Saturday"],
  ["Su", "Sunday"],
];
const MAX_ON_DEMAND = 6;

export function EditionNav({
  indexes,
  primaryDesk,
}: {
  indexes: Record<string, EditionIndex>;
  primaryDesk: string | null;
}) {
  const params = useParams<{ id?: string }>();
  const reportId = params?.id ?? null;
  const routeKey = reportId ?? "latest";

  const desk = deskOfReport(indexes, reportId, primaryDesk);
  const index = (desk && indexes[desk]) || EMPTY_INDEX;
  const loc = useMemo(() => locateEdition(index, reportId), [index, reportId]);
  const latest = latestEdition(index);
  const byDate = useMemo(
    () => new Map(index.editions.map((e) => [e.date, e])),
    [index.editions],
  );

  // Open state and the paged month are both keyed on the edition they were
  // set for, so arriving on another edition closes the calendar and re-centres
  // it on that edition's month by derivation — no effect, no flash.
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [paged, setPaged] = useState<{ for: string; month: string } | null>(null);
  const [hovered, setHovered] = useState<Edition | null>(null);
  const today = useToday();
  const panelId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const openedOn = useRef<string | null>(null);

  // The day link that was just followed is hidden with the calendar, so focus
  // would fall to <body>. Hand it to the date button instead.
  useEffect(() => {
    if (openedOn.current && openedOn.current !== routeKey) {
      openedOn.current = null;
      toggleRef.current?.focus({ preventScroll: true });
    }
  }, [routeKey]);

  if (!latest) return null;

  const open = openFor === routeKey;
  const anchorDate =
    loc?.kind === "edition" ? loc.edition.date : loc?.kind === "extra" ? loc.extra.date : latest.date;
  const month = paged?.for === routeKey ? paged.month : monthKey(anchorDate);
  const firstMonth = monthKey(index.editions[0].date);
  const lastMonth = monthKey(latest.date);
  const [year, monthNumber] = month.split("-").map(Number);
  const weeks = calendarWeeks(year, monthNumber);

  const hrefOf = (e: Edition) => (e.id === latest.id ? "/reports" : `/reports/${e.id}`);
  const current = loc?.kind === "edition" ? loc.edition : null;
  const prev = loc ? loc.prev : null;
  const next = loc ? loc.next : null;
  const isLatest = loc?.kind === "edition" && loc.isLatest;
  const previewed = hovered ?? current;

  const setOpen = (value: boolean) => {
    openedOn.current = value ? routeKey : null;
    setOpenFor(value ? routeKey : null);
  };

  const dateLabel = formatEditionDate(anchorDate);
  const tag = isLatest
    ? "latest"
    : loc?.kind === "extra"
      ? loc.extra.kind === "on_demand"
        ? "on demand"
        : "earlier run"
      : null;
  const onDemand = index.extras.filter((e) => e.kind === "on_demand");

  return (
    <nav
      aria-label="Editions"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          setOpen(false);
          toggleRef.current?.focus();
        }
      }}
    >
      {/* Stepper: previous · which edition · next */}
      <div className="flex items-stretch gap-2">
        <Step
          dir="prev"
          target={prev}
          href={prev ? hrefOf(prev) : null}
          none="This is the first edition on file"
        />

        {/* Below xl the date is the calendar's disclosure button… */}
        <button
          ref={toggleRef}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen(!open)}
          className={`${BOX} ${FOCUS} flex min-h-11 min-w-0 flex-1 cursor-pointer items-center justify-center gap-2 px-3 font-mono-cli text-base text-il-navy hover:text-il-orange xl:hidden`}
        >
          <CalendarIcon />
          {/* No year on a phone: with the tag and icons it truncated to
              "Tue 17 Nov 2…". The edition's own line carries the full date. */}
          <span className="truncate">
            {loc ? (
              <>
                <span className="sm:hidden">{formatEditionDate(anchorDate, { year: false })}</span>
                <span className="hidden sm:inline">{dateLabel}</span>
              </>
            ) : (
              "choose an edition"
            )}
          </span>
          {tag && <Tag>{tag}</Tag>}
          <span className="sr-only">{open ? ", hide calendar" : ", show calendar"}</span>
          <Chevron dir={open ? "up" : "down"} />
        </button>
        {/* …at xl the calendar is always on show, so it is just the date. */}
        <div
          className={`${BOX} hidden min-h-11 min-w-0 flex-1 flex-col items-center justify-center px-2 py-1 text-center font-mono-cli text-il-navy xl:flex`}
        >
          <span className="text-base">{loc ? dateLabel : "—"}</span>
          {tag && <span className="text-sm text-muted-foreground">{tag === "latest" ? "latest edition" : tag}</span>}
        </div>

        <Step
          dir="next"
          target={next}
          href={next ? hrefOf(next) : null}
          none={isLatest ? "This is the latest edition" : "No later edition"}
        />
      </div>

      {/* Orientation: an older edition, an on-demand run, or an unknown id
          must never read as today's edition. Silent on the latest. */}
      <Orientation loc={loc} latest={latest} hrefOf={hrefOf} />

      {/* Calendar */}
      <div id={panelId} className={`${open ? "block" : "hidden"} mt-3 xl:block`}>
        <div className={`${BOX} p-3 sm:grid sm:grid-cols-[21rem_minmax(0,1fr)] sm:gap-x-6 xl:block`}>
          <div>
            <div className="flex items-center justify-between">
              <MonthButton
                dir="prev"
                disabled={month <= firstMonth}
                onClick={() => setPaged({ for: routeKey, month: shiftMonth(month, -1) })}
              />
              <div aria-live="polite" className="font-mono-cli text-base text-il-navy">
                {formatMonthLabel(month)}
              </div>
              <MonthButton
                dir="next"
                disabled={month >= lastMonth}
                onClick={() => setPaged({ for: routeKey, month: shiftMonth(month, 1) })}
              />
            </div>

            <table className="mt-1 w-full table-fixed border-separate border-spacing-0.5">
              <caption className="sr-only">
                Editions filed in {formatMonthLabel(month)}. Days with an edition are links.
              </caption>
              <thead>
                <tr>
                  {WEEKDAYS.map(([short, long]) => (
                    <th
                      key={short}
                      scope="col"
                      className="pb-1 font-mono-cli text-sm font-normal text-muted-foreground"
                    >
                      <abbr title={long} className="no-underline">
                        {short}
                      </abbr>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weeks.map((week, w) => (
                  <tr key={w}>
                    {week.map((date, d) => {
                      const edition = date ? byDate.get(date) : undefined;
                      const isToday = date !== null && date === today;
                      return (
                        <td key={d} className="p-0 text-center">
                          {date === null ? null : edition ? (
                            <DayLink
                              edition={edition}
                              href={hrefOf(edition)}
                              current={edition.id === current?.id}
                              today={isToday}
                              onPreview={setHovered}
                            />
                          ) : (
                            // No edition: inert text, not a dead link.
                            <span
                              className={`flex h-11 items-center justify-center rounded border font-mono-cli text-sm text-muted-foreground/70 ${
                                isToday ? "border-dashed border-[#034566]/60" : "border-transparent"
                              }`}
                            >
                              {Number(date.slice(8, 10))}
                              {isToday && <span className="sr-only"> (today, no edition)</span>}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 space-y-3 border-t border-border pt-3 sm:mt-0 sm:border-t-0 sm:pt-1 xl:mt-3 xl:border-t xl:pt-3">
            {/* What the pointed-at day found. Mouse/keyboard only: on touch
                there is no hover, so it would only restate the open edition.
                aria-hidden because each day link already carries this text. */}
            {previewed && (
              <p
                aria-hidden
                className="hidden min-h-[3.75rem] text-sm leading-snug text-muted-foreground pointer-fine:block"
              >
                <span className="font-mono-cli text-il-navy">
                  {formatEditionDate(previewed.date, { year: false })}
                </span>{" "}
                · {editionFindings(previewed)}
              </p>
            )}

            <div className="space-y-1.5 text-sm leading-snug text-muted-foreground">
              <div>
                <div>Dots: overshoots flagged</div>
                <div className="mt-0.5 flex items-center gap-x-4">
                  <KeyDots level={1} label={`${OVERSHOOT_BINS.one}–${OVERSHOOT_BINS.two - 1}`} />
                  <KeyDots level={2} label={`${OVERSHOOT_BINS.two}–${OVERSHOOT_BINS.three - 1}`} />
                  <KeyDots level={3} label={`${OVERSHOOT_BINS.three}+`} />
                </div>
              </div>
              <p>
                Each edition grades the previous session&apos;s close: Friday&apos;s falls
                are in Saturday&apos;s.
              </p>
              <p>No edition: no session, a market holiday, or a run that didn&apos;t complete.</p>
            </div>

            {/* On-demand analyses file a report too. They are not editions, so
                they are not on the calendar — this is where they live. */}
            {onDemand.length > 0 && (
              <div>
                <div className="font-mono-cli text-sm text-il-navy">~ on-demand analyses</div>
                <ul className="mt-1">
                  {onDemand.slice(0, MAX_ON_DEMAND).map((x) => (
                    <li key={x.id}>
                      <Link
                        href={`/reports/${x.id}`}
                        prefetch={false}
                        aria-current={x.id === reportId ? "page" : undefined}
                        className={`${FOCUS} flex min-h-8 items-baseline gap-2 rounded text-sm hover:text-il-orange ${
                          x.id === reportId ? "font-bold text-il-navy" : "text-muted-foreground"
                        }`}
                      >
                        <span className="font-mono-cli text-il-navy">{x.tickers.join(", ")}</span>
                        <span>
                          {formatEditionDate(x.date, { year: false })}, {x.time}
                        </span>
                        <Pending />
                      </Link>
                    </li>
                  ))}
                </ul>
                {onDemand.length > MAX_ON_DEMAND && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {onDemand.length - MAX_ON_DEMAND} earlier — open one from its name&apos;s
                    page.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}

/**
 * The reader's local date, known only after hydration. The server renders in
 * UTC and can't know it, so it is null there and on the first client render —
 * marking "today" during render would be a hydration mismatch for anyone not
 * on UTC.
 */
function useToday(): string | null {
  return useSyncExternalStore(
    subscribeNever,
    () => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    },
    () => null,
  );
}
const subscribeNever = () => () => {};

function Orientation({
  loc,
  latest,
  hrefOf,
}: {
  loc: ReturnType<typeof locateEdition>;
  latest: Edition;
  hrefOf: (e: Edition) => string;
}) {
  if (loc?.kind === "edition" && loc.isLatest) return null;
  const toLatest = (
    <Link href="/reports" className={`${FOCUS} rounded text-il-navy underline-offset-4 hover:text-il-orange hover:underline`}>
      latest: {formatEditionDate(latest.date, { year: false })} →
    </Link>
  );
  let lead: React.ReactNode;
  if (!loc) {
    lead = "this report isn't in the edition index";
  } else if (loc.kind === "edition") {
    lead = "you're reading an earlier edition";
  } else if (loc.extra.kind === "on_demand") {
    lead = `on-demand analysis of ${loc.extra.tickers.join(", ")}, not a daily edition`;
  } else {
    lead = "an earlier run from this date";
  }
  const day = loc?.kind === "extra" ? loc.dayEdition : null;
  return (
    <DotList className="mt-2 font-mono-cli text-sm text-muted-foreground">
      <span>~ {lead}</span>
      {day && (
        <Link href={hrefOf(day)} className={`${FOCUS} rounded text-il-navy underline-offset-4 hover:text-il-orange hover:underline`}>
          that day&apos;s edition →
        </Link>
      )}
      {toLatest}
    </DotList>
  );
}

function Step({
  dir,
  target,
  href,
  none,
}: {
  dir: "prev" | "next";
  target: Edition | null;
  href: string | null;
  /** Why there is nowhere to step to — the disabled control's name. */
  none: string;
}) {
  const shape = `${BOX} flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 px-2.5 font-mono-cli text-sm`;
  if (!target || !href) {
    return (
      <span aria-disabled="true" role="link" aria-label={none} title={none} className={`${shape} text-muted-foreground/40`}>
        <Chevron dir={dir === "prev" ? "left" : "right"} />
      </span>
    );
  }
  const label = formatEditionDate(target.date, { year: false });
  const name = `${dir === "prev" ? "Previous" : "Next"} edition: ${formatEditionDate(target.date, { long: true })}`;
  return (
    // Default prefetch on these two: stepping is the commonest move, and a
    // prefetched neighbour paints its skeleton on the click.
    <Link href={href} aria-label={name} title={name} className={`${shape} ${FOCUS} text-il-navy hover:text-il-orange`}>
      {dir === "prev" && <Chevron dir="left" />}
      <span className="hidden whitespace-nowrap sm:inline xl:hidden">{label}</span>
      {dir === "next" && <Chevron dir="right" />}
      <Pending />
    </Link>
  );
}

function MonthButton({
  dir,
  disabled,
  onClick,
}: {
  dir: "prev" | "next";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === "prev" ? "Previous month" : "Next month"}
      className={`${FOCUS} flex h-11 w-11 items-center justify-center rounded text-il-navy enabled:cursor-pointer enabled:hover:text-il-orange disabled:text-muted-foreground/40`}
    >
      <Chevron dir={dir === "prev" ? "left" : "right"} />
    </button>
  );
}

function DayLink({
  edition,
  href,
  current,
  today,
  onPreview,
}: {
  edition: Edition;
  href: string;
  current: boolean;
  today: boolean;
  onPreview: (e: Edition | null) => void;
}) {
  const level = overshootLevel(edition.overshoots);
  return (
    <Link
      href={href}
      // ~20 days a month: don't render 20 reports the reader may never open.
      prefetch={false}
      aria-current={current ? "page" : undefined}
      aria-label={`${formatEditionDate(edition.date, { long: true })}${today ? " (today)" : ""}: ${editionFindings(edition)}`}
      onMouseEnter={() => onPreview(edition)}
      onMouseLeave={() => onPreview(null)}
      onFocus={() => onPreview(edition)}
      onBlur={() => onPreview(null)}
      className={`${FOCUS} flex h-11 flex-col items-center justify-center gap-1 rounded border font-mono-cli text-sm font-bold ${
        current
          ? "border-[#034566] bg-[#034566] text-white"
          : `text-il-navy hover:bg-il-tint hover:text-il-orange ${
              today ? "border-dashed border-[#034566]" : "border-transparent"
            }`
      }`}
    >
      <DayNumber day={Number(edition.date.slice(8, 10))} />
      <Dots level={level} color={current ? "#ffffff" : DOT} />
    </Link>
  );
}

/** The day's number; pulses while that edition is loading. */
function DayNumber({ day }: { day: number }) {
  const { pending } = useLinkStatus();
  return <span className={pending ? "motion-safe:animate-pulse" : undefined}>{day}</span>;
}

/** Trailing "…" while a link's navigation is in flight (as in the app nav). */
function Pending() {
  const { pending } = useLinkStatus();
  return pending ? (
    <span aria-hidden className="font-mono-cli text-il-orange motion-safe:animate-pulse">
      …
    </span>
  ) : null;
}

/** 0–3 dots; an empty row keeps its height so day numbers stay aligned. */
function Dots({ level, color }: { level: 0 | 1 | 2 | 3; color: string }) {
  return (
    <span aria-hidden className="flex h-1 items-center gap-0.5">
      {Array.from({ length: level }).map((_, i) => (
        <span key={i} className="h-1 w-1 rounded-full" style={{ backgroundColor: color }} />
      ))}
    </span>
  );
}

function KeyDots({ level, label }: { level: 1 | 2 | 3; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <Dots level={level} color={DOT} />
      <span className="font-mono-cli">{label}</span>
    </span>
  );
}

/**
 * Hidden on the narrowest phones, where it squeezed the date itself down to
 * "Tue…". The date matters more; the orientation line says the rest.
 */
function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="hidden shrink-0 rounded-full min-[380px]:inline-block border border-border bg-il-tint px-2 py-0.5 text-sm text-muted-foreground">
      {children}
    </span>
  );
}

// Inline SVG, not ▦ / ▾ / ‹ glyphs: those fall outside the font's latin
// subset and would render in whatever fallback the device has.
function Chevron({ dir }: { dir: "left" | "right" | "up" | "down" }) {
  const d = {
    left: "M10 3 5 8l5 5",
    right: "m6 3 5 5-5 5",
    up: "m3 10 5-5 5 5",
    down: "m3 6 5 5 5-5",
  }[dir];
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" className="shrink-0">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" className="shrink-0">
      <g fill="none" stroke={NAVY} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="12" height="11" rx="1.5" />
        <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" />
      </g>
    </svg>
  );
}

/** The navigator's footprint while the edition index loads. Bars only. */
export function EditionNavSkeleton() {
  return (
    <div aria-hidden>
      <div className="flex gap-2">
        <Skeleton className="h-11 w-11 shrink-0" />
        <Skeleton className="h-11 flex-1" />
        <Skeleton className="h-11 w-11 shrink-0" />
      </div>
      <Skeleton className="mt-3 hidden h-[26rem] w-full xl:block" />
    </div>
  );
}
