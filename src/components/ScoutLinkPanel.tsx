import { memo, useMemo, useState } from "react";
import { TeamSearchSelect, type TeamSearchOption } from "./TeamSearchSelect";
import {
  NO_SCOUT_TEAM,
  type LeagueScoutBridge,
  type ScoutLinkCandidate,
  type ScoutLinkRow,
  type ScoutTeam,
} from "../lib/teamRankings";
import { displayName } from "../lib/format";
import { card, pill } from "../styles/tokens";

type ScoutLinkPanelProps = {
  bridge: LeagueScoutBridge;
  /** The clubs that could be this team, best evidence first. */
  candidatesFor: (leagueTeamName: string) => ScoutLinkCandidate[];
  /** Every club in the pool, built only when the wide search is asked for. */
  allClubs: () => ScoutTeam[];
  seasonLabel: string;
  /** Whether the setting below this one is letting any of it count right now. */
  countingOn: boolean;
  /** `undefined` clears the pick and lets the guess speak again. */
  onPick: (leagueTeamId: string, scoutTeamId: string | undefined) => void;
};

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

const where = (club: { city?: string; state?: string }) =>
  [club.city, club.state].filter(Boolean).join(", ");

/**
 * What each option says about itself. The town tells two clubs of a name apart; the opponents in
 * common say which one is *this* team, which is the thing a person cannot work out from a name.
 */
const optionFor = (candidate: ScoutLinkCandidate): TeamSearchOption => {
  const parts = [where(candidate)].filter(Boolean);
  if (candidate.sharedOpponents.length > 0) {
    parts.push(
      `${plural(candidate.sharedOpponents.length, "opponent")} in common: ${candidate.sharedOpponents
        .slice(0, 3)
        .join(", ")}`
    );
  }
  const detail = parts.join(" · ");
  return { id: candidate.scoutTeamId, label: candidate.name, ...(detail ? { detail } : {}) };
};

/** What a row's state should say, and in what tone. Null where there is nothing worth saying. */
const noteFor = (
  row: ScoutLinkRow
): { tone: "blue" | "amber" | "red" | "neutral"; label: string; body: string } | null => {
  if (row.conflictWith?.length) {
    return {
      tone: "red",
      label: "Clash",
      body: "Another team here picked this same club, so neither pick counts. Give one of them a different club.",
    };
  }
  if (row.staleScoutTeamId) {
    return {
      tone: "red",
      label: "Gone",
      body: "The club you picked is no longer in Team Rankings — a reset, or a tidy that folded it into another. Pick it again.",
    };
  }
  if (row.ambiguousCount) {
    return {
      tone: "amber",
      label: "Which one?",
      body: `${row.ambiguousCount} clubs on this season's pages are called this, and none of them has played the clubs you play. Pick which one, or nothing counts.`,
    };
  }
  if (row.how === "guessed") {
    return {
      tone: "blue",
      label: "Guess",
      body: row.sharedOpponents
        ? `Matched on the name, and it has played ${plural(row.sharedOpponents, "club")} you also play. Confirm it, or pick another.`
        : "Matched on the name alone. Confirm it, or pick the right club.",
    };
  }
  if (row.how === "off") {
    return {
      tone: "neutral",
      label: "Not here",
      body: "This team is not in Team Rankings, so nothing is looked for.",
    };
  }
  if (row.how === "none") {
    return {
      tone: "amber",
      label: "No club",
      body: "No club of this name has a game on this season's pages.",
    };
  }
  return null;
};

/**
 * Which Team Rankings club each league team is, said once and kept.
 *
 * The two halves of the app keep separate ids for the same club and rarely agree on how long a name
 * is: a roster that says "Trash Pandas" against a GameChanger team called "Trash Pandas Baseball
 * Club". Matching on the name alone was a guess that failed quietly — the club's tournament results
 * were filed under an opponent of their own, where they sharpened nothing, and nothing said so.
 *
 * Where a name cannot answer, a schedule can. The clubs offered for each team are ordered by how
 * many of that team's own league opponents they have also played, which is far harder to coincide
 * with than a name, and the row says so. The guess is still made and still marked as one; the answer
 * given here is what counts.
 */
