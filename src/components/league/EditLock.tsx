import { createContext, useContext, type ReactNode } from "react";

/**
 * Whether the open season may be edited: false while League is kept live and the season may not
 * be written this moment (`leagueSync.ts`, `editable`). True everywhere else, so a view rendered
 * outside the page, in a test or a harness, edits as it always has.
 */
export const SeasonEditable = createContext(true);

/**
 * The controls in `children`, every one disabled while the season may not be edited. It goes
 * around what edits the season and nothing else: what only reads it (a team's stats, a filter, an
 * export, the season switcher) stays usable offline, which is what a read-only page is for. Laid
 * out as if it were not there, so it can wrap one button in a row of them. What it misses, the
 * season's store refuses with the reason (`seasonStore.ts`, `lock`).
 */
export function EditLock({ children }: { children: ReactNode }) {
  const editable = useContext(SeasonEditable);
  return (
    <fieldset disabled={!editable} className="contents">
      {children}
    </fieldset>
  );
}
