import { Fragment, useId, useMemo, useRef, useState } from "react";
import {
  countedInWindow,
  countsTowardRating,
  gamesForTeam,
  gcSeasonLabel,
  isScoutGamePlayed,
  namesTbd,
  normalizeState,
  playsItself,
  rankingPoolGroupIds,
  scoreSeenBy,
  startsWithinTheHour,
  teamNameKey,
  teamRecordInPool,
  type AgeGroup,
  type GcAgeSource,
  type GcTeamLink,
  type ScoutGame,
  type ScoutRankingRow,
  type ScoutTeam,
  type SeasonSegment,
} from "../lib/teamRankings";
import { ageGroupYear, inSegment, MAX_AGE_LEVEL, MIN_AGE_LEVEL } from "../lib/teamRankings/seasons";
import { formOf } from "../lib/clubForm";
import { describeRoster, rosterStanding } from "../lib/gcRoster";
import { coachesOf } from "../lib/gcStaff";
import { agoLabel } from "../lib/date";
import { TeamSearchSelect } from "./TeamSearchSelect";
import { TEAM_PANEL_ID } from "./teamPanelId";
import { WhatIf, WhatIfButton } from "./teamRankings/WhatIf";
import { button, card, pill, textRole } from "../styles/tokens";

/** The panel's element id, for a list elsewhere on the page that opens a team to scroll to it. */
export { TEAM_PANEL_ID };

/**
 * What a screen reader hears for Not this team: the words on the button first, then which games it
 * takes off which club, since the words alone, beside an opponent's name, read as a remark about
 * the opponent and say nothing of a press taking more than the one game.
 */
const notThisTeamLabel = (
  club: string,
  opponent: string,
  date: string | undefined,
  games: number
): string =>
  games > 1
    ? `Not this team: take the ${games} games ${opponent} filed here by this name off ${club}`
    : `Not this team: take the game with ${opponent}${date ? ` on ${date}` : ""} off ${club}`;

type TeamDetailPanelProps = {
  team: ScoutTeam;
  /** Every game in the roster's world, so games outside this season can be counted too. */
  allGames: ScoutGame[];
  ageGroupId: string;
  ageGroupName: string;
  /** Every age group, so the pool this page rates can be worked out. */
  ageGroups: AgeGroup[];
  /**
   * The half of the year the board behind this panel is showing, or nothing for the whole year.
   *
   * It is here because the record in this panel has to be the record in that row, and the row's is
   * over the half the board was fitted on.
   */
  segment?: SeasonSegment;
  teamNameById: Map<string, string>;
  /**
   * How League Standings reaches this club on the page, if it does. By `"name"` — its roster's
   * name, a guess, or picks that clash — the name is the link, so it is not ours to change. By
   * `"pick"` alone the link is the club's id, which a new name keeps.
   */
  leagueLink?: "name" | "pick";
  onRename: (nextName: string) => void;
  /** Two letters, or empty to clear it. */
  /** Sets the club's state, or clears it for ""; false when the store would not keep it. */
  onSetState: (state: string) => boolean;
  /** Takes one GameChanger id off this team, undoing a pairing that turned out to be wrong. */
  onUnlinkGc: (gcTeamId: string) => void;
  /** Folds this team into another — the "same team as" the pull could only propose. */
  onMergeInto: (intoTeamId: string) => void;
  /**
   * The level this club is filed at in the page's year, and the level somebody set here if they
   * did. Absent for a club with no GameChanger link that year, whose level is read off its games.
   */
  age?: { level?: number; pinned?: { level: number; was?: number } };
  /** Files the club at another level from now on (`setClubAge`), and keeps it there. */
  onSetAge?: (level: number) => void;
  /** Takes back a level set here, putting the club back where it had been filed. */
  onClearAge?: () => void;
  /**
   * "Not this team", beside each game the club has only because a name on another club's schedule
   * was matched to it: `offered` says which games those are (`filedByNameOn`, or what the live
   * card says of a game it no longer carries the rows of), and `onRefuse` takes one off the club.
   */
  notThisTeam?: { offered: (game: ScoutGame) => boolean; onRefuse: (game: ScoutGame) => void };
  /** Teams this one could be folded into: everyone else on the page, likeliest club first. */
  mergeCandidates: MergeCandidate[];
  onClose: () => void;
  /**
   * Nothing on the panel changes the club: the live board's (`LiveClubPanel`), which reads a
   * published card and has no copy to write to. What the club is, its age, its record and its games
   * are shown; renaming, unlinking, setting an age or state and folding are not.
   */
  readOnly?: boolean;
  /**
   * What each counted game did to the club's rating on the board on screen, worked out on the live
   * board from the club's card and that board (`gameBreakdown`, `gameWords`): a line above the
   * list splitting the rating into its games and its record, the key to the two figures, and each
   * game's clauses by the game's id. Drawn only under a counted W, L or T row, so a game still to
   * come, one set not to count, one against the club's own name or one outside the half on screen
   * never carries one. Left out wherever the lines do not add up to the board's own row, and on
   * this device's own page, which has no published board to explain; the panel is then exactly as
   * it was.
   */
  gameNotes?: {
    headline: string;
    key: string;
    byGame: ReadonlyMap<string, readonly string[]>;
  };
  /**
   * A club's row on the board behind the panel, for each game's What if, worked out from the
   * ratings shown (`WhatIf`). Absent, or either club without a row, and the game has none.
   */
  ratingRowOf?: (teamId: string) => ScoutRankingRow | undefined;
  /** Whether the club is watched on this page, and the way to watch it or stop (`watchList.ts`). */
  watch?: { on: boolean; full: boolean; onToggle: (name: string) => void };
};