/**
 * Memoised because it sits inside the Settings tab, which re-renders on every keystroke in any of
 * its inputs, and each of its rows asks the pool a question. Its props are all stable references
 * or primitives — the bridge is a memo, the callbacks are `useCallback`s — so this re-renders only
 * when the season, its label, the counting toggle or the pool itself actually changed, not because
 * somebody typed a cutoff two cards down.
 */
export const ScoutLinkPanel = memo(ScoutLinkPanelInner);

function ScoutLinkPanelInner({
  bridge,
  candidatesFor,
  allClubs,
  seasonLabel,
  countingOn,
  onPick,
}: ScoutLinkPanelProps) {
  const [wide, setWide] = useState(false);
  // Built only when asked for: the pool can hold tens of thousands of clubs, and the picker
  // re-sorts its whole option list on every keystroke.
  const wideOptions = useMemo(
    () =>
      wide
        ? allClubs().map((club): TeamSearchOption => {
            const detail = where(club);
            return { id: club.id, label: club.name, ...(detail ? { detail } : {}) };
          })
        : [],
    [wide, allClubs]
  );

  return (
    <div className={`${card} p-5`}>
      <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">
        Which Team Rankings club is each team?
      </h2>

      {!bridge.seasonLinked ? (
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          No age group claims <strong>{seasonLabel}</strong> yet, so nothing from Team Rankings
          reaches this season and there is nothing to pick from. In Team Rankings, edit the age
          group this season belongs to and tick this season in its list — the same link that already
          carries this schedule the other way.
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            <strong>
              {bridge.linkedCount} of {plural(bridge.rows.length, "team")} linked
            </strong>{" "}
            · {plural(bridge.countedResults, "outside result")}{" "}
            {countingOn ? "counting" : "ready, but switched off below"}. A team with no club here
            has its tournament games filed under an opponent of their own, where they sharpen
            nothing.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            The two halves keep separate ids for the same club and rarely agree on how long a name
            is. Clubs are offered with the opponents you both play, because that is what tells one
            Trash Pandas from another. A row marked <strong>Guess</strong> has not been confirmed.
          </p>

          <label className="mt-3 flex items-center gap-2 text-xs font-semibold text-slate-500">
            <input
              type="checkbox"
              checked={wide}
              onChange={(event) => setWide(event.target.checked)}
            />
            Search every GameChanger-linked club in Team Rankings, not just the ones this
            season&apos;s pages hold
          </label>

          <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
            {bridge.rows.map((row) => {
              const note = noteFor(row);
              const options = wide ? wideOptions : candidatesFor(row.leagueTeamName).map(optionFor);
              return (
                <li
                  key={row.leagueTeamId}
                  className="flex flex-wrap items-start gap-3 py-3 text-sm"
                >
                  <span className="flex min-w-36 flex-col">
                    <span className="font-bold text-slate-950 dark:text-white">
                      {displayName(row.leagueTeamName)}
                    </span>
                    {note && (
                      <span className={`mt-1 self-start ${pill(note.tone)}`}>{note.label}</span>
                    )}
                  </span>
                  <span className="flex min-w-64 flex-1 flex-col gap-1">
                    <label className="sr-only" htmlFor={`scout-link-${row.leagueTeamId}`}>
                      Team Rankings club for {row.leagueTeamName}
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      <TeamSearchSelect
                        id={`scout-link-${row.leagueTeamId}`}
                        value={row.how === "picked" ? (row.scoutTeamId ?? "") : ""}
                        onChange={(scoutTeamId) => onPick(row.leagueTeamId, scoutTeamId)}
                        options={options}
                        placeholder={
                          row.how === "guessed" && row.suggestedName
                            ? `Guessing: ${row.suggestedName}`
                            : "Type a club name…"
                        }
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900"
                      />
                      <button
                        type="button"
                        onClick={() => onPick(row.leagueTeamId, NO_SCOUT_TEAM)}
                        className="text-xs font-bold text-slate-500 hover:underline dark:text-slate-400"
                      >
                        Not in Team Rankings
                      </button>
                      {(row.how === "picked" || row.how === "off") && (
                        <button
                          type="button"
                          onClick={() => onPick(row.leagueTeamId, undefined)}
                          className="text-xs font-bold text-slate-500 hover:underline dark:text-slate-400"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    {note && <span className="text-xs text-slate-500">{note.body}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
