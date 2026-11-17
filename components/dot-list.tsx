import { Children } from "react";

/**
 * Inline facts separated by a middle dot — "Tue 17 Nov edition · filed today
 * · grades the 16 Nov close" — that WRAP cleanly. Written as plain spans with
 * a "·" between them, a line break leaves the dot stranded at the end of one
 * line (or the start of the next). Here each item carries its dot in its own
 * left padding and the row is pulled left by that padding inside a clipping
 * box, so an item that starts a line has its dot clipped away.
 *
 * Server- and client-safe. Falsy children are skipped, so conditional facts
 * can be written inline.
 */
export function DotList({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`overflow-hidden ${className}`}>
      <div className="-ml-5 flex flex-wrap gap-y-0.5">
        {Children.toArray(children).map((child, i) => (
          <span
            key={i}
            className="relative pl-5 before:absolute before:left-0 before:w-5 before:text-center before:content-['·']"
          >
            {child}
          </span>
        ))}
      </div>
    </div>
  );
}
