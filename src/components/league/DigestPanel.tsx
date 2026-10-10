import { useId, useState } from "react";
import { CHANGE_ORDER, countLine, describeChange, type Change } from "../../lib/seasonDigest";
import { button, card, focusRing, textRole } from "../../styles/tokens";

/** How many changes the panel lists before "Show all". */
const SHOWN = 5;

/**
 * "Since you last looked" (2.6): what changed in the season while this device was away, counted
 * and then listed, the team followed first, each a way to the game or team it is about. Gone once
 * a person says they have seen it, and absent while nothing has changed.
 */
export function DigestPanel({
  changes,
  followed,
  nameOf,
  hasGame,
  onOpenGame,
  onOpenTeam,
  onAcknowledge,
}: {
  changes: readonly Change[];
  followed: string | null;
  nameOf: (teamId: string) => string;
  /** Whether a game is still on the schedule, to be opened. */
  hasGame: (gameId: string) => boolean;
  onOpenGame: (gameId: string) => void;
  onOpenTeam: (teamId: string) => void;
  onAcknowledge: () => void;
}) {
  const [all, setAll] = useState(false);
  const titleId = useId();
  if (changes.length === 0) return null;
  const rank = (change: Change) =>
    (followed !== null && change.teamIds.includes(followed) ? 0 : 100) +
    CHANGE_ORDER.indexOf(change.kind);
  const ordered = [...changes].sort((a, b) => rank(a) - rank(b));
  const shown = all ? ordered : ordered.slice(0, SHOWN);
  return (
    <section className={`${card} p-5`} aria-labelledby={titleId}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={titleId} className={textRole.sectionTitle}>
            Since you last looked
          </h2>
          <p className={`mt-1 ${textRole.pageLead}`}>{countLine(changes)}.</p>
        </div>
        <button type="button" className={button.ghost} onClick={onAcknowledge}>
          Got it
        </button>
      </div>
      <ul className="mt-4 space-y-2">
        {shown.map((change, at) => {
          const text = describeChange(change, nameOf);
          const target =
            "gameId" in change && hasGame(change.gameId)
              ? () => onOpenGame(change.gameId)
              : change.kind !== "teamRemoved" && !("gameId" in change)
                ? () => onOpenTeam(change.teamId)
                : null;
          return (
            <li key={`${change.kind}-${at}`} className={textRole.body}>
              {target ? (
                <button
                  type="button"
                  onClick={target}
                  className={`text-left font-semibold underline decoration-slate-300 underline-offset-2 hover:decoration-slate-700 dark:decoration-slate-600 dark:hover:decoration-slate-300 ${focusRing}`}
                >
                  {text}
                </button>
              ) : (
                text
              )}
            </li>
          );
        })}
      </ul>
      {ordered.length > SHOWN && (
        <button
          type="button"
          className={`mt-3 text-sm font-bold text-slate-700 underline dark:text-slate-200 ${focusRing}`}
          onClick={() => setAll((was) => !was)}
          aria-expanded={all}
        >
          {all ? "Show fewer" : `Show all ${ordered.length}`}
        </button>
      )}
    </section>
  );
}
