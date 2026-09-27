import { describe, expect, it } from "vitest";
import {
  dedupeLeagueFixtures,
  leagueCopiesFiledAgainstNobody,
  leagueStandIns,
  pairKeyOf,
  type ScoutGame,
  type ScoutTeam,
} from "../teamRankings";
import { isScoutGamePlayed } from "../teamRankings/types";
import { normalizeDateInput } from "../date";

/*
 * The collapse of league games and their pulled copies, to the row, on random pools.
 *
 * It keyed every row of the pool by fixture — a date read and a string built for each of a
 * quarter of a million rows, twice on every open — when only a row between two clubs a league row
 * names can share a fixture with one. `before` is the pass as it stood, verbatim; the change must
 * drop exactly the rows it dropped.
 */
const before = (games: ScoutGame[], roster?: Parameters<typeof dedupeLeagueFixtures>[1]) => {
  const fixtureKeyOf = (game: ScoutGame): string => {
    const day = normalizeDateInput(game.date ?? "");
    return day ? `${game.ageGroupId}|${pairKeyOf(game)}|${day}` : "";
  };
  const byFixture = new Map<string, { league: number[]; stored: number[] }>();
  games.forEach((game, index) => {
    const key = fixtureKeyOf(game);
    if (!key) return;
    let bucket = byFixture.get(key);
    if (!bucket) {
      bucket = { league: [], stored: [] };
      byFixture.set(key, bucket);
    }
    (game.id.startsWith("league_") ? bucket.league : bucket.stored).push(index);
  });
  const dropped = new Set<number>();
  byFixture.forEach(({ league, stored }) => {
    if (league.length === 0 || stored.length === 0) return;
    if (league.every((index) => isScoutGamePlayed(games[index]!))) {
      stored.forEach((index) => dropped.add(index));
      return;
    }
    const emptiestFirst = league
      .slice()
      .sort((a, b) => Number(isScoutGamePlayed(games[a]!)) - Number(isScoutGamePlayed(games[b]!)));
    emptiestFirst.slice(0, stored.length).forEach((index) => dropped.add(index));
  });
  if (roster) {
    leagueCopiesFiledAgainstNobody(games, roster, dropped).forEach((index) => dropped.add(index));
  }
  if (dropped.size === 0) return games;
  return games.filter((_, index) => !dropped.has(index));
};

/** A seeded pool: league rows, pulled copies, slots, stand-ins, doubleheaders, two date forms. */
const randomPool = (seed: number) => {
  let state = seed;
  const random = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
  const clubs = ["S-A", "S-B", "S-C", "S-D", "S-E", "S-F"];
  const teams: ScoutTeam[] = [
    ...clubs.map((id) => ({
      id,
      name: `Club ${id}`,
      gcTeams: [{ teamId: `gc${id}`, name: `Club ${id}`, ageGroupId: "ag9" }],
    })),
    { id: "S-TBD", name: "TBD- 09/25/26, 7:15 PM", placeholder: true },
    { id: "S-A-SI", name: "Club S-A", nameOnly: true },
  ];
  const sides = [...clubs, "S-TBD", "S-A-SI"];
  const days = [5, 6, 12, 13];
  const games: ScoutGame[] = [];
  const rows = 10 + Math.floor(random() * 30);
  for (let n = 0; n < rows; n += 1) {
    const league = random() < 0.3;
    const a = pick(league ? clubs : sides);
    let b = pick(league ? clubs : sides);
    if (b === a) b = a === "S-A" ? "S-B" : "S-A";
    const day = pick(days);
    const scored = random() < 0.75;
    const source = !league && random() < 0.7 ? pick([a, b]) : undefined;
    games.push({
      id: league ? `league_default_m${n}` : `gc_${n}`,
      ageGroupId: random() < 0.85 ? "ag9" : "ag10",
      teamAId: a,
      teamBId: b,
      date: random() < 0.05 ? "" : league ? `9/${day}` : `2026-09-${String(day).padStart(2, "0")}`,
      ...(scored
        ? { teamAScore: Math.floor(random() * 4), teamBScore: Math.floor(random() * 4) }
        : {}),
      ...(source
        ? { source: { kind: "gamechanger" as const, teamId: `gc${source}`, gameId: `${n}` } }
        : {}),
    });
  }
  return { teams, games };
};

describe("the league collapse", () => {
  it("drops exactly the rows it dropped before, on four thousand random pools", () => {
    let collapsed = 0;
    for (let seed = 1; seed <= 4000; seed += 1) {
      const { teams, games } = randomPool(seed);
      const roster = leagueStandIns(teams);
      const now = dedupeLeagueFixtures(games, roster);
      expect(now, `seed ${seed}`).toEqual(before(games, roster));
      expect(dedupeLeagueFixtures(games), `seed ${seed}`).toEqual(before(games));
      if (now.length < games.length) collapsed += 1;
    }
    // The pools are worth something: most of them have a copy to collapse.
    expect(collapsed).toBeGreaterThan(2000);
  });

  it("hands back the pool itself when no league row is in it", () => {
    const { games } = randomPool(7);
    const stored = games.filter((game) => !game.id.startsWith("league_"));
    expect(dedupeLeagueFixtures(stored)).toBe(stored);
  });
});