/** Which rule of the import filed a link at its level, as the link line says it. */
const AGE_SOURCE_TEXT: Record<GcAgeSource, string> = {
  you: "set by you",
  gamechanger: "from GameChanger's age field",
  name: "from its name",
  list: "from its league or organization on your list",
  opponents: "from its opponents' names",
  pool: "from where its opponents are filed",
  fixtures: "from the clubs its games were against",
  tentative: "from the teams it has played",
};

/**
 * Where a link's level came from, and what GameChanger's own age field says. Only for a link
 * pulled since the source was recorded (`GcTeamLink.ageFrom`): before that there is nothing to
 * say, and an absent field would read as GameChanger giving none when it was only never kept.
 */
const ageSourceLine = (link: GcTeamLink): string => {
  if (link.ageFrom === undefined) return "";
  const field = link.ageLabel ? `"${link.ageLabel}"` : "";
  if (link.ageFrom === "gamechanger") {
    return `, ${AGE_SOURCE_TEXT.gamechanger}${field ? ` (${field})` : ""}`;
  }
  // Set on the panel, over a link that may be older than the field was kept: say it only if known.
  if (link.ageFrom === "you") {
    return `, ${AGE_SOURCE_TEXT.you}${field ? `; GameChanger's age field says ${field}` : ""}`;
  }
  const said = field ? `GameChanger's age field says ${field}` : "GameChanger gives no age";
  return `, ${AGE_SOURCE_TEXT[link.ageFrom]}; ${said}`;
};

/** A team the picker can offer, with a line about why it is near the top when there is one. */
export type MergeCandidate = ScoutTeam & { clubHint?: string };

const scoreLine = (game: ScoutGame, own: string, nameOf: (id: string) => string) => {
  const isA = game.teamAId === own;
  const opponent = nameOf(isA ? game.teamBId : game.teamAId);
  const seen = isScoutGamePlayed(game) ? scoreSeenBy(game, own) : undefined;
  if (!seen) return { opponent, result: null as null | string, detail: "Scheduled" };
  // This club's own schedule's score, where the two clubs' schedules disagree.
  const { own: ownScore, opponent: oppScore } = seen;
  const result = ownScore > oppScore ? "W" : ownScore < oppScore ? "L" : "T";
  return { opponent, result, detail: `${ownScore}–${oppScore}` };
};

