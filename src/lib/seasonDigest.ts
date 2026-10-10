import { formatGameDate } from "./date";
import type { GameLog, GoldStatus, Matchup, TeamBase } from "./types";
import { isFinal } from "./util";

/**
 * What changed in a League season since this device last looked (2.6).
 *
 * League Standings kept live takes in other devices' edits as they are made: another coach's
 * scores, a game moved, a team renamed. A device that was closed, or looking at Team Rankings,
 * comes back to a season that is simply different, with nothing to say what changed. So each
 * device keeps the season as it last saw it (`SeasonSeen`, small: a line per game and team, and
 * where each team stood in the race), and the difference from the season now is the digest.
 *
 * What this device does itself is seen as it is done (`foldLocal`): a score typed here never comes
 * back as news. What arrives from elsewhere stays news until it is looked at (`acknowledge`).
 */

/** A game as the digest compares it. */
export type GameSeen = {
  date: string;
  away: string;
  home: string;
  /** The final score, "away-home", once the game is final; "" until then. */
  final: string;
  /** Everything else a person can enter for it (hits, strikeouts, innings…), as one string. */
  detail: string;
};

/** Where a team stood in the race for the cut, as the forecast had it. */
export type RaceSeen = { status: GoldStatus; gold: number };

export type SeasonSeen = {
  games: Record<string, GameSeen>;
  /** Each team's name, by id. */
  teams: Record<string, string>;
  /** Each team's place in the race, or null before a forecast has been seen. */
  race: Record<string, RaceSeen> | null;
};

type SeasonParts = { teams: TeamBase[]; matchups: Matchup[]; logs: Record<string, GameLog> };

const DETAIL_FIELDS = [
  "awayHits",
  "homeHits",
  "awayK",
  "homeK",
  "awayErrors",
  "homeErrors",
  "awayWalksAllowed",
  "homeWalksAllowed",
  "innings",
] as const satisfies readonly (keyof GameLog)[];

/**
 * A game as the digest compares it, from its matchup and log. What is typed into a game before it
 * is final is no one's news, so a game's box score counts only once the game is final.
 */
export const gameSeen = (matchup: Matchup, log: GameLog | undefined): GameSeen => {
  const final = log !== undefined && isFinal(log);
  return {
    date: matchup.date,
    away: matchup.away,
    home: matchup.home,
    final: final ? `${log.awayRuns.trim()}-${log.homeRuns.trim()}` : "",
    detail: final ? DETAIL_FIELDS.map((field) => (log[field] ?? "").trim()).join("|") : "",
  };
};

/** The season as this device sees it now. */
export const seenOf = (
  season: SeasonParts,
  race: Record<string, RaceSeen> | null = null
): SeasonSeen => ({
  games: Object.fromEntries(
    season.matchups.map((matchup) => [matchup.id, gameSeen(matchup, season.logs[matchup.id])])
  ),
  teams: Object.fromEntries(season.teams.map((team) => [team.id, team.name])),
  race,
});

const sameGame = (one: GameSeen | undefined, two: GameSeen | undefined) =>
  one === two ||
  (one !== undefined &&
    two !== undefined &&
    one.date === two.date &&
    one.away === two.away &&
    one.home === two.home &&
    one.final === two.final &&
    one.detail === two.detail);

/**
 * `seen` with what this device itself changed between `before` and `after` taken as seen: each
 * game and team the edit touched now reads as it does after it. Anything else that differs from
 * `seen` (what arrived from elsewhere) stays unseen. The race is left to `withRace`.
 */
export const foldLocal = (
  seen: SeasonSeen,
  before: SeasonParts,
  after: SeasonParts
): SeasonSeen => {
  const was = seenOf(before);
  const now = seenOf(after);
  let games = seen.games;
  for (const id of new Set([...Object.keys(was.games), ...Object.keys(now.games)])) {
    if (sameGame(was.games[id], now.games[id])) continue;
    games = games === seen.games ? { ...games } : games;
    const next = now.games[id];
    if (next) games[id] = next;
    else delete games[id];
  }
  let teams = seen.teams;
  for (const id of new Set([...Object.keys(was.teams), ...Object.keys(now.teams)])) {
    if (was.teams[id] === now.teams[id]) continue;
    teams = teams === seen.teams ? { ...teams } : teams;
    const name = now.teams[id];
    if (name !== undefined) teams[id] = name;
    else delete teams[id];
  }
  return games === seen.games && teams === seen.teams ? seen : { ...seen, games, teams };
};

