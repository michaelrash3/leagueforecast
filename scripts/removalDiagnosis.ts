/**
 * Why the clubs behind games won by a hundred or more are, or are not, taken off (sign H,
 * `obviousFakes.ts`), and what H at a lower line would take off: the two sections the
 * community-level sweep prints after its own, on the same loaded pool (`communityLevelSweep.ts`).
 *
 * Read only. It runs the nightly's sweep in memory (`sweepMarks`, `sweepVerdicts`) on the pool as
 * the nightly's sweep reads it, every stored year (`loadScoutGames`), against the marks as stored,
 * and saves nothing; and free of Node, so a test holds it to what it says on a made-up pool.
 *
 * Its report comes in two parts, as `describeCommunitySweep`'s does: lines that are numbers, days
 * and scores only, fit for this public repository's Actions log, and lines that name clubs, for a
 * reader allowed to see them.
 */
import { HUNDRED_MARGIN, type AutoRemovals, type AutoSign } from "../src/lib/autoRemoved.ts";
import {
  listersOf,
  reportedMargins,
  sweepMarks,
  sweepVerdicts,
  type SweepAnswers,
  type SweepVerdict,
} from "../src/lib/obviousFakes.ts";
import { poolHealthSummary } from "../src/lib/poolHealthSummary.ts";
import { removedClubIds } from "../src/lib/removedClubs.ts";
import { scheduleCommunities } from "../src/lib/scheduleCommunities.ts";
import { clubsByGcId } from "../src/lib/unrealClubs.ts";
import {
  ageGroupYear,
  ratedMargin,
  scheduleComponents,
  scoutFitRanks,
  scoutRatingGames,
  segmentOn,
  type AgeGroup,
  type ScoutGame,
  type ScoutTeam,
} from "../src/lib/teamRankings.ts";
import { pageNameOf, WELL_CONNECTED } from "./communitySweep.ts";

/** The lines a dry run of H is asked at, the shipped one last. */
export const DRY_LINES = [40, 50, 75, HUNDRED_MARGIN];
/** How many newly marked clubs the sample at the lowest line shows. */
export const SAMPLE_SIZE = 40;

/** A game somebody asked about by its day and score, either side first. */
export type AskedGame = { date: string; runs: readonly [number, number] };

/** The five games the owner's Pool health listed as unremoved on 26 October 2026. */
export const ASKED_GAMES: readonly AskedGame[] = [
  { date: "2025-09-22", runs: [820, 0] },
  { date: "2025-12-13", runs: [280, 0] },
  { date: "2026-06-17", runs: [101, 0] },
  { date: "2026-05-28", runs: [0, 100] },
  { date: "2026-07-02", runs: [22, 122] },
];

export type RemovalInput = {
  /** The pool as the nightly's sweep reads it: every stored year, archived seasons not among them. */
  ageGroups: AgeGroup[];
  teams: ScoutTeam[];
  games: ScoutGame[];
  answers: SweepAnswers;
  /** The marks as stored (`loadAutoRemoved`). */
  marks: AutoRemovals;
  today: string;
  /** The clubs a League Standings team links, or null where League was not read. */
  leagueLinked: ReadonlySet<string> | null;
  /** The archived seasons (`loadArchiveIndex`), which the pool does not hold. */
  archived: ReadonlyArray<{ id: string; ageLevel?: number; year?: number }>;
  /** Stored games per squad year (`storedGamesByYear`), which Pool health's summary reads. */
  storedByYear: { year: number | undefined; games: number }[];
  lines?: readonly number[];
  asked?: readonly AskedGame[];
};

const isPlayed = (game: ScoutGame) =>
  game.teamAScore !== undefined && game.teamBScore !== undefined;

/** The widest margin any record of a game gives: its score, side B's report, a folded row. */
const widestOf = (game: ScoutGame, reported: ReadonlyMap<string, number>): number => {
  let widest = isPlayed(game) ? Math.abs(game.teamAScore! - game.teamBScore!) : 0;
  if (game.reportedByB) {
    widest = Math.max(widest, Math.abs(game.reportedByB.teamAScore - game.reportedByB.teamBScore));
  }
  (game.alsoRows ?? []).forEach((row) => {
    if (row.ownScore !== undefined && row.opponentScore !== undefined) {
      widest = Math.max(widest, Math.abs(row.ownScore - row.opponentScore));
    }
  });
  reported.forEach((margin) => (widest = Math.max(widest, margin)));
  return widest;
};

