import { useEffect, useMemo, useRef, useState } from "react";
import { teamNameKey, type ScoutTeam } from "../lib/teamRankings";
import {
  type NamedCheck,
  type NamedGame,
  type NameNote as Note,
} from "../lib/teamRankings/namedGames";
import { parseScheduleText, type ParsedGameRow } from "../lib/scheduleText";
import { TeamNameCombobox } from "./TeamNameCombobox";
import type { ToastTone } from "../hooks/useToast";
import { button, card, pill } from "../styles/tokens";

/**
 * How the rows are checked against the roster and the age group's games (`checkNamedGames`): here,
 * against the roster this device holds, as they are typed; or asked of the server, which holds the
 * cloud's (1.6), a row at a time as it changes, the answer null where none came.
 */
export type NamedChecker =
  | { kind: "here"; check: (named: readonly NamedGame[]) => NamedCheck[] }
  | {
      kind: "asked";
      check: (named: readonly NamedGame[]) => Promise<readonly NamedCheck[] | null>;
    };

type ScheduleImportPanelProps = {
  ageGroupName: string;
  /** The teams this age group already knows — what the subject-name dropdown offers. */
  suggestedTeams: ScoutTeam[];
  /** Which names are worth a second look, and which rows the age group already has. */
  checker: NamedChecker;
  /** Pre-fills whose schedule this is, when rows name only the opponent; the "my team" name. */
  defaultSubjectTeam: string;
  /**
   * The rows to add, by their clubs' names, which whoever adds them resolves to clubs. Where the
   * adding is the server's, a promise of whether they were added: Add waits on it, so a second
   * press cannot add them twice, and rows not added are checked again before another.
   */
  onImport: (games: NamedGame[]) => void | Promise<boolean>;
  /**
   * The most rows one add takes, where whoever adds them takes no more at once (the server's
   * `NAMED_GAMES_MAX`): a longer list is turned away as it is read, to be pasted in parts, rather
   * than looked over row by row and then refused.
   */
  rowsMax?: number;
  onClose: () => void;
  showToast: (message: string, options?: { tone?: ToastTone }) => void;
};

type ReviewRow = {
  key: string;
  include: boolean;
  date: string;
  /**
   * `null` means "whoever the subject team is" — a schedule names only the opponent, so its rows
   * borrow the subject until it is known. A game list names both sides and fills this in outright.
   */
  teamA: string | null;
  teamB: string;
  scoreA: string;
  scoreB: string;
  /** Two-letter states from the file, applied to the teams on save. Not editable here. */
  stateA?: string;
  stateB?: string;
};

type Stage = "picking" | "review";

const SAMPLE_PASTE = `Date,Opponent,Us,Them
2026-08-22,Velocirabbits,6,5
2026-08-23,NV Stars,3,10
2026-09-05,Bourbon Bandits,,`;

const inputClass =
  "rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm dark:border-slate-800 dark:bg-slate-900";

const isValidScorePair = (a: string, b: string) => {
  const bothBlank = a.trim() === "" && b.trim() === "";
  if (bothBlank) return true;
  if (a.trim() === "" || b.trim() === "") return false;
  return (
    Number.isFinite(Number(a)) && Number(a) >= 0 && Number.isFinite(Number(b)) && Number(b) >= 0
  );
};

/**
 * A one-line flag under a name in the review table: a placeholder that names nobody, or a team
 * this age group probably already has under a slightly different spelling. The suggestion is a
 * button rather than an automatic correction, because two real teams can be one character apart.
 */
function NameNote({ note, onUse }: { note: Note | undefined; onUse: (name: string) => void }) {
  if (!note) return null;
  if (note.kind === "placeholder") {
    return (
      <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-500">
        Placeholder — set the real team before adding
      </span>
    );
  }
  return (
    <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-500">
      Close to{" "}
      <button
        type="button"
        onClick={() => onUse(note.to)}
        className="underline decoration-dotted underline-offset-2 hover:decoration-solid"
        title="Use this name instead"
      >
        {note.to}
      </button>
    </span>
  );
}

/** How long a row stays as typed before the server is asked about it. */
const ASK_AFTER_MS = 400;

/**
 * The most rows one question asks about. Each name is looked for among the cloud's nationwide
 * roster, 6.7 ms a name on the 29 September 2026 one, so a hundred rows are a second and a half of
 * the edit function, which every member's edits wait behind; a long schedule is asked in turns.
 */