/**
 * Everything logged for one team: its games here, and how many it has elsewhere.
 *
 * Also where a name gets corrected. Renaming onto a name that already exists merges the two, which
 * is the point — a schedule that said "TBD", or a club typed two ways, leaves games stranded on a
 * team that should never have existed, and this is how they reach the right one.
 */
export function TeamDetailPanel({
  team,
  allGames,
  ageGroupId,
  ageGroupName,
  ageGroups,
  segment,
  teamNameById,
  leagueLink,
  onRename,
  onSetState,
  onUnlinkGc,
  onMergeInto,
  age,
  onSetAge,
  onClearAge,
  notThisTeam,
  mergeCandidates,
  onClose,
  readOnly = false,
  gameNotes,
  ratingRowOf,
  watch,
}: TeamDetailPanelProps) {
  // The game whose What if is open.
  const [whatIf, setWhatIf] = useState<string | null>(null);
  const ownRow = ratingRowOf?.(team.id);
  const [draftName, setDraftName] = useState(team.name);
  // The state box holds what is being typed: one letter is a state on its way, not a state to
  // save, and saved as it was typed the club's state was cleared at the first letter and the box
  // emptied under the cursor, so no state could be typed at all. It follows the stored state
  // whenever that changes, from here or elsewhere.
  const [draftState, setDraftState] = useState(team.state ?? "");
  const stateFor = `${team.id}:${team.state ?? ""}`;
  const [stateSeen, setStateSeen] = useState(stateFor);
  if (stateSeen !== stateFor) {
    setStateSeen(stateFor);
    setDraftState(team.state ?? "");
  }
  const [mergeTarget, setMergeTarget] = useState("");
  const [draftAge, setDraftAge] = useState(age?.level ?? MIN_AGE_LEVEL);
  // The panel is keyed by club alone, so it stays open across a switch to another year's page, or
  // a level set or handed back; the choice starts again from the level shown, rather than setting
  // a level read off another year.
  const draftFor = `${ageGroupId}:${age?.level ?? ""}`;
  const [draftSeen, setDraftSeen] = useState(draftFor);
  if (draftSeen !== draftFor) {
    setDraftSeen(draftFor);
    setDraftAge(age?.level ?? MIN_AGE_LEVEL);
  }
  const ageId = useId();

  /**
   * What the merge picker offers. The state rides along as the detail line, because a pool pulled
   * from GameChanger holds several clubs of the same name and the name alone cannot choose between
   * them; the picker sorts and filters them itself.
   */
  const mergeOptions = useMemo(
    () =>
      mergeCandidates.map((candidate, index) => {
        // Who coaches each: two teams run by the same people are one club (`gcStaff.ts`).
        const coaches = coachesOf(candidate);
        return {
          id: candidate.id,
          label: candidate.name,
          ...(coaches.length > 0 ? { coaches } : {}),
          ...(candidate.gcTeams?.length
            ? { gcIds: candidate.gcTeams.map((link) => link.teamId) }
            : {}),
          // The caller hands these club-first; the index keeps that order through the picker's own
          // alphabetical sort, which would otherwise bury the answer among thousands of names.
          ...(candidate.clubHint ? { priority: index } : {}),
          // The club hint when there is one, since it is the reason this name is near the top; the
          // state otherwise, which is what tells two clubs of the same name apart.
          ...(candidate.clubHint
            ? { detail: candidate.clubHint }
            : candidate.state
              ? { detail: candidate.state }
              : {}),
        };
      }),
    [mergeCandidates]
  );

  const nameOf = (id: string) => teamNameById.get(id) ?? "Unknown";
  const everyGame = useMemo(() => gamesForTeam(team.id, allGames), [team.id, allGames]);

  /**
   * Scoped to the rating pool — every age group sharing this one's season year — rather than to
   * the page's own group, because that is what the ranking table rates. A 10U that spent the year
   * playing down is listed on the 10U page with every one of its games filed under 9U: scoped to
   * the group it would read 0-0 with nothing logged, directly contradicting the row above it.
   */
  const poolIds = useMemo(
    () => new Set(rankingPoolGroupIds(ageGroupId, ageGroups)),
    [ageGroupId, ageGroups]
  );
  const here = everyGame.filter((game) => poolIds.has(game.ageGroupId));
  const elsewhere = everyGame.length - here.length;

  // The same record the ranking row shows, over the same half, counted by the same function, so
  // the two agree.
  const record = useMemo(
    () => teamRecordInPool(team.id, ageGroupId, allGames, ageGroups, segment),
    [team.id, ageGroupId, allGames, ageGroups, segment]
  );
  const { wins, losses, ties } = record;
  // Its last games against the margins its ratings expected, over the record's pool and half
  // (`formOf`): a card names the club's games of every year, and another year's could otherwise
  // take a place in the last five.
  const form = useMemo(() => {
    if (!ratingRowOf) return undefined;
    const year = ageGroupYear(ageGroups.find((group) => group.id === ageGroupId));
    return formOf(
      team.id,
      allGames.filter(
        (game) => poolIds.has(game.ageGroupId) && inSegment(game.date, year, segment)
      ),
      ratingRowOf
    );
  }, [ratingRowOf, ageGroups, ageGroupId, team.id, allGames, poolIds, segment]);
  const inWindow = useMemo(
    () =>
      new Set(here.filter((game) => countedInWindow(game, ageGroups, segment)).map((g) => g.id)),
    [here, ageGroups, segment]
  );
  // A game against its own name is said as that, not as one somebody set not to count.
  const againstItself = here.filter((game) => isScoutGamePlayed(game) && playsItself(game));
  const notCounted = here.filter(
    (game) => isScoutGamePlayed(game) && !countsTowardRating(game) && !playsItself(game)
  );
  /**
   * Why a game the tidy set not to count as a copy is not counted. A game against a TBD slot
   * (`markTbdGames`) names the game at that hour that counts in its place, which is the owner's
   * "paired with another team that played at that date and time", or says that nothing pairs it.
   */
  const copyTitle = (game: ScoutGame): string => {
    const opponentOf = (row: ScoutGame) =>
      nameOf(row.teamAId === team.id ? row.teamBId : row.teamAId);
    if (!namesTbd(opponentOf(game)))
      return "Another GameChanger team's copy of a game already counted, not counted again";
    const pair = here.find(
      (row) =>
        row.id !== game.id &&
        countsTowardRating(row) &&
        startsWithinTheHour(row.startTs, game.startTs) &&
        !namesTbd(opponentOf(row))
    );
    return pair
      ? `TBD on the schedule: the game against ${opponentOf(pair)} at that time counts in its place`
      : "TBD on the schedule, and no other team's game at that date and time pairs it: not counted";
  };

  /*
   * How many games one press of Not this team takes off, by the club on the game's other side:
   * every game it is offered beside against that club, since the command takes every one that
   * club's schedules filed here by the name. Said in the button's name, so a press that takes
   * three games is not heard as taking one.
   */
  const offeredAgainst = new Map<string, number>();
  if (notThisTeam && !readOnly) {
    everyGame.forEach((game) => {
      if (!notThisTeam.offered(game)) return;
      const other = game.teamAId === team.id ? game.teamBId : game.teamAId;
      offeredAgainst.set(other, (offeredAgainst.get(other) ?? 0) + 1);
    });
  }
  // Where focus goes once a press takes the button's own row away: the list's heading, in the
  // panel, rather than the page's body.
  const gamesHeading = useRef<HTMLHeadingElement>(null);
  /*
   * Only when a row on the list will carry a line; none at all leaves the panel exactly as it was.
   * Asked of the rows drawn, not of the lines handed in: those are worked out from the card as
   * published, and the list from the card with this device's pending edits over it, so a pending
   * Not this team can take every lined row off the list while its lines are still in hand, and a
   * line's game can sit outside the counted window. The line above the list and its key would then
   * explain two figures that appear nowhere.
   */
  const notes =
    gameNotes && here.some((game) => inWindow.has(game.id) && gameNotes.byGame.has(game.id))
      ? gameNotes
      : undefined;

  const trimmed = draftName.trim();
  const renamed = trimmed.length > 0 && trimmed !== team.name;
  const headingId = useId();

  const wouldMerge =
    renamed &&
    [...teamNameById.entries()].some(
      ([id, name]) => id !== team.id && teamNameKey(name) === teamNameKey(trimmed)
    );

  const closeButton = (
    <button
      type="button"
      onClick={onClose}
      className="text-xs font-bold text-slate-500 hover:underline dark:text-slate-400"
    >
      Close
    </button>
  );
  return (
    // A region rather than a plain box: this opens in answer to a click somewhere else on the
    // page, and naming it after the team is what tells a screen-reader user which team arrived.
    <section id={TEAM_PANEL_ID} aria-labelledby={headingId} className={`${card} p-5`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2
            id={headingId}
            className="text-sm font-black uppercase tracking-wide text-slate-500 dark:text-slate-400"
          >
            {team.name}
          </h2>
          {(team.city || team.state) && (
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              {[team.city, team.state].filter(Boolean).join(", ")}
            </p>
          )}
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {record.games === 0
              ? `No completed games in ${ageGroupName || "this age group"}${segment ? " this half" : ""} yet.`
              : `${wins}-${losses}${ties ? `-${ties}` : ""} in ${ageGroupName || "this age group"}, from ${record.games} game${record.games === 1 ? "" : "s"}.`}
            {record.crossAgeGames > 0
              ? ` ${record.crossAgeGames} of ${record.crossAgeGames === 1 ? "them was" : "them were"} against another age level.`
              : ""}
            {record.outsideWindow > 0
              ? ` ${record.outsideWindow} more played here ${record.outsideWindow === 1 ? "is" : "are"} outside ${segment ? "this half of the season" : "this season year"}, so ${record.outsideWindow === 1 ? "it is" : "they are"} not in that record.`
              : ""}
            {notCounted.length > 0
              ? ` ${notCounted.length} more played here ${notCounted.length === 1 ? "is" : "are"} set not to count.`
              : ""}
            {againstItself.length > 0
              ? ` ${againstItself.length} more ${againstItself.length === 1 ? "is" : "are"} against its own name — a scrimmage of its own squad, or a namesake it could not be told from — and not counted.`
              : ""}
            {elsewhere > 0
              ? ` ${elsewhere} more game${elsewhere === 1 ? "" : "s"} in another season, not counted here.`
              : ""}
          </p>
          {form && (
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
              <span className="font-semibold">Form, last {form.games.length}:</span>{" "}
              {form.games.map((one) => (one.tied ? "T" : one.won ? "W" : "L")).join(" ")} · beat the
              margin its ratings expected in {form.beat} of {form.games.length},{" "}
              {Math.abs(form.average).toFixed(1)} runs a game{" "}
              {form.average >= 0 ? "better" : "worse"} on average
            </p>
          )}
        </div>
        {watch ? (
          <span className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => watch.onToggle(team.name)}
              aria-pressed={watch.on}
              disabled={!watch.on && watch.full}
              title={
                !watch.on && watch.full
                  ? "Five clubs are watched on this page already. Stop watching one first."
                  : undefined
              }
              className="text-xs font-bold text-blue-600 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline dark:text-blue-400"
            >
              {watch.on ? "Watching" : "Watch"}
            </button>
            {closeButton}
          </span>
        ) : (
          closeButton
        )}
      </div>

      {!readOnly && (
        <div className="mt-4">
          <label
            className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
            htmlFor="scout-team-rename"
          >
            Team name
          </label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <input
              id="scout-team-rename"
              type="text"
              value={draftName}
              disabled={leagueLink === "name"}
              onChange={(event) => setDraftName(event.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm disabled:opacity-60 dark:border-slate-800 dark:bg-slate-900"
            />
            <button
              type="button"
              disabled={leagueLink === "name" || !renamed}
              onClick={() => onRename(trimmed)}
              className={button.ghost}
            >
              {wouldMerge ? "Merge" : "Rename"}
            </button>
          </div>
          {leagueLink === "name" ? (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              This team comes from a League Standings season, so its name is set there.
            </p>
          ) : wouldMerge ? (
            <p className="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-500">
              A team is already called that. Saving moves every game from this one over to it and
              removes this one — which is how a placeholder gets routed to the real team.
              {leagueLink === "pick" &&
                " League Standings' pick of this club is left pointing at nothing, so pick the club again in Settings."}
            </p>
          ) : leagueLink === "pick" ? (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              A League Standings team is linked to this club by your pick in Settings, which a new
              name here keeps.
            </p>
          ) : team.placeholder ? (
            <p className="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-500">
              This is a placeholder, not a team — the schedule said so rather than naming a club.
              The game is kept and counts for whoever played it, and this slot is not ranked. Type
              the club&apos;s real name here once you know it and the game moves to them; if that
              club is already here, saving merges the two.
            </p>
          ) : (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Any age level in the name is dropped, so &ldquo;Aces 10U&rdquo; is stored as
              &ldquo;Aces&rdquo;.
            </p>
          )}
        </div>
      )}

      {(team.gcTeams?.length ?? 0) > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Known on GameChanger as
          </p>
          <ul className="mt-1 space-y-1">
            {team.gcTeams?.map((link) => (
              <li key={link.teamId} className="flex flex-wrap items-center gap-2 text-sm">
                <a
                  href={`https://web.gc.com/teams/${link.teamId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-bold text-blue-600 hover:underline dark:text-blue-400"
                >
                  {link.name}
                </a>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {gcSeasonLabel(link) || "season unknown"}
                  {/* Where the app filed it, which GameChanger's page need not have said. */}
                  {link.ageLevel === undefined
                    ? ""
                    : ` · filed at ${link.ageLevel}U${ageSourceLine(link)}`}
                  {link.staff?.length ? ` · ${link.staff.join(", ")}` : ""}
                </span>
                {(link.record || link.importedAt) && (
                  // GameChanger's own count beside the link, so checking it takes no trip there.
                  // Its own reasons differ from this page's often enough that it is a note, not a
                  // verdict on the record above.
                  <span
                    className="text-xs text-slate-500 dark:text-slate-400"
                    title="GameChanger's own season record for this team, as of the last pull"
                  >
                    {link.record
                      ? `GameChanger ${link.record.win}-${link.record.loss}${link.record.tie ? `-${link.record.tie}` : ""}`
                      : "No GameChanger record"}
                    {link.importedAt ? `, pulled ${agoLabel(link.importedAt)}` : ""}
                  </span>
                )}
                {rosterStanding(link.playerCount) === "short" && (
                  <span className={pill("amber")} title={describeRoster(link.playerCount) ?? ""}>
                    {link.playerCount} players
                  </span>
                )}
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => onUnlinkGc(link.teamId)}
                    className="text-xs font-bold text-red-600 hover:underline dark:text-red-400"
                  >
                    Unlink
                  </button>
                )}
              </li>
            ))}
          </ul>
          {!readOnly && (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              GameChanger mints a new id every season, so a club pulled across two seasons is known
              by two. Unlinking takes one off and leaves its games here — that id can then be pulled
              onto a team of its own, which is how a wrong pairing is taken apart.
            </p>
          )}
        </div>
      )}

      {age && readOnly && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Age
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {age.pinned
              ? `Set to ${age.pinned.level}U by hand${
                  age.pinned.was !== undefined && age.pinned.was !== age.pinned.level
                    ? `; the app had filed it at ${age.pinned.was}U`
                    : ""
                }.`
              : age.level === undefined
                ? "The app has no age for this club."
                : `The app filed this club at ${age.level}U.`}
          </p>
        </div>
      )}

      {age && onSetAge && !readOnly && (
        <div className="mt-4">
          <label
            className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
            htmlFor={ageId}
          >
            Age
          </label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <select
              id={ageId}
              value={draftAge}
              onChange={(event) => setDraftAge(Number(event.target.value))}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900"
            >
              {Array.from({ length: MAX_AGE_LEVEL - MIN_AGE_LEVEL + 1 }, (_, at) => {
                const level = MIN_AGE_LEVEL + at;
                return (
                  <option key={level} value={level}>
                    {level}U
                  </option>
                );
              })}
            </select>
            <button
              type="button"
              disabled={age.pinned?.level === draftAge}
              onClick={() => onSetAge(draftAge)}
              className={button.ghost}
            >
              Set age
            </button>
            {age.pinned && onClearAge && (
              <button
                type="button"
                onClick={onClearAge}
                className="text-xs font-bold text-slate-500 hover:underline dark:text-slate-400"
              >
                Let the app decide
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {age.pinned
              ? `You set this club to ${age.pinned.level}U${
                  age.pinned.was !== undefined && age.pinned.was !== age.pinned.level
                    ? `; the app had filed it at ${age.pinned.was}U`
                    : ""
                }. Later pulls keep it there, whatever GameChanger says.`
              : `${
                  age.level === undefined
                    ? "The app has no age for this club."
                    : `The app filed this club at ${age.level}U.`
                } If it plays at another age, set it here: its games move to that age's page and later pulls keep it there.`}
          </p>
        </div>
      )}

      {mergeCandidates.length > 0 && !readOnly && (
        <div className="mt-4">
          <label
            className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
            htmlFor="scout-team-merge"
          >
            Same team as
          </label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <TeamSearchSelect
              id="scout-team-merge"
              value={mergeTarget}
              onChange={setMergeTarget}
              options={mergeOptions}
              placeholder="Type a team or coach name…"
              className="w-full text-sm"
            />
            <button
              type="button"
              disabled={!mergeTarget}
              onClick={() => {
                if (!mergeTarget) return;
                onMergeInto(mergeTarget);
                setMergeTarget("");
              }}
              className={button.ghost}
            >
              Fold into it
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Moves every game from this team over to that one and removes this entry, keeping both
            GameChanger ids. For a club that arrived twice — once pulled by id, once as somebody
            else&apos;s opponent.
          </p>
        </div>
      )}

      {!readOnly && (
        <div className="mt-4">
          <label
            className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
            htmlFor="scout-team-state"
          >
            State
          </label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <input
              id="scout-team-state"
              type="text"
              value={draftState}
              maxLength={2}
              placeholder="KY"
              onChange={(event) => {
                const typed = event.target.value.toUpperCase();
                setDraftState(typed);
                // Saved once it is a state, or nothing at all.
                // A state the store would not keep goes back to the one it holds.
                if ((typed.trim() === "" || normalizeState(typed)) && !onSetState(typed))
                  setDraftState(team.state ?? "");
              }}
              className="w-20 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm uppercase dark:border-slate-800 dark:bg-slate-900"
            />
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Optional. Two letters, and only used to filter the rankings — it never changes a
              rating.
            </span>
          </div>
        </div>
      )}

      <h3
        ref={gamesHeading}
        tabIndex={-1}
        className="mt-5 text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400"
      >
        Games in {ageGroupName || "this age group"}
      </h3>
      {notes && (
        <p className={`mt-1 ${textRole.meta}`}>
          {notes.headline} {notes.key}
        </p>
      )}
      {here.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Nothing logged here yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
          {here.map((game) => {
            const line = scoreLine(game, team.id, nameOf);
            // A counted W, L or T row alone, the rows the record above and the board's row are
            // counted over: the window holds only games that count (`countsTowardRating`, so
            // played, not set aside and not against the club's own name) in the half on screen.
            const clauses = notes && inWindow.has(game.id) ? notes.byGame.get(game.id) : undefined;
            const opponentRow = ratingRowOf?.(
              game.teamAId === team.id ? game.teamBId : game.teamAId
            );
            return (
              <li
                key={game.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
              >
                <span className="flex items-center gap-2">
                  {game.excluded ? (
                    <span className={pill("amber")} title="Kept, but not counted">
                      —
                    </span>
                  ) : line.result && playsItself(game) ? (
                    <span className={pill("neutral")} title="Against its own name, not counted">
                      {line.result}
                    </span>
                  ) : line.result && game.countedElsewhere ? (
                    <span className={pill("neutral")} title={copyTitle(game)}>
                      {line.result}
                    </span>
                  ) : line.result && !inWindow.has(game.id) ? (
                    // Played, and kept, but outside the window the record above is counted over —
                    // shown rather than dropped, so a list longer than the record is explained.
                    <span
                      className={pill("neutral")}
                      title={
                        segment ? "Outside this half of the season" : "Outside this season year"
                      }
                    >
                      {line.result}
                    </span>
                  ) : line.result ? (
                    <span
                      className={pill(
                        line.result === "W" ? "emerald" : line.result === "L" ? "red" : "neutral"
                      )}
                    >
                      {line.result}
                    </span>
                  ) : (
                    <span className={pill("blue")}>Sched</span>
                  )}
                  <span className="font-bold text-slate-950 dark:text-white">{line.opponent}</span>
                </span>
                <span className="flex flex-wrap items-center gap-2 text-slate-500 dark:text-slate-400">
                  <span>
                    {line.detail}
                    {game.date ? ` · ${game.date}` : ""}
                    {game.event ? ` · ${game.event}` : ""}
                  </span>
                  {notThisTeam && !readOnly && notThisTeam.offered(game) && (
                    <button
                      type="button"
                      onClick={() => {
                        notThisTeam.onRefuse(game);
                        gamesHeading.current?.focus();
                      }}
                      aria-label={notThisTeamLabel(
                        team.name,
                        line.opponent,
                        game.date,
                        offeredAgainst.get(
                          game.teamAId === team.id ? game.teamBId : game.teamAId
                        ) ?? 1
                      )}
                      title={`${line.opponent}'s schedule named its opponent, and the name was matched to ${team.name}; nothing of ${team.name}'s own lists this game. Take it off ${team.name}, with every other game ${line.opponent} filed here by the name.`}
                      className="inline-flex min-h-6 items-center rounded px-1.5 text-xs font-bold text-red-600 hover:underline dark:text-red-400"
                    >
                      Not this team
                    </button>
                  )}
                  {ownRow && opponentRow && (
                    <WhatIfButton
                      open={whatIf === game.id}
                      onToggle={() => setWhatIf((open) => (open === game.id ? null : game.id))}
                      label={`${team.name} and ${line.opponent}`}
                    />
                  )}
                </span>
                {whatIf === game.id && ownRow && opponentRow && (
                  <div className="basis-full">
                    <WhatIf a={ownRow} b={opponentRow} />
                  </div>
                )}
                {clauses && (
                  // Each clause moves to the next line whole where it does not fit beside the one
                  // before, and wraps inside only where it is wider than the line itself. Kept on
                  // one line regardless (`whitespace-nowrap`), the longest clauses ran 423 px past
                  // the panel at 320 px wide, measured in Chromium. The dot after a clause is in
                  // its box, behind a non-breaking space, so no line opens on a dot or holds one
                  // alone.
                  <p className={`basis-full ${textRole.meta} tabular-nums`}>
                    {clauses.map((clause, at) => (
                      <Fragment key={at}>
                        {at > 0 && " "}
                        <span className="inline-block">
                          {at < clauses.length - 1 ? `${clause}\u00a0·` : clause}
                        </span>
                      </Fragment>
                    ))}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
