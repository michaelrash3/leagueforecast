import {
  refileStandIns,
  SHIPPED_TIDY_RULES,
  type GcImportState,
  type RefileRefusal,
} from "./gameChangerImport";
import { NO_REFUSALS, type NotThisTeam } from "./notThisTeam";
import { standInReport } from "./standInReport";
import {
  ageGroupLevel,
  ageGroupYear,
  isScoutGamePlayed,
  teamNameKey,
  type ScoutTeam,
} from "./teamRankings";

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

/** One club of a name, as `oneNameRows` lists it, nameless. */
export type NamedClubLine = {
  kind: "pulled" | "stand-in" | "slot" | "typed";
  state: string | undefined;
  /** The levels its GameChanger links are listed at in the squad year. */
  levels: (number | undefined)[];
  /** Its games in the squad year, and the first day of a row of its own schedules there. */
  games: number;
  firstOwnDay: string | undefined;
  /** When its schedules were last pulled, the latest of its links' stamps, and how many links. */
  lastPulled: string | undefined;
  links: number;
};

/** One row a pulled club's schedule filed against a stand-in of the name, and what the refile says. */
export type NamedRowLine = {
  date: string | undefined;
  pageLevel: number | undefined;
  typedLevel: number | undefined;
  namerState: string | undefined;
  played: boolean;
  why: string;
};

/**
 * Every club of one name in a squad year, and every row a pulled club's schedule filed against a
 * stand-in of it with the refile's reasons for leaving it there: one club's case read on the whole
 * pool, without the name. `matches` picks the name by its key (`teamNameKey`), so a caller can
 * pass a digest of it and keep the name out of a public log.
 */
export const oneNameRows = (
  state: GcImportState,
  year: number,
  matches: (key: string) => boolean,
  refused: NotThisTeam = NO_REFUSALS
): { clubs: NamedClubLine[]; rows: NamedRowLine[] } => {
  const yearOf = new Map(state.ageGroups.map((group) => [group.id, ageGroupYear(group)]));
  const levelOf = new Map(state.ageGroups.map((group) => [group.id, ageGroupLevel(group)]));
  const ofName = state.teams.filter((team) => matches(teamNameKey(team.name)));
  const ids = new Set(ofName.map((team) => team.id));
  const yearGames = state.games.filter((game) => yearOf.get(game.ageGroupId) === year);
  const byId = new Map(state.teams.map((team) => [team.id, team]));
  const clubs = ofName.map((team): NamedClubLine => {
    const own = new Set((team.gcTeams ?? []).map((link) => link.teamId));
    const played = yearGames.filter((game) => game.teamAId === team.id || game.teamBId === team.id);
    const ownDays = played
      .filter(
        (game) =>
          (game.source !== undefined && own.has(game.source.teamId)) ||
          (game.alsoFrom ?? []).some((id) => own.has(id))
      )
      .flatMap((game) => (game.date ? [game.date] : []))
      .sort();
    return {
      kind: team.placeholder
        ? "slot"
        : team.nameOnly
          ? "stand-in"
          : team.gcTeams?.length
            ? "pulled"
            : "typed",
      state: team.state,
      levels: (team.gcTeams ?? [])
        .filter((link) => yearOf.get(link.ageGroupId) === year)
        .map((link) => link.ageLevel),
      games: played.length,
      firstOwnDay: ownDays[0],
      lastPulled: (team.gcTeams ?? [])
        .flatMap((link) => (link.importedAt ? [link.importedAt] : []))
        .sort()
        .reverse()[0],
      links: team.gcTeams?.length ?? 0,
    };
  });
  const reasons = new Map<string, string>();
  refileStandIns(state, refused, SHIPPED_TIDY_RULES, (game, why) => {
    if (ids.has(game.teamAId) || ids.has(game.teamBId)) reasons.set(game.id, reasonKey(why));
  });
  const rows = yearGames.flatMap((game): NamedRowLine[] => {
    const side = [game.teamAId, game.teamBId].findIndex(
      (id) => ids.has(id) && byId.get(id)?.nameOnly === true
    );
    if (side < 0) return [];
    const namer = byId.get(side === 0 ? game.teamBId : game.teamAId);
    if (!namer?.gcTeams?.length) return [];
    return [
      {
        date: game.date,
        pageLevel: levelOf.get(game.ageGroupId),
        typedLevel: side === 0 ? game.ageLevelA : game.ageLevelB,
        namerState: namer.state,
        played: isScoutGamePlayed(game),
        why: reasons.get(game.id) ?? "would move",
      },
    ];
  });
  rows.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  return { clubs, rows };
};

/** `oneNameRows` in words, nameless, for a public log. */
export const oneNameLines = (found: { clubs: NamedClubLine[]; rows: NamedRowLine[] }): string[] => [
  `Clubs of the name in the squad year: ${found.clubs.length}`,
  ...found.clubs.map(
    (club) =>
      `  ${club.kind}, ${club.state ?? "no state"}, listed at ${
        club.levels.map((at) => (at === undefined ? "?" : `${at}U`)).join(", ") || "nothing"
      }; ${club.games} games, first own day ${club.firstOwnDay ?? "none"}; ${club.links} link(s), last pulled ${club.lastPulled ?? "never"}`
  ),
  `Rows pulled clubs' schedules filed against a stand-in of the name: ${found.rows.length}`,
  ...found.rows.map(
    (row) =>
      `  ${row.date ?? "no date"} on the ${row.pageLevel ?? "?"}U page${
        row.typedLevel === undefined ? "" : `, typed ${row.typedLevel}U`
      }, named from ${row.namerState ?? "no state"}${row.played ? ", played" : ""}: ${row.why}`
  ),
];
