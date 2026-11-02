import {
  refileStandIns,
  SHIPPED_TIDY_RULES,
  type GcImportState,
  type RefileRefusal,
} from "./gameChangerImport";
import { NO_REFUSALS, type NotThisTeam } from "./notThisTeam";
import { standInReport } from "./standInReport";
import { ageGroupLevel, ageGroupYear, isScoutGamePlayed, type ScoutTeam } from "./teamRankings";

/**
 * Why the stand-ins the nightly calls "should have joined" were not: the clubs known only by name
 * with one pulled club of the name on a page they played on, in a state of the clubs naming them
 * (`standInReport`'s `oneSameState`), read row by row through the refile as the tidy runs it
 * (`refileStandIns`, its `explain`), each row counted under the reasons the two name rules gave.
 *
 * The owner, 2 November 2026: River City Raptors of Hebron, Kentucky, 11U, showed 16 games where
 * they played 23, the other 7 on a stand-in of their very name at their level. The nightly of that
 * morning counted 3,047 such stand-ins holding 5,571 games, and nothing said which test held them.
 *
 * Where both rules found no club at all, the report's candidate is read for why: it has no
 * GameChanger link in the row's squad year, it is listed only at other levels than the row's (the
 * report reads a club's page by the games on it, the refile by the levels its links are listed at),
 * or it is in another state than the namer's.
 */
export type UnjoinedReasons = {
  /** The stand-ins counted, and the rows of theirs a pulled club's schedule wrote. */
  standIns: number;
  rows: number;
  played: number;
  /** Rows the refile never reads: the club on the other side is not pulled either. */
  namerNotPulled: number;
  /** Rows the refile would move now: the pool was not at the tidy's fixed point. */
  wouldMove: number;
  /** Each reason pair (`inState | namesake`, and `refused`), with its rows and played rows. */
  reasons: { key: string; rows: number; played: number }[];
  /** Where neither rule found a club: what the report's candidate is, against the row. */
  noneWhy: { key: string; rows: number }[];
};

const reasonKey = (why: RefileRefusal): string =>
  `${why.inState ?? "picked"} | ${why.namesake ?? "-"}${why.refused ? " | refused" : ""}`;

const tally = <T extends { rows: number }>(into: Map<string, T>, key: string, make: () => T) => {
  const found = into.get(key) ?? make();
  into.set(key, found);
  return found;
};

export const unjoinedReasons = (
  state: GcImportState,
  year: number,
  refused: NotThisTeam = NO_REFUSALS
): UnjoinedReasons => {
  const report = standInReport(state.teams, state.games, state.ageGroups, year, Infinity);
  const candidateOf = new Map(
    report.topWhy.oneSameState.flatMap((club) =>
      club.candidate ? [[club.teamId, club.candidate.teamId] as const] : []
    )
  );
  const byId = new Map(state.teams.map((team) => [team.id, team]));
  const levelOf = new Map(state.ageGroups.map((group) => [group.id, ageGroupLevel(group)]));
  const yearOf = new Map(state.ageGroups.map((group) => [group.id, ageGroupYear(group)]));
  // The squad year is the pool, as the import keys it.
  const poolKeyOf = (ageGroupId: string) => {
    const at = yearOf.get(ageGroupId);
    return at === undefined ? `g:${ageGroupId}` : `y:${at}`;
  };
  const isPulled = (team: ScoutTeam | undefined) => (team?.gcTeams?.length ?? 0) > 0;

  let rows = 0;
  let played = 0;
  let namerNotPulled = 0;
  state.games.forEach((game) => {
    if (yearOf.get(game.ageGroupId) !== year) return;
    const standIn = candidateOf.has(game.teamAId)
      ? game.teamAId
      : candidateOf.has(game.teamBId)
        ? game.teamBId
        : undefined;
    if (standIn === undefined) return;
    const other = byId.get(standIn === game.teamAId ? game.teamBId : game.teamAId);
    if (other?.nameOnly || other?.placeholder) return;
    if (!isPulled(other)) {
      namerNotPulled += 1;
      return;
    }
    rows += 1;
    if (isScoutGamePlayed(game)) played += 1;
  });

  const reasons = new Map<string, { key: string; rows: number; played: number }>();
  const noneWhy = new Map<string, { key: string; rows: number }>();
  let explained = 0;
  refileStandIns(state, refused, SHIPPED_TIDY_RULES, (game, why) => {
    if (yearOf.get(game.ageGroupId) !== year) return;
    const standInSide = candidateOf.has(game.teamAId)
      ? "A"
      : candidateOf.has(game.teamBId)
        ? "B"
        : undefined;
    if (!standInSide) return;
    explained += 1;
    const key = reasonKey(why);
    const entry = tally(reasons, key, () => ({ key, rows: 0, played: 0 }));
    entry.rows += 1;
    if (isScoutGamePlayed(game)) entry.played += 1;
    if (why.inState !== "none" || why.namesake !== "none") return;
    const standInId = standInSide === "A" ? game.teamAId : game.teamBId;
    const namer = byId.get(standInSide === "A" ? game.teamBId : game.teamAId);
    const candidate = byId.get(candidateOf.get(standInId) ?? "");
    const pool = poolKeyOf(game.ageGroupId);
    const level =
      (standInSide === "A" ? game.ageLevelA : game.ageLevelB) ?? levelOf.get(game.ageGroupId);
    const links = (candidate?.gcTeams ?? []).filter((link) => poolKeyOf(link.ageGroupId) === pool);
    const why2 = !candidate?.gcTeams?.length
      ? "candidate has no GameChanger link"
      : links.length === 0
        ? "candidate has no link in the squad year"
        : links.every((link) => link.ageLevel === undefined)
          ? "candidate's links carry no level"
          : !links.some((link) => link.ageLevel === level)
            ? `candidate listed ${[...new Set(links.map((link) => link.ageLevel))]
                .map((at) => (at === undefined ? "?" : at - (level ?? 0)))
                .sort()
                .join(",")} levels from the row`
            : candidate.state !== namer?.state
              ? candidate.state && namer?.state
                ? "candidate in another state than the namer"
                : "candidate or namer of no state"
              : "candidate fits: unexplained";
    tally(noneWhy, why2, () => ({ key: why2, rows: 0 })).rows += 1;
  });

  const byRows = <T extends { rows: number; key: string }>(map: Map<string, T>) =>
    [...map.values()].sort((a, b) => b.rows - a.rows || a.key.localeCompare(b.key));
  return {
    standIns: candidateOf.size,
    rows,
    played,
    namerNotPulled,
    wouldMove: rows - explained,
    reasons: byRows(reasons),
    noneWhy: byRows(noneWhy),
  };
};

/** The measurement in words, numbers only, for a public log. */
export const unjoinedReasonLines = (found: UnjoinedReasons): string[] => [
  `Stand-ins that should have joined: ${found.standIns}, holding ${found.rows} rows a pulled club's schedule wrote (${found.played} played).`,
  `  Rows whose namer is not pulled either, which the refile never reads: ${found.namerNotPulled}.`,
  `  Rows the refile would move now: ${found.wouldMove}.`,
  "  Rows left, by the in-state rule's reason | the namesake rule's:",
  ...found.reasons.map(
    (reason) => `    ${reason.key}: ${reason.rows} rows (${reason.played} played)`
  ),
  "  Where neither rule found a club, the report's candidate:",
  ...found.noneWhy.map((reason) => `    ${reason.key}: ${reason.rows} rows`),
];
