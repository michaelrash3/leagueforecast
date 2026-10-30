import { useEffect, useState } from "react";

/*
 * The pieces "Since you last looked" is told with, in League Standings' card and on Team Rankings'
 * My Team card alike: a number that runs from then to now, the arrow of a move, and how long ago.
 */

/** Whether to show a number's end at once: motion unwanted, or no frames to run it in. */
const still = () =>
  typeof window.matchMedia !== "function" ||
  typeof requestAnimationFrame !== "function" ||
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A number that runs from `from` to `to` once, or simply shows `to` where motion is unwanted. */
export function CountUp({ from, to, suffix = "" }: { from: number; to: number; suffix?: string }) {
  const [noMotion] = useState(still);
  const [value, setValue] = useState(from);
  useEffect(() => {
    if (noMotion) return;
    const start = performance.now();
    let frame = 0;
    const step = (time: number) => {
      const t = Math.min(1, (time - start) / 800);
      setValue(Math.round(from + (to - from) * (1 - (1 - t) ** 3)));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [from, to, noMotion]);
  return (
    <span className="tabular-nums">
      {noMotion ? to : value}
      {suffix}
    </span>
  );
}

/** The arrow and the size of a move: up for `better`, whichever way the number went. */
export function Move({ by, better }: { by: number; better: boolean }) {
  if (by === 0) return <span className="text-slate-600 dark:text-slate-300">no change</span>;
  return (
    <span
      className={`font-black ${better ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}`}
    >
      {better ? "▲" : "▼"}
      {Math.abs(by)}
    </span>
  );
}

/** "3 hours ago", "yesterday", "4 days ago": how long since a look was kept. */
export function Ago({ since }: { since: number }) {
  const [now] = useState(() => Date.now());
  const hours = Math.round((now - since) / 3_600_000);
  if (hours < 24) return <>{`${hours} hour${hours === 1 ? "" : "s"} ago`}</>;
  const days = Math.round(hours / 24);
  return <>{days === 1 ? "yesterday" : `${days} days ago`}</>;
}
