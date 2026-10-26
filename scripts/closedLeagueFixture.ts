/**
 * A league that plays only itself but for one blowout loss to a well-connected club, planted in a
 * pool: the shape of the owner's report of 26 October 2026, when the Longhorns of Edgewood, Kentucky
 * (9U 2027) stood +6.2 and second in their state on a 9-0 record against their own league alone,
 * whose one game against anybody else was a rout the other way. Made-up clubs, a made-up league;
 * only the shape is the report's.
 *
 * What the results-aware league level (`resultsAwareLevels`) is tested against, and what the
 * community-level sweep plants in the seeded pool so it has a Longhorns to print on a run with no
 * backup (`scripts/communityLevelSweep.ts`). Drawn with the repository's generator
 * (`mulberry32`), so the same on every engine, and dated from integers, so not moved by the zone.
 *
 *   import { plantClosedLeague, connectedLeagues } from "./closedLeagueFixture.ts";
 */
import type { ScoutGame, ScoutTeam } from "../src/lib/teamRankings.ts";
import { mulberry32 } from "./poolFixture.ts";

/** Who the planted league's best club is, as the sweep looks it up. */
export const LONGHORNS = { name: "Longhorns", city: "Edgewood", state: "KY" } as const;

/** The planted league: its clubs, its best (unbeaten inside), and the side of the one rout. */
export type PlantedLeague = { ids: string[]; best: string; loser: string; outsider: string };

const pad = (value: number): string => String(value).padStart(2, "0");

/** Day `offset` after 1 August 2026, as an ISO day, from integers alone. */
export const augustDay = (offset: number): string => {
  const months = [31, 31, 30, 31, 30, 31];
  let day = offset;
  for (let month = 0; month < months.length; month += 1) {
    if (day < months[month]!) return `2026-${pad(8 + month)}-${pad(day + 1)}`;
    day -= months[month]!;
  }
  return "2027-01-31";
};

/** A normal draw, Box and Muller's, off the generator handed in. */
const normalOf = (random: () => number) => () =>
  Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());

/** A score whose margin is `margin`, never a tie: a tie is nudged to the side that leads. */
const scoreOf = (margin: number): Pick<ScoutGame, "teamAScore" | "teamBScore"> => {
  const runs = margin === 0 ? 1 : margin;
  return runs > 0
    ? { teamAScore: 3 + runs, teamBScore: 3 }
    : { teamAScore: 3, teamBScore: 3 - runs };
};

/**
 * A well-connected schedule on `page`: `leagues` leagues of `size` clubs from four states, each
 * playing a double round robin inside and `crossGames` games each against clubs of other leagues,
 * all between 15 August and 31 October 2026. League strengths lie within two runs of average, clubs
 * within one and a half of their league's; a margin is the strengths' difference and a normal error
 * of two and a half runs. The strongest club is returned, as the outsider a planted league can lose
 * to.
 */
export const connectedLeagues = ({
  seed,
  page,
  leagues = 24,
  size = 8,
  crossGames = 6,
}: {
  seed: number;
  page: string;
  leagues?: number;
  size?: number;
  crossGames?: number;
}): { teams: ScoutTeam[]; games: ScoutGame[]; strongest: string } => {
  const random = mulberry32(seed);
  const normal = normalOf(random);
  const states = ["KY", "OH", "IN", "TN"];
  const teams: ScoutTeam[] = [];
  const strength = new Map<string, number>();
  const members: string[][] = [];
  for (let league = 0; league < leagues; league += 1) {
    const mean = (random() - 0.5) * 4;
    const ids: string[] = [];
    for (let at = 0; at < size; at += 1) {
      const id = `CL-${league}-${at}`;
      teams.push({ id, name: `Core ${league}-${at}`, state: states[league % states.length]! });
      strength.set(id, mean + (random() - 0.5) * 3);
      ids.push(id);
    }
    members.push(ids);
  }
  const games: ScoutGame[] = [];
  const play = (a: string, b: string) => {
    const margin = Math.round(strength.get(a)! - strength.get(b)! + 2.5 * normal());
    games.push({
      id: `cg${games.length}`,
      ageGroupId: page,
      teamAId: a,
      teamBId: b,
      ...scoreOf(margin),
      date: augustDay(14 + Math.floor(random() * 77)),
    });
  };
  members.forEach((ids) =>
    ids.forEach((a, i) => ids.slice(i + 1).forEach((b) => [0, 1].forEach(() => play(a, b))))
  );
  members.forEach((ids, league) =>
    ids.forEach((a) => {
      for (let k = 0; k < crossGames; k += 1) {
        let other = Math.floor(random() * leagues);
        if (other === league) other = (other + 1) % leagues;
        play(a, members[other]![Math.floor(random() * size)]!);
      }
    })
  );
  let strongest = teams[0]!.id;
  strength.forEach((value, id) => {
    if (value > strength.get(strongest)!) strongest = id;
  });
  return { teams, games, strongest };
};

/**
 * Eight clubs of one Kentucky town on `page`, `LONGHORNS` the best of them, playing a double round
 * robin among themselves between 15 August and 31 October 2026 and nobody else, but for one game on
 * `routOn` that their fifth club loses 1-16 to `outsider`. The league is four runs below average
 * and its clubs four above to three below its middle, the Longhorns the four above, who win every
 * game; a margin is the strengths' difference and a normal error of two runs.
 */
export const plantClosedLeague = ({
  seed,
  page,
  outsider,
  routOn = "2026-09-05",
}: {
  seed: number;
  page: string;
  outsider: string;
  routOn?: string;
}): { teams: ScoutTeam[]; games: ScoutGame[]; league: PlantedLeague } => {
  const random = mulberry32(seed);
  const normal = normalOf(random);
  const offsets = [4, 2, 1, 0, 0, -1, -2, -3];
  const ids = offsets.map((_, at) => `LH-${at}`);
  const names = [
    LONGHORNS.name,
    "Bulldogs",
    "Hornets",
    "Rockets",
    "Owls",
    "Rams",
    "Wolves",
    "Foxes",
  ];
  const teams: ScoutTeam[] = ids.map((id, at) => ({
    id,
    name: names[at]!,
    state: LONGHORNS.state,
    city: LONGHORNS.city,
    gcTeams: [{ teamId: `GC${id}`, name: names[at]!, ageGroupId: page }],
  }));
  const strength = new Map(ids.map((id, at) => [id, -4 + offsets[at]!]));
  const games: ScoutGame[] = [];
  ids.forEach((a, i) =>
    ids.slice(i + 1).forEach((b) =>
      [0, 1].forEach(() => {
        let margin = Math.round(strength.get(a)! - strength.get(b)! + 2 * normal());
        // The Longhorns win every game, as the report's did.
        if (a === ids[0] && margin < 2) margin = 2;
        games.push({
          id: `lh${games.length}`,
          ageGroupId: page,
          teamAId: a,
          teamBId: b,
          ...scoreOf(margin),
          date: augustDay(14 + Math.floor(random() * 77)),
        });
      })
    )
  );
  const loser = ids[4]!;
  games.push({
    id: "lh-rout",
    ageGroupId: page,
    teamAId: loser,
    teamBId: outsider,
    teamAScore: 1,
    teamBScore: 16,
    date: routOn,
  });
  return { teams, games, league: { ids, best: ids[0]!, loser, outsider } };
};
