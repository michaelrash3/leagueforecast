/**
 * The pool the community-level sweep runs on when it is handed no backup and no cloud copy
 * (`communityLevelSweep.ts --synthetic`): the seeded pool (`poolFixture`), with the Longhorns'
 * closed league planted on its 9U 2027 page (`plantClosedLeague`), each game filed off a schedule,
 * and a handful of games won by forty to a hundred and fifty planted for the removal sections to
 * find, each shaped like one way the sign H can or cannot reach a club. Made-up clubs throughout.
 */
import type { AutoRemoval } from "../src/lib/autoRemoved.ts";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../src/lib/teamRankings.ts";
import { plantClosedLeague, type PlantedLeague } from "./closedLeagueFixture.ts";
import { mulberry32, poolFixture, type FixtureSeason } from "./poolFixture.ts";

export type SweepFixture = {
  today: string;
  ageGroups: AgeGroup[];
  teams: ScoutTeam[];
  games: ScoutGame[];
  seasons: Record<string, FixtureSeason>;
  /** Marks as a nightly would have stored them, and the clubs said to be real. */
  marks: AutoRemoval[];
  realClubs: string[];
  league: PlantedLeague;
};

const PAGE_9U = "ag_9u_2027";

/**
 * The seeded pool made ready for the sweep. Every scored game between pulled clubs is filed off
 * side A's schedule, and listed by side B's for two in three of them, so the witness test has
 * schedules to read, as a real pool does; the fixture itself files none.
 */
export const sweepFixture = ({
  seed = 7,
  clubsPerPage = 300,
}: { seed?: number; clubsPerPage?: number } = {}): SweepFixture => {
  const fixture = poolFixture({ seed, clubsPerPage });
  const random = mulberry32(seed + 1000);
  const teamById = new Map(fixture.teams.map((team) => [team.id, team]));
  const gcOf = (id: string) => teamById.get(id)?.gcTeams?.[0]?.teamId;
  let serial = 0;
  const games: ScoutGame[] = fixture.games.map((game) => {
    const a = gcOf(game.teamAId);
    if (a === undefined || game.teamAScore === undefined) return game;
    const b = gcOf(game.teamBId);
    return {
      ...game,
      source: { kind: "gamechanger", teamId: a, gameId: `fx${(serial += 1)}` },
      ...(b !== undefined && random() < 2 / 3 ? { alsoFrom: [b] } : {}),
    };
  });

  // The Longhorns' league, losing its one outside game to the 9U page's busiest pulled club.
  const played = new Map<string, number>();
  games.forEach((game) =>
    [game.teamAId, game.teamBId].forEach((id) => played.set(id, (played.get(id) ?? 0) + 1))
  );
  const outsider = fixture.teams
    .filter((team) => team.gcTeams?.some((link) => link.ageGroupId === PAGE_9U))
    .sort((a, b) => (played.get(b.id) ?? 0) - (played.get(a.id) ?? 0))[0]!;
  const planted = plantClosedLeague({ seed: seed + 1, page: PAGE_9U, outsider: outsider.id });

  // Games for the removal sections, on pulled clubs of last year's 9U page and this year's 10U.
  const pulledOn = (page: string) =>
    fixture.teams.filter((team) => team.gcTeams?.some((link) => link.ageGroupId === page));
  const lastYear = pulledOn("ag_9u_2026");
  const thisYear = pulledOn("ag_10u_2027");
  const odd: ScoutGame[] = [];
  const filed = (
    id: string,
    page: string,
    winner: ScoutTeam,
    loser: ScoutTeam,
    runs: readonly [number, number],
    date: string,
    filer: ScoutTeam | null,
    more: Partial<ScoutGame> = {}
  ) =>
    odd.push({
      id,
      ageGroupId: page,
      teamAId: winner.id,
      teamBId: loser.id,
      teamAScore: runs[0],
      teamBScore: runs[1],
      date,
      ...(filer
        ? { source: { kind: "gamechanger", teamId: filer.gcTeams![0]!.teamId, gameId: `r-${id}` } }
        : {}),
      ...more,
    });
  const [w1, l1, w2, l2, w3, l3, w4, l4, w5, l5] = lastYear;
  // Reported by the winner's own schedule, nothing keeping it: the sweep would mark it now.
  filed("odd-120", "ag_9u_2026", w1!, l1!, [121, 1], "2026-05-10", w1!);
  // Reported by the loser's own schedule and already marked for it.
  filed("odd-150", "ag_9u_2026", w2!, l2!, [150, 0], "2026-04-18", l2!);
  // Typed in by hand, off no schedule: H charges nobody.
  filed("odd-101", "ag_9u_2026", w3!, l3!, [101, 0], "2026-06-17", null);
  // Vouched for at its margin.
  filed("odd-100", "ag_9u_2026", w4!, l4!, [100, 0], "2026-05-28", w4!, { scoreConfirmed: 100 });
  // Reported by a club said to be real.
  filed("odd-130", "ag_9u_2026", w5!, l5!, [132, 2], "2026-03-30", w5!);
  // This year, under a hundred: what only a lower line reaches.
  thisYear.slice(0, 12).forEach((club, at) => {
    const loser = thisYear[20 + at]!;
    const runs: readonly [number, number] = [41 + 3 * at, 1];
    filed(`odd-low${at}`, "ag_10u_2027", club, loser, runs, `2026-10-${10 + at}`, club);
  });

  const marks: AutoRemoval[] = (l2!.gcTeams ?? []).map((link) => ({
    gcTeamId: link.teamId,
    name: l2!.name,
    on: "2026-10-01",
    signs: ["hundred"],
    reported: [{ gameId: "odd-150", margin: 150, date: "2026-04-18" }],
  }));
  return {
    today: fixture.today,
    ageGroups: fixture.ageGroups,
    teams: [...fixture.teams, ...planted.teams],
    games: [...games, ...planted.games, ...odd],
    seasons: fixture.seasons,
    marks,
    realClubs: [w5!.gcTeams![0]!.teamId],
    league: planted.league,
  };
};
