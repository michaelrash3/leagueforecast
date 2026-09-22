/**
 * The teams that already work, as a file — the tripwire population.
 *
 * `scripts/agelessSweep.ts` measures a candidate rule two ways. What it catches in the backlog is
 * the easy half, and it flatters every rule ever written, because a rule is only ever tried
 * against the teams it was written for. The half that matters is what it catches among the teams
 * the pool already ranks: every one of those has an age and is connected to the rest of the pool,
 * so a rule firing on one is either about to eat a working club or about to relabel a team that
 * is already correctly filed. That is the closest thing to a false-positive rate available
 * without ground truth, and there is no way to compute it from the backlog alone.
 *
 * The backlog leaves the browser as `agelessCsv`. This is the other file, and it is deliberately
 * the smallest thing that answers the question: the id, the name and the age already on it.
 * Names and ages, no games — a hundred thousand rows of that is a few megabytes, where the
 * whole-browser backup carrying the same teams plus every game they played runs to hundreds.
 *
 * The age is here because it turns the tripwire from "does this rule fire on a working team?"
 * into "does it fire with a *different answer* than the one already filed?", which is the sharper
 * question: a rule that reads 10U off a team the pool has at 10U is agreeing, not misfiring.
 */

import { csvEscape } from "./csv";
import { ageLevelFromName } from "./gameChangerApi";
import { AGELESS_SAMPLE_OPPONENTS } from "./agelessEvidence";
import { todayIsoDay } from "./date";
import type { AgeGroup, ScoutGame, ScoutTeam } from "./teamRankings";

export const POOL_NAMES_CSV_HEADERS = [
  "Team ID",
  "Team Name",
  "Age Level",
  "Squad Year",
  "State",
  "Ranked",
  // The evidence half. Without it the tripwire can measure only the rules that read a name, and
  // the five that read a schedule report a zero that means "not measured" and looks like "safe".
  "Games",
  "Scored",
  "Ahead Of Today",
  "Shutout Blowouts",
  "Opponents",
  "Opponents Naming An Age",
  "Opponent Ages",
  "Played",
] as const;

/**
 * Whether this row is a club the pool actually ranks.
 *
 * A placeholder is a bracket slot and a name-only team is a club somebody else's schedule
 * mentioned; neither is ranked, and neither is evidence about anything a rule might do wrong.
 * They are written all the same, with the answer in a column, because a rule firing on ten
 * thousand "TBD" rows is worth knowing and worth being able to exclude rather than never seeing.
 */
const isRanked = (team: ScoutTeam): boolean => !team.placeholder && !team.nameOnly;

/**
 * Which age group each team plays in, read off its games.
 *
 * A `ScoutTeam` carries no age group of its own — the age is a property of the result, because a
 * club fields squads at several ages and a game knows which one it was. The commonest group
 * across a team's games is the answer here: a team that played thirty games at 10U and one
 * friendly at 12U is a 10U team, and for a tripwire the modal answer is the one a rule should be
 * agreeing with.
 */
const groupOf = (teams: readonly ScoutTeam[], games: readonly ScoutGame[]): Map<string, string> => {
  const counts = new Map<string, Map<string, number>>();
  const bump = (teamId: string, groupId: string) => {
    const seen = counts.get(teamId) ?? new Map<string, number>();
    seen.set(groupId, (seen.get(groupId) ?? 0) + 1);
    counts.set(teamId, seen);
  };
  games.forEach((game) => {
    bump(game.teamAId, game.ageGroupId);
    bump(game.teamBId, game.ageGroupId);
  });
  const best = new Map<string, string>();
  teams.forEach((team) => {
    const seen = counts.get(team.id);
    if (!seen) return;
    let top: string | undefined;
    let most = 0;
    seen.forEach((n, groupId) => {
      if (n > most) {
        most = n;
        top = groupId;
      }
    });
    if (top !== undefined) best.set(team.id, top);
  });
  return best;
};

/**
 * The same evidence `agelessEvidence` keeps, computed off the pool's own games.
 *
 * Deliberately the same definitions rather than near enough ones, because the tripwire compares
 * what a rule does here against what it does on the backlog, and two different readings of
 * "opponents" would make that comparison meaningless. Counted per distinct opponent rather than
 * per game for the reason that file gives: a tournament against the same club four times is one
 * club's opinion.
 *
 * What cannot be had this way is written down rather than faked. A pool team has no `ageLabel`,
 * no `record` and no `playerCount` — those come off a GameChanger profile the pool never keeps —
 * so the rules that read them (`adult-label`, `school-label`) still cannot be measured here, and
 * the sweep says so rather than printing a zero.
 */