/**
 * The GameChanger schedules that filed a game's score, as `filedBy` reads them, without its
 * fallback to both sides where none did: here "none" is the answer.
 */
const ownFilers = (game: ScoutGame): string[] => {
  const kept = new Set((game.alsoRows ?? []).map((record) => record.teamId));
  return [
    ...(game.source && !game.scoreFromB ? [game.source.teamId] : []),
    ...(game.alsoRows ?? [])
      .filter((record) => record.ownScore !== undefined)
      .map((record) => record.teamId),
    ...(game.alsoFrom ?? []).filter((schedule) => !kept.has(schedule)),
  ];
};

/** The clubs whose league has `WELL_CONNECTED` outside games or more, in any squad year stored. */
const wellConnectedClubs = (input: RemovalInput): Set<string> => {
  const well = new Set<string>();
  const years = new Map<number | undefined, string>();
  input.ageGroups.forEach((group) => {
    const year = ageGroupYear(group);
    if (!years.has(year) && scoutFitRanks(group.id, input.ageGroups)) years.set(year, group.id);
  });
  years.forEach((pageId) => {
    const rated = scoutRatingGames(
      pageId,
      input.teams,
      input.games,
      input.ageGroups,
      undefined,
      input.today
    );
    const ids = [...new Set(rated.flatMap(({ game }) => [game.teamAId, game.teamBId]))];
    const pairs = rated.map(({ game }) => [game.teamAId, game.teamBId] as [string, string]);
    const communities = scheduleCommunities(ids, pairs, scheduleComponents(ids, pairs));
    communities.of.forEach((community, id) => {
      if ((communities.outside[community] ?? 0) >= WELL_CONNECTED) well.add(id);
    });
  });
  return well;
};

/** One side of a game won by a hundred or more, and what the sweep makes of it. */
export type SideDiagnosis = {
  clubId: string;
  name: string;
  pulled: number;
  /** The widest margin this side's own schedule reported of the game, or undefined for none. */
  charged?: number;
  /** Its GameChanger ids marked as stored, with their signs; and how many it has. */
  marked: Array<{ signs: AutoSign[] }>;
  removed: boolean;
  /** Whatever keeps it, or stops H reading it; empty for a club H marks and nothing keeps. */
  reasons: string[];
  /** Whether the nightly's sweep, run now on this pool, would mark one of its ids not yet marked. */
  wouldMark: boolean;
};

export type HundredGame = {
  gameId: string;
  date?: string;
  score: string;
  pageName: string;
  year: number | undefined;
  /** Its squad year against the one being played: past, current, or ahead. */
  yearStatus: "past" | "current" | "ahead" | "none";
  archivedPage: boolean;
  scoreConfirmed?: number;
  /** Whose own schedules filed it, and which listed it, as a side's word: "A", "B", or "other". */
  filedBy: string[];
  listedBy: string[];
  /** Whether Pool health's list of games won by forty or more still holds it. */
  onPoolHealth: boolean;
  sides: [SideDiagnosis, SideDiagnosis];
};

export type LineClub = {
  clubId: string;
  name: string;
  gcIds: string[];
  pageName: string;
  year: number | undefined;
  corroborated: boolean;
  wellListed: boolean;
  alsoAt100: boolean;
  signs: AutoSign[];
  caught: Array<{ date?: string; score: string; side: "won" | "lost"; margin: number }>;
};

export type LineRun = {
  line: number;
  /** Clubs with an id newly marked beyond the stored marks, and beyond the shipped line's run. */
  clubs: LineClub[];
  beyondShipped: number;
};

export type RemovalDiagnosis = {
  currentYear: number;
  yearsStored: Array<{ year: number | undefined; games: number }>;
  archived: number;
  leagueRead: boolean;
  hundred: HundredGame[];
  asked: Array<{ asked: AskedGame; found: string[] }>;
  runs: LineRun[];
};