const ASK_ROWS = 100;

/** The longest name the server reads (`coerceNamedGame`). */
const NAME_MAX = 200;
const nameOk = (name: string): boolean => name.trim() !== "" && name.length <= NAME_MAX;
const dateOk = (date: string): boolean => date === "" || /^\d{4}-\d{2}-\d{2}$/.test(date);

/**
 * Only a row the server can read is asked about (`coerceNamedGame`): one still waiting on a name,
 * or with one too long or a date that is not a day, is not a game yet, and one such row would
 * have the whole question refused.
 */
const askable = (game: NamedGame): boolean =>
  nameOk(game.teamA) && nameOk(game.teamB) && dateOk(game.date ?? "");

/**
 * The checks made here, by checker and by what each reads of a row (`checkKeyOf`): a row typed
 * into is checked again alone, rather than every row of the list at each keystroke, which on a
 * nationwide roster is most of a second a row. A new checker (another roster, another page) has
 * a cache of its own.
 */
const checkedHereBy = new WeakMap<object, Map<string, NamedCheck>>();

/** What a row's check is found by: what the check reads of it, and nothing it does not. */
const checkKeyOf = (game: NamedGame): string =>
  JSON.stringify([
    game.teamA,
    game.teamB,
    game.teamAScore ?? null,
    game.teamBScore ?? null,
    game.date ?? "",
  ]);

/**
 * Import games in bulk from pasted text or a CSV, then review every row before anything is saved.
 * The review step is the point: a wrong score would quietly skew the ratings, so nothing is
 * committed until it has been looked at, and anything matching a game already in this age group
 * arrives unchecked.
 *
 * The reading happens on the device — no key, nothing to run out. The checks of each row are made
 * here against the roster the device holds, or asked of the server where the cloud holds it.
 */