export type GameChangeKind =
  | "final"
  | "corrected"
  | "reopened"
  | "scheduled"
  | "rescheduled"
  | "opponents"
  | "removed"
  | "detail";
export type TeamChangeKind = "teamAdded" | "teamRemoved" | "teamRenamed";
export type RaceChangeKind = "clinched" | "eliminated" | "odds";

export type Change =
  | {
      kind: GameChangeKind;
      gameId: string;
      /** The teams in the game, before and after, without repeats. */
      teamIds: string[];
      before?: GameSeen;
      after?: GameSeen;
    }
  | { kind: TeamChangeKind; teamId: string; teamIds: string[]; before?: string; after?: string }
  | { kind: RaceChangeKind; teamId: string; teamIds: string[]; from?: number; to?: number };

const teamsOf = (...games: (GameSeen | undefined)[]) => [
  ...new Set(games.flatMap((game) => (game ? [game.away, game.home] : []))),
];

/** How each game changed, most telling first: a result outranks a date, a date a detail. */
const gameChanges = (id: string, before?: GameSeen, after?: GameSeen): Change[] => {
  if (!before && !after) return [];
  const teamIds = teamsOf(before, after);
  const change = (kind: GameChangeKind): Change => ({
    kind,
    gameId: id,
    teamIds,
    ...(before ? { before } : {}),
    ...(after ? { after } : {}),
  });
  if (!before) return [change("scheduled")];
  if (!after) return [change("removed")];
  const changes: Change[] = [];
  if (before.final === "" && after.final !== "") changes.push(change("final"));
  else if (before.final !== "" && after.final === "") changes.push(change("reopened"));
  else if (before.final !== after.final) changes.push(change("corrected"));
  if (before.away !== after.away || before.home !== after.home) changes.push(change("opponents"));
  if (before.date !== after.date) changes.push(change("rescheduled"));
  if (changes.length === 0 && before.detail !== after.detail) changes.push(change("detail"));
  return changes;
};

/**
 * Every change from `before` to `after`: games, teams, and the race, the race only where both
 * have a forecast. `oddsMove` is the change in a team's Gold chance, in points, that counts as
 * news for the team followed (`followed`); a clinch or an elimination is news for any team.
 */
export const changesBetween = (
  before: SeasonSeen,
  after: SeasonSeen,
  { followed = null, oddsMove = 10 }: { followed?: string | null; oddsMove?: number } = {}
): Change[] => {
  const changes: Change[] = [];
  const gameIds = new Set([...Object.keys(before.games), ...Object.keys(after.games)]);
  for (const id of [...gameIds].sort()) {
    const was = before.games[id];
    const now = after.games[id];
    if (!sameGame(was, now)) changes.push(...gameChanges(id, was, now));
  }
  const teamIds = new Set([...Object.keys(before.teams), ...Object.keys(after.teams)]);
  for (const id of [...teamIds].sort()) {
    const was = before.teams[id];
    const now = after.teams[id];
    if (was === now) continue;
    if (was === undefined)
      changes.push({ kind: "teamAdded", teamId: id, teamIds: [id], after: now ?? "" });
    else if (now === undefined)
      changes.push({ kind: "teamRemoved", teamId: id, teamIds: [id], before: was });
    else changes.push({ kind: "teamRenamed", teamId: id, teamIds: [id], before: was, after: now });
  }
  if (before.race && after.race) {
    for (const [id, now] of Object.entries(after.race).sort(([a], [b]) => a.localeCompare(b))) {
      const was = before.race[id];
      if (!was) continue;
      if (now.status === "Clinched" && was.status !== "Clinched")
        changes.push({ kind: "clinched", teamId: id, teamIds: [id] });
      else if (now.status === "Eliminated" && was.status !== "Eliminated")
        changes.push({ kind: "eliminated", teamId: id, teamIds: [id] });
      else if (id === followed && Math.abs(now.gold - was.gold) >= oddsMove)
        changes.push({ kind: "odds", teamId: id, teamIds: [id], from: was.gold, to: now.gold });
    }
  }
  return changes;
};

