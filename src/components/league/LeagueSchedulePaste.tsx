/**
 * The league site's schedule, pasted into a season that has no games yet, read on the device and
 * looked over before anything is added: each game with its date, its away and home sides as the
 * paste had them and a Swap where they are the other way round, its score where it had one, and
 * every name matched to the season's teams.
 *
 * Fetched on its own, only once asked for (`App.tsx`): the first download has no room for it, and
 * most visits never paste a schedule. Nothing here is asked of a server; what is added is handed to
 * App, which saves it as one change to the season, the same as Add Game.
 */
import { useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { todayIsoDay } from "../../lib/date";
import { displayName } from "../../lib/format";
import {
  parseLeagueSchedule,
  pasteNameKey,
  pasteSquadYear,
  type LeaguePasteRow,
  type LeagueSchedule,
} from "../../lib/leagueScheduleText";
import {
  matchPastedNames,
  seasonFromPaste,
  type PastedGame,
  type PastedSeason,
} from "../../lib/leaguePaste";
import type { Settings, TeamBase } from "../../lib/types";
import { button, card, pill } from "../../styles/tokens";
import { EditLock, SeasonEditable } from "./EditLock";

const SAMPLE = `Saturday, April 10
9:00 AM  Falcons @ Wolves  Field 1
11:00 AM  Comets vs Rockets  Field 2
4/17  Wolves @ Comets  6-5 Final`;

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/** A row as it is to be added: its sides after any swap, and the runs moved with them. */
const asGame = (row: LeaguePasteRow, swapped: boolean): PastedGame => {
  const runs =
    row.awayRuns !== undefined && row.homeRuns !== undefined
      ? swapped
        ? { awayRuns: row.homeRuns, homeRuns: row.awayRuns }
        : { awayRuns: row.awayRuns, homeRuns: row.homeRuns }
      : {};
  return swapped
    ? { date: row.date, away: row.home, home: row.away, ...runs }
    : { date: row.date, away: row.away, home: row.home, ...runs };
};

export default function LeagueSchedulePaste({
  text,
  teams,
  settings,
  squadYear,
  onApply,
  onClose,
}: {
  /** Text to read at once, from the team-list box; empty to start at the paste box. */
  text: string;
  teams: TeamBase[];
  settings: Settings;
  /** The squad year Team Rankings files this season under, when it is filed (`useScoutBridge`). */
  squadYear?: number | undefined;
  /** Saves the games; false when App refused them, the season having changed or being locked. */
  onApply: (made: PastedSeason) => boolean;
  onClose: () => void;
}) {
  const boxId = useId();
  const editable = useContext(SeasonEditable);
  const today = todayIsoDay();
  const year = pasteSquadYear(squadYear, settings.seasonLabel, today);
  const [draft, setDraft] = useState(text);
  const [read, setRead] = useState<LeagueSchedule | null>(() =>
    text.trim() ? parseLeagueSchedule(text, year, today) : null
  );
  const [swapped, setSwapped] = useState<ReadonlySet<number>>(() => new Set());
  // A person's tick or untick on a row, over what the names would have it be.
  const [ticks, setTicks] = useState<Readonly<Record<number, boolean>>>({});
  // Names whose suggested team a person has said to use.
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(() => new Set());
  const [refused, setRefused] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const reviewRef = useRef<HTMLParagraphElement>(null);
  /*
   * Where focus goes once the panel has drawn what a press changed: into the panel when it opens,
   * the review once a paste is read and the text once it is gone back to. Each press swaps the
   * whole body, and without this a keyboard is left on a button no longer there, which drops focus
   * to the top of the page and tells a screen reader nothing of what opened.
   */
  const focusNext = useRef<"text" | "review" | null>(text.trim() ? "review" : "text");
  useEffect(() => {
    const target = focusNext.current;
    if (target === null) return;
    focusNext.current = null;
    (target === "review" ? (reviewRef.current ?? textRef.current) : textRef.current)?.focus();
  });

  const readText = (value: string) => {
    setRead(parseLeagueSchedule(value, year, today));
    setSwapped(new Set());
    setTicks({});
    setAccepted(new Set());
    setRefused(false);
  };
  // The team-list box's Read as a schedule pressed again with other text: read that instead. Set
  // while drawing rather than in an effect, so the old games are never shown against the new text.
  const [lastText, setLastText] = useState(text);
  if (lastText !== text) {
    setLastText(text);
    setDraft(text);
    readText(text);
  }

  const rows = useMemo(() => read?.rows ?? [], [read]);
  const names = useMemo(() => [...new Set(rows.flatMap((row) => [row.away, row.home]))], [rows]);
  const matches = useMemo(() => matchPastedNames(names, teams), [names, teams]);

  /** The season's team a name is, once matched or its suggestion taken; undefined for a new one. */
  const teamFor = (name: string): string | undefined => {
    const match = matches.get(name);
    if (match?.kind === "team") return match.teamId;
    return match?.kind === "similar" && accepted.has(name) ? match.teamId : undefined;
  };
  const teamName = (id: string) => displayName(teams.find((team) => team.id === id)?.name ?? id);
  const oneTeamTwice = (row: LeaguePasteRow) => {
    const away = teamFor(row.away);
    const home = teamFor(row.home);
    return away !== undefined || home !== undefined
      ? away === home
      : pasteNameKey(row.away) === pasteNameKey(row.home);
  };
  /*
   * A game starts ticked when both its sides are the season's teams, or when the season has none
   * yet and every name is to become one. A name that is not a team here leaves its games unticked:
   * a season's teams are set, and a misspelt one would otherwise come in as a team of its own.
   */
  const ticked = (row: LeaguePasteRow, index: number) =>
    !oneTeamTwice(row) &&
    (ticks[index] ??
      (teams.length === 0 || (teamFor(row.away) !== undefined && teamFor(row.home) !== undefined)));

  const kept = rows.flatMap((row, index) =>
    ticked(row, index) ? [asGame(row, swapped.has(index))] : []
  );
  const similar = names.flatMap((name) => {
    const match = matches.get(name);
    return match?.kind === "similar" ? [{ name, teamId: match.teamId }] : [];
  });
  const unknown = teams.length > 0 ? names.filter((name) => teamFor(name) === undefined) : [];
  const guessed = rows.some((row) => row.guessed);

  const add = () => {
    if (kept.length === 0) return;
    const made = seasonFromPaste(
      kept,
      teams,
      teamFor,
      settings.defaultGameInnings,
      (index) => `game_${Date.now()}_${index}`
    );
    const said = [
      `Added ${plural(kept.length, "game")} from the pasted schedule`,
      made.addedTeams > 0 ? `, with ${plural(made.addedTeams, "new team")}` : "",
      made.finals > 0 ? `; ${plural(made.finals, "has", "have")} a final score` : "",
      ".",
    ].join("");
    if (onApply({ base: teams, teams: made.teams, matchups: made.matchups, logs: made.logs, said }))
      onClose();
    else setRefused(true);
  };

  const nameCell = (name: string, lead?: ReactNode) => {
    const match = matches.get(name);
    // A name taken for a team it is not written as says which, so a coach's name or an age left
    // off is seen before the game goes in.
    const note =
      match?.kind === "similar"
        ? accepted.has(name)
          ? `as ${teamName(match.teamId)}`
          : `close to ${teamName(match.teamId)}`
        : match?.kind === "team" && match.loose
          ? `as ${teamName(match.teamId)}`
          : teams.length > 0 && match?.kind === "new"
            ? "new team"
            : null;
    return (
      <span className="flex min-w-0 flex-col">
        <span className="break-words font-bold text-slate-950 dark:text-slate-100">
          {lead}
          {name}
        </span>
        {note && (
          <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">{note}</span>
        )}
      </span>
    );
  };

  return (
    <section className={`${card} mt-4 p-4 text-left sm:p-5`} aria-labelledby={`${boxId}-title`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id={`${boxId}-title`}
          className="text-base font-black text-slate-950 dark:text-slate-100"
        >
          Paste the league&apos;s schedule
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="text-xs font-bold text-slate-600 hover:underline dark:text-slate-300"
        >
          Close
        </button>
      </div>

      {rows.length === 0 ? (
        <>
          <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">
            Copy the schedule off the league&apos;s website, a spreadsheet or a CSV, and paste it
            here. Every game is shown to look over before anything is added.
          </p>
          {read && (
            <p className="mt-2 text-sm font-semibold text-red-700 dark:text-red-400" role="alert">
              No games could be read from that. Each game needs its two teams, written as
              &quot;Falcons @ Wolves&quot; or &quot;Wolves vs Falcons&quot;, or a table with Home
              and Away columns.
            </p>
          )}
          <label className="sr-only" htmlFor={`${boxId}-text`}>
            League schedule to read
          </label>
          <textarea
            ref={textRef}
            id={`${boxId}-text`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={7}
            spellCheck={false}
            placeholder={SAMPLE}
            className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                focusNext.current = "review";
                readText(draft);
              }}
              className={button.primary}
            >
              Read the schedule
            </button>
          </div>
          <details className="mt-3 text-xs text-slate-600 dark:text-slate-300">
            <summary className="cursor-pointer font-semibold">What can I paste?</summary>
            <p className="mt-1">
              A table with a header naming <code>Home</code> and <code>Away</code> (or{" "}
              <code>Visitor</code>) columns, with a <code>Date</code> and the two scores where it
              has them; or lines like <code>4/10 Falcons @ Wolves</code>, where the team after @ or
              &quot;at&quot; is at home, and <code>Wolves vs Falcons</code>, where the first team
              is. A line that is only a date, or a date and a time, dates the games under it. Times
              and fields are passed over, and a score at the end of a line is read in the order the
              teams were written.
            </p>
          </details>
        </>
      ) : (
        <>
          <p
            ref={reviewRef}
            tabIndex={-1}
            className="mt-1 text-xs font-semibold text-slate-600 focus:outline-hidden dark:text-slate-300"
          >
            {plural(rows.length, "game")} read. Dates with no year are placed between August{" "}
            {year - 1} and July {year}.
          </p>

          {similar.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm text-slate-700 dark:text-slate-200">
              {similar.map(({ name, teamId }) => (
                <li key={name}>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={accepted.has(name)}
                      onChange={(event) =>
                        setAccepted((was) => {
                          const next = new Set(was);
                          if (event.target.checked) next.add(name);
                          else next.delete(name);
                          return next;
                        })
                      }
                    />
                    <span>
                      Read &quot;{name}&quot; as {teamName(teamId)}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {unknown.length > 0 && (
            <p className="mt-2 text-xs font-semibold text-amber-700 dark:text-amber-400">
              Not a team in this season: {unknown.join(", ")}. Their games start unticked; tick one
              to add the team with it.
            </p>
          )}
          {guessed && (
            <p className="mt-2 text-xs font-semibold text-amber-700 dark:text-amber-400">
              Where the paste did not say who was at home, the first team is read as away. Swap any
              that are the other way round.
            </p>
          )}

          {/* On a phone each game is a small block, its date, its two sides one under the other and
            its score and Swap beside them, so every control is on screen: six columns side by side
            put the Swap past the edge of a 390px screen, behind a sideways swipe nothing pointed to.
            From the sm width up it is a table again. */}
          <div className="mt-3 overflow-x-auto">
            <table className="block min-w-full text-sm sm:table">
              <thead className="hidden sm:table-header-group">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                  <th className="py-2 pr-2">Add</th>
                  <th className="pr-3">Date</th>
                  <th className="pr-3">Away</th>
                  <th className="pr-3">Home</th>
                  <th className="pr-3">Score</th>
                  <th>
                    <span className="sr-only">Swap</span>
                  </th>
                </tr>
              </thead>
              <tbody className="block sm:table-row-group">
                {rows.map((row, index) => {
                  const game = asGame(row, swapped.has(index));
                  const twice = oneTeamTwice(row);
                  const label = `${game.away} at ${game.home}`;
                  return (
                    <tr
                      key={index}
                      className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3 border-t border-slate-100 py-2 sm:table-row sm:py-0 dark:border-slate-800"
                    >
                      <td className="row-span-3 row-start-1 pt-0.5 sm:py-2 sm:pr-2">
                        <input
                          type="checkbox"
                          checked={ticked(row, index)}
                          disabled={twice}
                          aria-label={`Add ${label}`}
                          onChange={(event) =>
                            setTicks((was) => ({ ...was, [index]: event.target.checked }))
                          }
                        />
                      </td>
                      <td className="col-start-2 row-start-1 text-xs tabular-nums text-slate-700 sm:pr-3 sm:text-sm dark:text-slate-200">
                        {game.date || "No date"}
                      </td>
                      <td className="col-start-2 row-start-2 min-w-0 sm:pr-3">
                        {nameCell(game.away)}
                      </td>
                      <td className="col-start-2 row-start-3 min-w-0 sm:pr-3">
                        {nameCell(
                          game.home,
                          // On a phone, with no column headings, the home side reads "at Wolves".
                          <span className="font-normal text-slate-500 sm:hidden dark:text-slate-400">
                            at{" "}
                          </span>
                        )}
                        {twice && (
                          <span className="text-xs font-semibold text-red-700 dark:text-red-400">
                            the same team twice
                          </span>
                        )}
                      </td>
                      <td className="col-start-3 row-start-1 text-right tabular-nums text-slate-700 sm:pr-3 sm:text-left dark:text-slate-200">
                        {game.awayRuns !== undefined ? `${game.awayRuns}–${game.homeRuns}` : "—"}
                      </td>
                      <td className="col-start-3 row-span-2 row-start-2 flex flex-col items-end justify-center gap-1 sm:table-cell sm:whitespace-nowrap">
                        {row.guessed && <span className={`${pill("amber")} sm:mr-2`}>Guessed</span>}
                        <button
                          type="button"
                          onClick={() =>
                            setSwapped((was) => {
                              const next = new Set(was);
                              if (next.has(index)) next.delete(index);
                              else next.add(index);
                              return next;
                            })
                          }
                          aria-label={`Swap home and away: ${label}`}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                        >
                          Swap
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {read && read.skipped.length > 0 && (
            <details className="mt-3 text-xs font-semibold text-amber-700 dark:text-amber-400">
              <summary className="cursor-pointer">
                {plural(read.skipped.length, "line")} could not be read and{" "}
                {read.skipped.length === 1 ? "was" : "were"} left out
              </summary>
              <ul className="mt-1 font-mono font-normal">
                {read.skipped.map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ul>
            </details>
          )}

          {refused && (
            <p className="mt-3 text-sm font-semibold text-red-700 dark:text-red-400" role="alert">
              {editable
                ? "Not added: the season changed just now. Look the games over again, then add them."
                : "Not added: this season may not be edited just now."}
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <EditLock>
              <button
                type="button"
                onClick={add}
                disabled={kept.length === 0}
                className={button.primary}
              >
                Add {plural(kept.length, "game")}
              </button>
            </EditLock>
            <button
              type="button"
              onClick={() => {
                focusNext.current = "text";
                setRead(null);
              }}
              className={button.ghost}
            >
              Back to the text
            </button>
          </div>
        </>
      )}
    </section>
  );
}
