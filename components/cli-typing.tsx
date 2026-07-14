"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Animated `~ …` CLI eyebrow — types itself in on scroll, leaving a blinking
 * orange cursor until done. Family signature motif (verbatim from the spec).
 */
export function CliTyping({
  text,
  className = "",
  speed = 35,
}: {
  text: string;
  className?: string;
  speed?: number;
}) {
  const [shown, setShown] = useState("");
  const [done, setDone] = useState(false);
  const [go, setGo] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const o = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && !go) setGo(true);
      },
      { threshold: 0.3 },
    );
    if (ref.current) o.observe(ref.current);
    return () => o.disconnect();
  }, [go]);

  useEffect(() => {
    if (!go) return;
    let i = 0;
    const t = setInterval(() => {
      if (i < text.length) {
        setShown(text.slice(0, i + 1));
        i++;
      } else {
        setDone(true);
        clearInterval(t);
      }
    }, speed);
    return () => clearInterval(t);
  }, [go, text, speed]);

  return (
    <div ref={ref} className={`font-mono-cli ${className}`}>
      <span>{shown}</span>
      {!done && <span className="cursor-blink" />}
    </div>
  );
}
