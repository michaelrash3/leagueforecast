import type { ReactNode } from "react";

/**
 * The icons over the labels of a phone's tab bar (2.4). Each sits beside its label, never in place
 * of it, so it is hidden from a screen reader, which reads the label. Drawn here as plain strokes,
 * since the app has no icon set and five shapes do not need one.
 */
const icon = (children: ReactNode) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    width="22"
    height="22"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
);

const calendar = icon(
  <>
    <rect x="3.5" y="5" width="17" height="15" rx="2" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </>
);

export const NAV_ICONS = {
  dashboard: icon(
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  ),
  games: calendar,
  standings: icon(<path d="M4 6h16M4 12h11M4 18h6" />),
  model: icon(<path d="M3 17l6-6 4 4 8-8M15 7h6v6" />),
  rankings: icon(
    <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM7 6H4a3 3 0 0 0 3 3M17 6h3a3 3 0 0 1-3 3" />
  ),
  import: icon(<path d="M12 4v11M7 10l5 5 5-5M4 20h16" />),
  scouting: icon(
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
  more: icon(
    <>
      <circle cx="5" cy="12" r="1.2" fill="currentColor" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
      <circle cx="19" cy="12" r="1.2" fill="currentColor" />
    </>
  ),
} satisfies Record<string, ReactNode>;