const BLOWOUT_MARGIN = 10;

type PoolEvidence = {
  games: number;
  scored: number;
  aheadOfToday: number;
  shutoutBlowouts: number;
  opponents: number;
  namedAnAge: number;
  tally: [number, number][];
  played: string[];
};

const evidenceOf = (
  teams: readonly ScoutTeam[],
  games: readonly ScoutGame[],
  today: string
): Map<string, PoolEvidence> => {
  const named = new Map(teams.map((team) => [team.id, team.name]));
  const out = new Map<string, PoolEvidence>();
  const seen = new Map<string, Set<string>>();
  const counts = new Map<string, Map<number, number>>();

  const bump = (teamId: string, opponentId: string, game: ScoutGame) => {
    const evidence = out.get(teamId) ?? {
      games: 0,
      scored: 0,
      aheadOfToday: 0,
      shutoutBlowouts: 0,
      opponents: 0,
      namedAnAge: 0,
      tally: [],
      played: [],
    };
    evidence.games += 1;
    const a = game.teamAScore;
    const b = game.teamBScore;
    if (a !== undefined && b !== undefined) {
      evidence.scored += 1;
      if (game.date !== undefined && game.date > today) evidence.aheadOfToday += 1;
      if (Math.min(a, b) === 0 && Math.max(a, b) >= BLOWOUT_MARGIN) evidence.shutoutBlowouts += 1;
    }
    out.set(teamId, evidence);

    const opponentName = named.get(opponentId);
    if (opponentName === undefined) return;
    const key = opponentName.trim().toLowerCase();
    const already = seen.get(teamId) ?? new Set<string>();
    if (!key || already.has(key)) return;
    already.add(key);
    seen.set(teamId, already);
    evidence.opponents += 1;
    const level = ageLevelFromName(opponentName);
    if (level === undefined) {
      if (evidence.played.length < AGELESS_SAMPLE_OPPONENTS) evidence.played.push(opponentName);
      return;
    }
    evidence.namedAnAge += 1;
    const tally = counts.get(teamId) ?? new Map<number, number>();
    tally.set(level, (tally.get(level) ?? 0) + 1);
    counts.set(teamId, tally);
  };

  games.forEach((game) => {
    bump(game.teamAId, game.teamBId, game);
    bump(game.teamBId, game.teamAId, game);
  });
  counts.forEach((tally, teamId) => {
    const evidence = out.get(teamId);
    if (!evidence) return;
    evidence.tally = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  });
  return out;
};

/** "2×9U 1×10U", written the way `agelessCsv` writes it so one reader serves both files. */
const tallyCell = (tally: readonly [number, number][]): string =>
  tally.map(([level, count]) => `${count}×${level}U`).join(" ");

/** The whole pool, a chunk at a time, for a Blob to assemble without one giant string. */
export const poolNamesCsvParts = (
  teams: readonly ScoutTeam[],
  ageGroups: readonly AgeGroup[],
  games: readonly ScoutGame[]
): string[] => {
  const groups = new Map(ageGroups.map((group) => [group.id, group]));
  const playsIn = groupOf(teams, games);
  const evidence = evidenceOf(teams, games, todayIsoDay());
  const parts = [`${POOL_NAMES_CSV_HEADERS.join(",")}\n`];
  teams.forEach((team) => {
    const groupId = playsIn.get(team.id);
    const group = groupId === undefined ? undefined : groups.get(groupId);
    const e = evidence.get(team.id);
    const cells = [
      team.id,
      team.name,
      group?.ageLevel ?? "",
      group?.year ?? "",
      team.state ?? "",
      isRanked(team) ? "yes" : "no",
      e?.games ?? 0,
      e?.scored ?? 0,
      e?.aheadOfToday ?? 0,
      e?.shutoutBlowouts ?? 0,
      e?.opponents ?? 0,
      e?.namedAnAge ?? 0,
      tallyCell(e?.tally ?? []),
      (e?.played ?? []).join("; "),
    ];
    parts.push(`${cells.map(csvEscape).join(",")}\n`);
  });
  return parts;
};

export const poolNamesCsv = (
  teams: readonly ScoutTeam[],
  ageGroups: readonly AgeGroup[],
  games: readonly ScoutGame[]
): string => poolNamesCsvParts(teams, ageGroups, games).join("");

/** "gamechanger-pool-names-2026-09-22.csv" */
export const poolNamesCsvFilename = (day: string): string => `gamechanger-pool-names-${day}.csv`;