/** Runs both sections on the pool handed in. Saves nothing: every sweep here is in memory. */
export const runRemovalDiagnosis = (input: RemovalInput): RemovalDiagnosis => {
  const { teams, games, ageGroups, answers, marks, today } = input;
  const lines = input.lines ?? DRY_LINES;
  const currentYear = segmentOn(today).year;
  const clubOfGcId = clubsByGcId(teams);
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const groupById = new Map(ageGroups.map((group) => [group.id, group]));
  const pool = { teams, games, ageGroups };
  const leagueKept = input.leagueLinked ?? new Set<string>();
  const removed = removedClubIds(teams, ageGroups, marks, leagueKept);
  const mine = new Set(ageGroups.flatMap((group) => (group.myTeamId ? [group.myTeamId] : [])));
  const apart = new Set([...answers.keptApart].flatMap((key) => key.split("\u0000")));
  const vouched = new Set<string>();
  games.forEach((game) => {
    if (game.scoreConfirmed === undefined) return;
    vouched.add(game.teamAId);
    vouched.add(game.teamBId);
  });

  // The nightly's sweep at its own line, now, in memory: what it would add to the marks stored.
  const shipped = sweepMarks(pool, answers, marks, today);
  const shippedVerdicts = sweepVerdicts(pool, answers, today);
  const wouldMark = (team: ScoutTeam | undefined) =>
    (team?.gcTeams ?? []).some((link) => shipped.has(link.teamId) && !marks.has(link.teamId));

  const health = poolHealthSummary(
    { ageGroups, teams, games },
    today,
    input.storedByYear,
    marks,
    leagueKept
  );
  const onHealth = new Set(health.implausible.map(({ game }) => game.id));

  const sideWord = (game: ScoutGame, clubId: string) =>
    clubId === game.teamAId ? "A" : clubId === game.teamBId ? "B" : "other";

  const diagnose = (
    game: ScoutGame,
    clubId: string,
    charged: number | undefined
  ): SideDiagnosis => {
    const team = teamById.get(clubId);
    const links = team?.gcTeams ?? [];
    const ids = links.map((link) => link.teamId);
    const markedIds = ids.flatMap((id) => {
      const mark = marks.get(id);
      return mark ? [{ signs: mark.signs }] : [];
    });
    const reasons: string[] = [];
    if (!team) reasons.push("not on the roster at all");
    else if (links.length === 0) {
      reasons.push(
        team.nameOnly
          ? "not pulled: known only from another club's schedule, and the sweep judges pulled clubs alone"
          : team.placeholder
            ? "not pulled: a bracket slot, which the sweep never judges"
            : "not pulled: no GameChanger team, and the sweep judges pulled clubs alone"
      );
    }
    if (!isPlayed(game)) reasons.push("the game is not played (no score both sides)");
    if (game.scoreConfirmed !== undefined && game.scoreConfirmed === ratedMargin(game)) {
      reasons.push(`its score is vouched for (confirmed at ${game.scoreConfirmed})`);
    }
    if (charged === undefined) {
      const source = game.source?.teamId;
      const sourceClub = source === undefined ? undefined : clubOfGcId.get(source);
      reasons.push(
        source === undefined
          ? "its own schedule did not report it: the game came off no GameChanger schedule (typed, or a League Standings game)"
          : sourceClub === undefined
            ? "its own schedule did not report it: filed off a schedule no club in the pool carries now"
            : sourceClub === clubId && game.scoreFromB
              ? "its own schedule did not report it: the score kept is the other side's"
              : "its own schedule did not report it: only the other side's schedule did"
      );
    } else if (charged < HUNDRED_MARGIN) {
      reasons.push(`its own schedule reported it by ${charged}, under the line`);
    }
    if (answers.realClubs.has(clubId) || ids.some((id) => answers.realClubs.has(id))) {
      reasons.push("kept: said to be real (realClubs)");
    }
    if (mine.has(clubId)) reasons.push("kept: a page's own team (mine)");
    if (ids.some((id) => apart.has(id))) reasons.push("kept: in a pair kept apart (keptApart)");
    if (ids.some((id) => answers.namedAges.has(id))) {
      reasons.push("kept: an age named for it (namedAges)");
    }
    if (vouched.has(clubId)) {
      reasons.push("kept: a score of one of its games is vouched for (vouched)");
    }
    if (input.leagueLinked?.has(clubId)) {
      reasons.push(
        "a League Standings team links it (leagueKept): marked or not, the boards and Pool health keep it"
      );
    }
    if (markedIds.length > 0 && markedIds.length < ids.length) {
      reasons.push(
        `marked under ${markedIds.length} of its ${ids.length} GameChanger ids, so it stands`
      );
    }
    const verdict = shippedVerdicts.get(clubId);
    if (verdict && verdict.signs.includes("hundred") && !verdict.kept && markedIds.length === 0) {
      reasons.push("shows H and nothing keeps it: the sweep would mark it now");
    }
    const newly = [
      ...new Set(ids.flatMap((id) => (marks.has(id) ? [] : (shipped.get(id)?.signs ?? [])))),
    ];
    if (newly.length > 0) reasons.push(`the sweep run now marks it, for ${newly.join("+")}`);
    return {
      clubId,
      name: team?.name ?? clubId,
      pulled: links.length,
      ...(charged === undefined ? {} : { charged }),
      marked: markedIds,
      removed: removed.has(clubId),
      reasons,
      wouldMark: wouldMark(team),
    };
  };

  const archivedPages = new Set(input.archived.map((entry) => entry.id));
  const archivedLevels = new Set(
    input.archived.map((entry) => `${entry.ageLevel ?? "?"}/${entry.year ?? "?"}`)
  );
  const hundred: HundredGame[] = games.flatMap((game) => {
    const reported = reportedMargins(game, clubOfGcId);
    if (widestOf(game, reported) < HUNDRED_MARGIN) return [];
    const group = groupById.get(game.ageGroupId);
    const year = ageGroupYear(group);
    const listers = listersOf(game, clubOfGcId);
    return [
      {
        gameId: game.id,
        ...(game.date === undefined ? {} : { date: game.date }),
        score: isPlayed(game) ? `${game.teamAScore}-${game.teamBScore}` : "unscored",
        pageName: group ? pageNameOf(group) : "a page the pool does not hold",
        year,
        yearStatus:
          year === undefined
            ? "none"
            : year < currentYear
              ? "past"
              : year === currentYear
                ? "current"
                : "ahead",
        archivedPage:
          archivedPages.has(game.ageGroupId) ||
          archivedLevels.has(`${group?.ageLevel ?? "?"}/${year ?? "?"}`),
        ...(game.scoreConfirmed === undefined ? {} : { scoreConfirmed: game.scoreConfirmed }),
        filedBy: ownFilers(game).map((gcId) => {
          const club = clubOfGcId.get(gcId);
          return club === undefined ? "a schedule no club carries" : sideWord(game, club);
        }),
        listedBy: [...listers].map((id) => sideWord(game, id)),
        onPoolHealth: onHealth.has(game.id),
        sides: [
          diagnose(game, game.teamAId, reported.get(game.teamAId)),
          diagnose(game, game.teamBId, reported.get(game.teamBId)),
        ],
      },
    ];
  });

  const asked = (input.asked ?? ASKED_GAMES).map((entry) => ({
    asked: entry,
    found: games
      .filter(
        (game) =>
          game.date === entry.date &&
          isPlayed(game) &&
          ((game.teamAScore === entry.runs[0] && game.teamBScore === entry.runs[1]) ||
            (game.teamAScore === entry.runs[1] && game.teamBScore === entry.runs[0]))
      )
      .map((game) => game.id),
  }));

  // The dry runs: each line's sweep against the marks as stored, and what it adds to them.
  const well = wellConnectedClubs(input);
  const gamesOf = new Map<string, ScoutGame[]>();
  games.forEach((game) => {
    [game.teamAId, game.teamBId].forEach((id) => {
      const held = gamesOf.get(id);
      if (held) held.push(game);
      else gamesOf.set(id, [game]);
    });
  });
  const gameById = new Map(games.map((game) => [game.id, game]));
  const newlyMarked = (next: AutoRemovals): Map<string, AutoSign[]> => {
    const clubs = new Map<string, AutoSign[]>();
    next.forEach((mark, gcId) => {
      if (marks.has(gcId)) return;
      const clubId = clubOfGcId.get(gcId);
      if (clubId === undefined) return;
      const signs = new Set([...(clubs.get(clubId) ?? []), ...mark.signs]);
      clubs.set(clubId, [...signs]);
    });
    return clubs;
  };
  const atShipped = newlyMarked(shipped);
  const runs: LineRun[] = lines.map((line) => {
    const next =
      line === HUNDRED_MARGIN
        ? shipped
        : sweepMarks(pool, answers, marks, today, { hundredLine: line });
    const verdicts: Map<string, SweepVerdict> =
      line === HUNDRED_MARGIN
        ? shippedVerdicts
        : sweepVerdicts(pool, answers, today, { hundredLine: line });
    const clubs: LineClub[] = [...newlyMarked(next)].map(([clubId, signs]) => {
      const team = teamById.get(clubId);
      const links = team?.gcTeams ?? [];
      const group = groupById.get(links[0]?.ageGroupId ?? "");
      const verdict = verdicts.get(clubId);
      const wellListed = (gamesOf.get(clubId) ?? []).some((game) =>
        [...listersOf(game, clubOfGcId)].some((lister) => lister !== clubId && well.has(lister))
      );
      return {
        clubId,
        name: team?.name ?? clubId,
        gcIds: links.map((link) => link.teamId),
        pageName: group ? pageNameOf(group) : "no page",
        year: ageGroupYear(group),
        corroborated: verdict?.corroborated ?? false,
        wellListed,
        alsoAt100: atShipped.has(clubId),
        signs,
        caught: (verdict?.reported ?? []).flatMap((win) => {
          const game = gameById.get(win.gameId);
          if (!game) return [];
          const seen = game.teamAId === clubId ? 1 : -1;
          const margin = ((game.teamAScore ?? 0) - (game.teamBScore ?? 0)) * seen;
          return [
            {
              ...(game.date === undefined ? {} : { date: game.date }),
              score: `${game.teamAScore ?? "?"}-${game.teamBScore ?? "?"}`,
              side: margin >= 0 ? ("won" as const) : ("lost" as const),
              margin: win.margin,
            },
          ];
        }),
      };
    });
    return { line, clubs, beyondShipped: clubs.filter((club) => !club.alsoAt100).length };
  });

  const yearsStored = input.storedByYear
    .map(({ year, games: count }) => ({ year, games: count }))
    .sort((a, b) => (a.year ?? 0) - (b.year ?? 0));
  return {
    currentYear,
    yearsStored,
    archived: input.archived.length,
    leagueRead: input.leagueLinked !== null,
    hundred,
    asked,
    runs,
  };
};