export function ScheduleImportPanel({
  ageGroupName,
  suggestedTeams,
  checker,
  defaultSubjectTeam,
  onImport,
  rowsMax,
  onClose,
  showToast,
}: ScheduleImportPanelProps) {
  const [stage, setStage] = useState<Stage>("picking");
  const [pasteText, setPasteText] = useState("");
  const [skipped, setSkipped] = useState<string[]>([]);
  const [subjectTeam, setSubjectTeam] = useState(defaultSubjectTeam);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const rowKey = useRef(0);

  const subjectOptions = useMemo(() => suggestedTeams.map((team) => team.name), [suggestedTeams]);

  /** A row's home-side name: its own, or the subject when the source only named an opponent. */
  const nameA = (row: ReviewRow) => row.teamA ?? subjectTeam;

  /** Each row as the games it names: a score only where both halves are whole runs. */
  const named = useMemo(
    () =>
      rows.map((row): NamedGame => {
        const played =
          row.scoreA.trim() !== "" &&
          row.scoreB.trim() !== "" &&
          isValidScorePair(row.scoreA, row.scoreB);
        return {
          id: row.key,
          teamA: row.teamA ?? subjectTeam,
          teamB: row.teamB,
          ...(row.stateA ? { stateA: row.stateA } : {}),
          ...(row.stateB ? { stateB: row.stateB } : {}),
          ...(played ? { teamAScore: Number(row.scoreA), teamBScore: Number(row.scoreB) } : {}),
          ...(row.date ? { date: row.date } : {}),
        };
      }),
    [rows, subjectTeam]
  );

  /*
   * Each row's check, by what it reads of the row (`checkKeyOf`), so a box ticked or a row
   * unchanged is not asked about again. Made here as the rows change, or asked of the server for
   * the rows it has not answered, once they have stood as typed a moment.
   */
  const here = checker.kind === "here" ? checker.check : null;
  const checkedHere = useMemo(() => {
    if (!here) return null;
    const cache = checkedHereBy.get(here) ?? new Map<string, NamedCheck>();
    checkedHereBy.set(here, cache);
    const missing = named.filter((game) => !cache.has(checkKeyOf(game)));
    if (missing.length > 0) {
      const checks = here(missing);
      missing.forEach((game, index) => {
        const check = checks[index];
        if (check) cache.set(checkKeyOf(game), check);
      });
    }
    return cache;
  }, [here, named]);
  const [answered, setAnswered] = useState<ReadonlyMap<string, NamedCheck>>(() => new Map());
  const [unanswered, setUnanswered] = useState(false);
  const [askAgain, setAskAgain] = useState(0);
  const ask = checker.kind === "asked" ? checker.check : null;
  /*
   * The rows still to ask about: ticked, readable, and not answered or being asked about. Keyed by
   * what the check reads, so a box ticked or a row unchanged does not ask again, and an answer
   * that lands after the rows have changed is kept, since it is still the answer for those rows.
   */
  const asking = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const waiting = useMemo(
    () =>
      ask
        ? named.filter(
            (game, index) =>
              rows[index]?.include === true && askable(game) && !answered.has(checkKeyOf(game))
          )
        : [],
    [ask, named, rows, answered]
  );
  useEffect(() => {
    if (!ask || unanswered || waiting.length === 0) return;
    const timer = setTimeout(() => {
      // Not those already being asked about; as many as one question asks, the rest once these
      // are answered.
      const batch = waiting
        .filter((game) => !asking.current.has(checkKeyOf(game)))
        .slice(0, ASK_ROWS);
      if (batch.length === 0) return;
      const keys = batch.map(checkKeyOf);
      keys.forEach((key) => asking.current.add(key));
      void ask(batch).then((checks) => {
        keys.forEach((key) => asking.current.delete(key));
        if (!mounted.current) return;
        if (!checks || checks.length !== batch.length) {
          setUnanswered(true);
          return;
        }
        setUnanswered(false);
        setAnswered((was) => {
          const next = new Map(was);
          keys.forEach((key, index) => {
            const check = checks[index];
            if (check) next.set(key, check);
          });
          return next;
        });
      });
    }, ASK_AFTER_MS);
    return () => clearTimeout(timer);
  }, [ask, waiting, unanswered, askAgain]);
  const checkOf = (index: number): NamedCheck | undefined => {
    const game = named[index];
    if (!game) return undefined;
    return (checkedHere ?? answered).get(checkKeyOf(game));
  };
  /** Ticked rows the server has not yet answered for: nothing is added until it has. */
  const checking =
    !checkedHere &&
    named.some(
      (game, index) =>
        rows[index]?.include === true && askable(game) && !answered.has(checkKeyOf(game))
    );
  const status = useRef<HTMLParagraphElement>(null);
  const [adding, setAdding] = useState(false);

  /** True while any row is still waiting on the subject field to know who it played. */
  const needsSubject = rows.some((row) => row.teamA === null);

  /**
   * Which rows already exist here. A brand-new team can't be part of a duplicate, and nor can a row
   * whose score is half typed, so those are never flagged.
   */
  const duplicateKeys = new Set(
    rows.flatMap((row, index) =>
      isValidScorePair(row.scoreA, row.scoreB) && checkOf(index)?.logged ? [row.key] : []
    )
  );

  const applyGames = (games: ParsedGameRow[], readSubject?: string) => {
    if (readSubject && !defaultSubjectTeam) setSubjectTeam(readSubject);
    setRows(
      games.map((game) => {
        rowKey.current += 1;
        return {
          key: `r${rowKey.current}`,
          // Pre-checked here, then unchecked below if it turns out to be a duplicate.
          include: true,
          date: game.date ?? "",
          teamA: game.teamA ?? null,
          teamB: game.teamB,
          ...(game.stateA ? { stateA: game.stateA } : {}),
          ...(game.stateB ? { stateB: game.stateB } : {}),
          scoreA: game.scoreA === undefined ? "" : String(game.scoreA),
          scoreB: game.scoreB === undefined ? "" : String(game.scoreB),
        };
      })
    );
    setStage("review");
  };

  /** Reads pasted text right here in the browser — no key, no quota, no network call. */
  const readPastedText = (text: string) => {
    const parsed = parseScheduleText(text);
    if (parsed.games.length === 0) {
      showToast(
        text.trim()
          ? "No games could be read from that text — check it against the example below the box."
          : "Paste your games first.",
        { tone: "error" }
      );
      return;
    }
    if (rowsMax !== undefined && parsed.games.length > rowsMax) {
      showToast(
        `That is ${parsed.games.length} games, and at most ${rowsMax} are added at once. Paste the list in parts.`,
        { tone: "error" }
      );
      return;
    }
    setSkipped(parsed.skipped);
    applyGames(parsed.games, parsed.subjectTeam);
  };

  const handleTextFile = (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => showToast("Could not read that file.", { tone: "error" });
    reader.onload = () => {
      const text = String(reader.result ?? "");
      setPasteText(text);
      readPastedText(text);
    };
    reader.readAsText(file);
  };

  const updateRow = (key: string, patch: Partial<ReviewRow>) => {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const includedRows = rows.filter((row) => row.include && !duplicateKeys.has(row.key));
  const subjectMissing = needsSubject && subjectTeam.trim().length === 0;
  const isBadRow = (row: ReviewRow) =>
    !nameOk(nameA(row)) ||
    !nameOk(row.teamB) ||
    !dateOk(row.date) ||
    teamNameKey(nameA(row)) === teamNameKey(row.teamB) ||
    !isValidScorePair(row.scoreA, row.scoreB);
  const badRows = includedRows.filter(isBadRow);

  const commit = () => {
    if (subjectMissing) {
      showToast("Enter which team's schedule this is.", { tone: "error" });
      return;
    }
    if (badRows.length > 0) {
      showToast("Fix or uncheck the highlighted rows first.", { tone: "error" });
      return;
    }
    if (includedRows.length === 0) {
      showToast("Nothing selected to add.", { tone: "error" });
      return;
    }
    if (checking) {
      showToast("Still checking these games against the cloud's — a moment.", { tone: "error" });
      return;
    }

    const included = new Set(includedRows.map((row) => row.key));
    const added = onImport(
      named
        .filter((game) => included.has(game.id))
        .map((game, index) => ({
          ...game,
          id: `scout_${Date.now()}_${index}_${Math.floor(Math.random() * 1000)}`,
        }))
    );
    if (!added) return;
    setAdding(true);
    void added.then((ok) => {
      if (!mounted.current) return;
      setAdding(false);
      // Not added, or not known to be: what the page holds may have changed, so every row is asked
      // about afresh, and one that did land is then found already logged.
      if (!ok) setAnswered(new Map());
    });
  };

  return (
    <div className={`${card} p-5`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Import games{ageGroupName ? ` → ${ageGroupName}` : ""}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="text-xs font-bold text-slate-500 hover:underline dark:text-slate-400"
        >
          Close
        </button>
      </div>

      {stage !== "review" && (
        <>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Paste your games below, one per line, or pick a CSV file. Every game is shown for review
            before anything is saved.
          </p>
          <label className="sr-only" htmlFor="scout-import-paste">
            Games to import
          </label>
          <textarea
            id="scout-import-paste"
            value={pasteText}
            onChange={(event) => setPasteText(event.target.value)}
            rows={6}
            spellCheck={false}
            placeholder={SAMPLE_PASTE}
            className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs dark:border-slate-800 dark:bg-slate-900"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => readPastedText(pasteText)}
              className={button.primary}
            >
              Read games
            </button>
            <label className="inline-block">
              <span className={`${button.ghost} inline-block cursor-pointer`}>
                Choose a CSV file
              </span>
              <input
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  event.currentTarget.value = "";
                  handleTextFile(file);
                }}
              />
            </label>
          </div>
          <details className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            <summary className="cursor-pointer font-semibold">What can I paste?</summary>
            <p className="mt-1">
              A CSV with headers in any order (<code>date</code>, <code>opponent</code>,{" "}
              <code>us</code>/<code>them</code>, or a single <code>score</code> column holding{" "}
              <code>6-5</code>), a spreadsheet paste, or schedule lines like{" "}
              <code>SAT 22 vs. Velocirabbits W 6-5</code> under an <code>August 2026</code> heading.
              Scores are always read from your team&apos;s side first, so <code>L 3-10</code> means
              you scored 3. Leave both scores blank for a game that hasn&apos;t been played.
            </p>
          </details>
        </>
      )}

      {stage === "review" && (
        <>
          {/* Only a schedule needs this: a game list already names both sides on every row. */}
          {needsSubject && (
            <>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <label
                  className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
                  htmlFor="scout-import-subject"
                >
                  Whose schedule is this?
                </label>
                <TeamNameCombobox
                  id="scout-import-subject"
                  value={subjectTeam}
                  onChange={setSubjectTeam}
                  options={subjectOptions}
                  placeholder="Team name"
                  className={`${inputClass} w-56`}
                />
              </div>
              {subjectMissing && (
                <p className="mt-1 text-xs font-semibold text-red-600 dark:text-red-400">
                  Needed — these rows name only the opponent, so every score is from this
                  team&apos;s side.
                </p>
              )}
            </>
          )}

          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <th className="py-2">Add</th>
                  <th>Date</th>
                  <th>Team</th>
                  <th>Score</th>
                  <th>Opponent</th>
                  <th>Score</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const duplicate = duplicateKeys.has(row.key);
                  const notes = checkOf(index)?.notes;
                  const invalid = row.include && !duplicate && isBadRow(row);
                  return (
                    <tr
                      key={row.key}
                      className={`border-t border-slate-100 dark:border-slate-800 ${
                        invalid ? "bg-red-50 dark:bg-red-950/30" : ""
                      }`}
                    >
                      <td className="py-2">
                        <input
                          type="checkbox"
                          checked={row.include && !duplicate}
                          disabled={duplicate}
                          aria-label={`Add ${nameA(row) || "this team"} versus ${
                            row.teamB || "this opponent"
                          }`}
                          onChange={(event) =>
                            updateRow(row.key, { include: event.target.checked })
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="date"
                          value={row.date}
                          onChange={(event) => updateRow(row.key, { date: event.target.value })}
                          className={`${inputClass} w-36`}
                        />
                      </td>
                      <td>
                        <span className="flex flex-col gap-1">
                          <input
                            type="text"
                            value={nameA(row)}
                            // Typing here pins the row to a team of its own, so it stops following
                            // the subject field above.
                            onChange={(event) => updateRow(row.key, { teamA: event.target.value })}
                            maxLength={NAME_MAX}
                            aria-label="Team"
                            className={`${inputClass} w-44`}
                          />
                          <NameNote
                            note={notes?.[0]}
                            onUse={(name) => updateRow(row.key, { teamA: name })}
                          />
                        </span>
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          value={row.scoreA}
                          aria-label="Team score"
                          onChange={(event) => updateRow(row.key, { scoreA: event.target.value })}
                          className={`${inputClass} w-16`}
                        />
                      </td>
                      <td>
                        <span className="flex flex-col gap-1">
                          <span className="flex items-center gap-1">
                            <input
                              type="text"
                              value={row.teamB}
                              aria-label="Opponent"
                              maxLength={NAME_MAX}
                              onChange={(event) =>
                                updateRow(row.key, { teamB: event.target.value })
                              }
                              className={`${inputClass} w-44`}
                            />
                            {duplicate && (
                              <span className={pill("neutral")} title="Already in this age group">
                                Already logged
                              </span>
                            )}
                          </span>
                          <NameNote
                            note={notes?.[1]}
                            onUse={(name) => updateRow(row.key, { teamB: name })}
                          />
                        </span>
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          value={row.scoreB}
                          aria-label="Opponent score"
                          onChange={(event) => updateRow(row.key, { scoreB: event.target.value })}
                          className={`${inputClass} w-16`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {skipped.length > 0 && (
            <p className="mt-2 text-xs font-semibold text-amber-700 dark:text-amber-500">
              {skipped.length} line{skipped.length === 1 ? "" : "s"} could not be read and{" "}
              {skipped.length === 1 ? "was" : "were"} left out:{" "}
              <span className="font-mono font-normal">{skipped.slice(0, 3).join(" · ")}</span>
              {skipped.length > 3 ? ` … and ${skipped.length - 3} more` : ""}
            </p>
          )}

          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Check the scores against what you pasted before adding. Leave both scores blank for a
            game that hasn&apos;t been played yet.
            {duplicateKeys.size > 0 &&
              ` ${duplicateKeys.size} row${duplicateKeys.size === 1 ? " is" : "s are"} already in this age group and won't be added again.`}
          </p>

          {/* Always there, so a screen reader hears what is put in it; focus comes here from
              Check again, which goes once pressed. */}
          <p
            ref={status}
            tabIndex={-1}
            className="mt-2 text-xs font-semibold text-slate-500 dark:text-slate-400"
            role="status"
          >
            {!checking ? null : unanswered ? (
              <>
                These games could not be checked against the cloud&apos;s.{" "}
                <button
                  type="button"
                  onClick={() => {
                    setUnanswered(false);
                    setAskAgain((times) => times + 1);
                    status.current?.focus();
                  }}
                  className="underline"
                >
                  Check again
                </button>
              </>
            ) : (
              "Checking these games against the cloud's…"
            )}
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={commit} disabled={adding} className={button.primary}>
              Add {includedRows.length} game{includedRows.length === 1 ? "" : "s"}
            </button>
            <button type="button" onClick={onClose} className={button.ghost}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