/** The kinds of change, in the order a digest lists them, and how a count of each reads. */
export const CHANGE_ORDER: readonly Change["kind"][] = [
  "clinched",
  "eliminated",
  "odds",
  "final",
  "corrected",
  "reopened",
  "scheduled",
  "rescheduled",
  "opponents",
  "removed",
  "teamAdded",
  "teamRemoved",
  "teamRenamed",
  "detail",
];

const COUNTED: Record<Change["kind"], [one: string, many: string]> = {
  clinched: ["clinch", "clinches"],
  eliminated: ["elimination", "eliminations"],
  odds: ["move in the odds", "moves in the odds"],
  final: ["new final", "new finals"],
  corrected: ["corrected score", "corrected scores"],
  reopened: ["final reopened", "finals reopened"],
  scheduled: ["game added", "games added"],
  rescheduled: ["game moved", "games moved"],
  opponents: ["change of opponent", "changes of opponent"],
  removed: ["game removed", "games removed"],
  teamAdded: ["team added", "teams added"],
  teamRemoved: ["team removed", "teams removed"],
  teamRenamed: ["team renamed", "teams renamed"],
  detail: ["box score updated", "box scores updated"],
};

/** "3 new finals, 1 corrected score and 1 clinch": the changes counted, in digest order. */
export const countLine = (changes: readonly Change[]): string => {
  const counts = CHANGE_ORDER.map(
    (kind) => [kind, changes.filter((c) => c.kind === kind).length] as const
  )
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${count} ${COUNTED[kind][count === 1 ? 0 : 1]}`);
  if (counts.length <= 1) return counts[0] ?? "";
  return `${counts.slice(0, -1).join(", ")} and ${counts[counts.length - 1]}`;
};

/** One change in words, with the names it had (`names`, by id), for the digest's list. */
export const describeChange = (change: Change, names: (id: string) => string): string => {
  const game = (seen?: GameSeen) =>
    seen ? `${names(seen.away)} at ${names(seen.home)}` : "A game";
  const score = (seen?: GameSeen) => (seen?.final ? seen.final.replace("-", "–") : "");
  switch (change.kind) {
    case "final":
      return `${game(change.after)}: final, ${score(change.after)}.`;
    case "corrected":
      return `${game(change.after)}: corrected from ${score(change.before)} to ${score(change.after)}.`;
    case "reopened":
      return `${game(change.after)}: no longer final (was ${score(change.before)}).`;
    case "scheduled":
      return `${game(change.after)} added for ${formatGameDate(change.after?.date ?? "")}.`;
    case "rescheduled":
      return `${game(change.after)} moved from ${formatGameDate(change.before?.date ?? "")} to ${formatGameDate(change.after?.date ?? "")}.`;
    case "opponents":
      return `${game(change.before)} is now ${game(change.after)}.`;
    case "removed":
      return `${game(change.before)} removed from the schedule.`;
    case "detail":
      return `${game(change.after)}: box score updated.`;
    case "teamAdded":
      return `${change.after ?? names(change.teamId)} added to the league.`;
    case "teamRemoved":
      return `${change.before ?? names(change.teamId)} removed from the league.`;
    case "teamRenamed":
      return `${change.before ?? ""} is now ${change.after ?? names(change.teamId)}.`;
    case "clinched":
      return `${names(change.teamId)} clinched a Gold Bracket place.`;
    case "eliminated":
      return `${names(change.teamId)} can no longer reach the Gold Bracket.`;
    case "odds":
      return `${names(change.teamId)}'s Gold chance went from ${Math.round(change.from ?? 0)}% to ${Math.round(change.to ?? 0)}%.`;
  }
};

/**
 * Which changes a device's notifications are for (2.6), each opted into. Off until a person turns
 * them on, which is when the browser is first asked for permission, never before.
 */
export type NotifyPrefs = {
  on: boolean;
  /** Finals and corrected scores of the team followed. */
  finals: boolean;
  /** The team followed's games added, moved, removed or given another opponent. */
  schedule: boolean;
  clinches: boolean;
  eliminations: boolean;
  /** A move of this many points in the followed team's Gold chance, or null for none. */
  oddsMove: number | null;
  /** League kept live stopped on something a person has to see to. */
  problems: boolean;
};

export const DEFAULT_NOTIFY: NotifyPrefs = {
  on: false,
  finals: true,
  schedule: true,
  clinches: true,
  eliminations: true,
  oddsMove: 15,
  problems: true,
};