const tally = (values: readonly string[]): string => {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value, count]) => `${value} ${count}`)
    .join(", ");
};

/** Riskiest first: the clubs a witness or a well-connected club vouches for are the ones to check. */
const riskiest = (a: LineClub, b: LineClub): number =>
  Number(b.corroborated && b.wellListed) - Number(a.corroborated && a.wellListed) ||
  Number(b.corroborated) - Number(a.corroborated) ||
  Number(b.wellListed) - Number(a.wellListed) ||
  (b.year ?? 0) - (a.year ?? 0) ||
  a.pageName.localeCompare(b.pageName) ||
  (a.clubId < b.clubId ? -1 : a.clubId > b.clubId ? 1 : 0);

/** The report: `lines` numbers, days and scores only; `named` with the clubs' names and ids. */
export const describeRemovalDiagnosis = (
  found: RemovalDiagnosis
): { lines: string[]; named: string[] } => {
  const lines: string[] = [];
  const named: string[] = [];
  const say = (line = "") => lines.push(line);
  say(
    `H, a game won by ${HUNDRED_MARGIN} or more on a club's own schedule: why each is or is not taken off.`
  );
  say(
    `The squad year being played is ${found.currentYear}. The nightly's sweep reads every stored year` +
      ` (loadScoutGames), archived seasons never: stored here ${found.yearsStored
        .map(({ year, games }) => `${year ?? "no year"} ${games} games`)
        .join(", ")}; ${found.archived} archived season(s) not in the pool.`
  );
  if (!found.leagueRead) {
    say("  League Standings was not read, so no club is shown as kept by a League link.");
  }
  say();
  found.asked.forEach(({ asked, found: ids }, at) =>
    say(
      `  asked ${at + 1}: ${asked.runs[0]}-${asked.runs[1]} on ${asked.date}: ` +
        (ids.length === 0 ? "not in this pool" : `in the pool (${ids.length} row(s))`)
    )
  );
  say();
  say(
    `${found.hundred.length} game(s) in the pool won by ${HUNDRED_MARGIN} or more on some record of them:`
  );
  found.hundred.forEach((game, at) => {
    say(
      `  ${at + 1}. ${game.score} on ${game.date ?? "no day"}, ${game.pageName} (squad year` +
        ` ${game.year ?? "none"}, ${game.yearStatus}${game.archivedPage ? ", its page archived" : ""})` +
        `${game.scoreConfirmed === undefined ? "" : `, confirmed at ${game.scoreConfirmed}`};` +
        ` filed by ${game.filedBy.join("+") || "no schedule"}, listed by ${game.listedBy.join("+") || "none"};` +
        ` ${game.onPoolHealth ? "still on Pool health's list" : "not on Pool health's list"}`
    );
    named.push(
      `  ${at + 1}. ${game.score} on ${game.date ?? "no day"} (${game.gameId}), ${game.pageName}`
    );
    game.sides.forEach((side, index) => {
      const marks =
        side.marked.length === 0
          ? "no id marked"
          : side.marked.map((mark) => mark.signs.join("+")).join("; ");
      say(
        `     side ${index === 0 ? "A" : "B"}: ${side.pulled > 0 ? `pulled (${side.pulled} GameChanger id(s))` : "not pulled"},` +
          ` its own schedule charged ${side.charged === undefined ? "nothing" : side.charged}, ${marks},` +
          ` ${side.removed ? "taken off" : "on the boards"}${side.wouldMark ? ", the sweep would mark it now" : ""}`
      );
      side.reasons.forEach((reason) => say(`       - ${reason}`));
      named.push(`     side ${index === 0 ? "A" : "B"}: ${side.name} (${side.clubId})`);
    });
  });

  say();
  say("H at a lower line, run now in memory against the marks as stored (nothing saved):");
  found.runs.forEach((run) => {
    const clubs = run.clubs;
    say(
      `  at ${run.line}: ${clubs.length} club(s) newly marked beyond the stored marks` +
        (run.line === HUNDRED_MARGIN
          ? " (the shipped line, as tonight's sweep would)"
          : `, ${run.beyondShipped} beyond the shipped line's`) +
        `; ${clubs.filter((club) => club.corroborated).length} corroborated by a real opponent's schedule,` +
        ` ${clubs.filter((club) => club.wellListed).length} with a game listed by a well-connected club` +
        ` (league of ${WELL_CONNECTED}+ outside games)`
    );
    if (clubs.length === 0) return;
    say(`     by squad year: ${tally(clubs.map((club) => String(club.year ?? "none")))}`);
    say(`     by page: ${tally(clubs.map((club) => club.pageName))}`);
    say(`     by signs: ${tally(clubs.map((club) => club.signs.join("+")))}`);
  });
  const lowest = found.runs[0];
  if (lowest && lowest.clubs.length > 0) {
    const sample = [...lowest.clubs].sort(riskiest).slice(0, SAMPLE_SIZE);
    say();
    say(
      `A sample of ${sample.length} of the ${lowest.clubs.length} newly marked at ${lowest.line}, those a` +
        " witness or a well-connected club vouches for first (names in the sealed report):"
    );
    sample.forEach((club, at) => {
      const caught = club.caught
        .map(
          (game) =>
            `${game.date ?? "no day"} ${game.score} (its own schedule, ${game.side} by ${game.margin})`
        )
        .join("; ");
      const flags = [
        club.corroborated ? "corroborated" : "",
        club.wellListed ? "listed by a well-connected club" : "",
        club.alsoAt100 ? "the shipped line marks it too" : "",
      ].filter(Boolean);
      say(
        `  ${padNumber(at + 1)} ${club.pageName} (${club.year ?? "no year"})` +
          `${flags.length > 0 ? `, ${flags.join(", ")}` : ""}: ${caught || club.signs.join("+")}`
      );
      named.push(
        `  ${padNumber(at + 1)} ${club.name} (${club.clubId}; ${club.gcIds.join(", ")}), ${club.pageName}`
      );
    });
  }
  return { lines, named };
};

const padNumber = (value: number) => `${value}.`.padStart(4);