const SCHEDULE_KINDS: readonly Change["kind"][] = [
  "scheduled",
  "rescheduled",
  "opponents",
  "removed",
];

/** The changes worth a notification, under `prefs`, for the team followed. */
export const worthNotifying = (
  changes: readonly Change[],
  prefs: NotifyPrefs,
  followed: string | null
): Change[] =>
  prefs.on
    ? changes.filter((change) => {
        const mine = followed !== null && change.teamIds.includes(followed);
        if (change.kind === "final" || change.kind === "corrected") return prefs.finals && mine;
        if (SCHEDULE_KINDS.includes(change.kind)) return prefs.schedule && mine;
        if (change.kind === "clinched") return prefs.clinches;
        if (change.kind === "eliminated") return prefs.eliminations;
        if (change.kind === "odds")
          return (
            mine &&
            prefs.oddsMove !== null &&
            Math.abs((change.to ?? 0) - (change.from ?? 0)) >= prefs.oddsMove
          );
        return false;
      })
    : [];

/** What makes one change this change and no other: the same news has the same key. */
export const changeKey = (change: Change): string => {
  if ("gameId" in change)
    return [change.kind, change.gameId, change.after?.final ?? "", change.after?.date ?? ""].join(
      ":"
    );
  if (change.kind === "odds")
    return [change.kind, change.teamId, Math.round(change.to ?? 0)].join(":");
  return [change.kind, change.teamId, "after" in change ? (change.after ?? "") : ""].join(":");
};

/** Each team's place in the race, from the forecast's rows, for `seenOf`. */
export const raceOf = (
  rows: readonly { id: string; goldStatus: GoldStatus; goldPct: number }[]
): Record<string, RaceSeen> =>
  Object.fromEntries(rows.map((row) => [row.id, { status: row.goldStatus, gold: row.goldPct }]));

const GOLD_STATUSES: readonly string[] = ["Clinched", "In", "Alive", "Eliminated"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const coerceGame = (value: unknown): GameSeen | null => {
  if (!isRecord(value)) return null;
  const { date, away, home, final, detail } = value;
  return [date, away, home, final, detail].every((field) => typeof field === "string")
    ? ({ date, away, home, final, detail } as GameSeen)
    : null;
};

/** A stored last look read back, or null for anything that is not one. */
export const coerceSeen = (value: unknown): SeasonSeen | null => {
  if (!isRecord(value) || !isRecord(value.games) || !isRecord(value.teams)) return null;
  const games: Record<string, GameSeen> = {};
  for (const [id, game] of Object.entries(value.games)) {
    const read = coerceGame(game);
    if (!read) return null;
    games[id] = read;
  }
  const teams: Record<string, string> = {};
  for (const [id, name] of Object.entries(value.teams)) {
    if (typeof name !== "string") return null;
    teams[id] = name;
  }
  let race: Record<string, RaceSeen> | null = null;
  if (isRecord(value.race)) {
    race = {};
    for (const [id, entry] of Object.entries(value.race)) {
      if (
        !isRecord(entry) ||
        typeof entry.status !== "string" ||
        !GOLD_STATUSES.includes(entry.status) ||
        typeof entry.gold !== "number" ||
        !Number.isFinite(entry.gold)
      )
        return null;
      race[id] = { status: entry.status as GoldStatus, gold: entry.gold };
    }
  }
  return { games, teams, race };
};

/** Stored notification choices read back over the defaults, a bad value falling back to its default. */
export const coerceNotifyPrefs = (value: unknown): NotifyPrefs => {
  if (!isRecord(value)) return DEFAULT_NOTIFY;
  const flag = (key: Exclude<keyof NotifyPrefs, "oddsMove">) =>
    typeof value[key] === "boolean" ? (value[key] as boolean) : DEFAULT_NOTIFY[key];
  const move = value.oddsMove;
  return {
    on: flag("on"),
    finals: flag("finals"),
    schedule: flag("schedule"),
    clinches: flag("clinches"),
    eliminations: flag("eliminations"),
    oddsMove:
      move === null
        ? null
        : typeof move === "number" && Number.isFinite(move) && move > 0 && move <= 100
          ? move
          : DEFAULT_NOTIFY.oddsMove,
    problems: flag("problems"),
  };
};
