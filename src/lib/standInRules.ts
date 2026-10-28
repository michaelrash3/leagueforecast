import {
  areOwnNeighbours,
  joinNamesakeHalves,
  ownOpponentsOf,
  type GcImportState,
  type PoolTidy,
  type TidyRules,
} from "./gameChangerImport";
import type { NotThisTeam } from "./notThisTeam";
import { ageGroupYear, isScoutGamePlayed, type ScoutGame, type ScoutTeam } from "./teamRankings";

/*
 * The measurement before the stand-in rule ships (`inStateNamesakes`): the pool tidied under each
 * reading of it, and for each, how much of the squad year still leans on a stand-in or a slot, and
 * whether the rows it filed look like the club's. A research tool's arithmetic, kept here so a test
 * can hold it; `scripts/modelSweep.ts --stand-in-rules` reads the cloud copy and prints it.
 *
 * Whether a row filed onto a club is right has no answer in the data: the row is filed there
 * because the club's own schedule does not have it. So it is read off who the club plays. A youth
 * club's games are against its neighbours, so the club a schedule named and the club whose schedule
 * named it are neighbours by their own schedules (`areOwnNeighbours`) more often when the name was
 * right; for a club of the namer's state picked at random from the same page, much less often. The
 * rows the rules as shipped already file by name say how often a right one is; a decoy for each row
 * filed says how often a wrong one would be. Between the two the share of the new rows that are
 * wrong is read off where theirs falls: `wrongShare`.
 *
 * The first run of it (GitHub run 40448331357, 27 October 2026) read neighbours off every game
 * between two pulled clubs, the row filed by name among them, so the rows already filed by name read
 * as neighbours every time (18,216 of 18,216) and the wrong share it printed meant nothing. Read off
 * the clubs' own schedules, a row on the namer's schedule alone never vouches for itself.
 */

/** How much of a squad year leans on a club known only by name, or on a slot. */
export type Leaning = {
  games: number;
  played: number;
  withStandIn: number;
  playedWithStandIn: number;
  withSlot: number;
  playedWithSlot: number;
  /** Clubs known only by name holding a game of the year. */
  standIns: number;
};

const isNameOnly = (team: ScoutTeam | undefined) =>
  team?.nameOnly === true && team.placeholder !== true;
const isPulled = (team: ScoutTeam | undefined) => Boolean(team?.gcTeams?.length);

const gamesOfYear = (state: GcImportState, year: number): ScoutGame[] => {
  const pages = new Set(
    state.ageGroups.filter((group) => ageGroupYear(group) === year).map((group) => group.id)
  );
  return state.games.filter((game) => pages.has(game.ageGroupId));
};

export const leaningOf = (state: GcImportState, year: number): Leaning => {
  const byId = new Map(state.teams.map((team) => [team.id, team]));
  const out: Leaning = {
    games: 0,
    played: 0,
    withStandIn: 0,
    playedWithStandIn: 0,
    withSlot: 0,
    playedWithSlot: 0,
    standIns: 0,
  };
  const standIns = new Set<string>();
  for (const game of gamesOfYear(state, year)) {
    const played = isScoutGamePlayed(game);
    const sides = [byId.get(game.teamAId), byId.get(game.teamBId)];
    const named = sides.filter(isNameOnly);
    const slot = sides.some((team) => team?.placeholder === true);
    named.forEach((team) => standIns.add(team!.id));
    out.games += 1;
    if (played) out.played += 1;
    if (named.length > 0 || slot) {
      out.withStandIn += 1;
      if (played) out.playedWithStandIn += 1;
    }
    if (slot) {
      out.withSlot += 1;
      if (played) out.playedWithSlot += 1;
    }
  }
  out.standIns = standIns.size;
  return out;
};

/** How many rows of a kind, and of those how many between neighbours. */
export type NearCount = { rows: number; near: number };

/** One reading of the rules, as the tidy under it left the year. */
export type RuleReading = {
  key: string;
  passes: number;
  refiled: number;
  resettled: number;
  /** Rows against a slot or a stand-in settled from the other team's schedule. */
  named: number;
  after: Leaning;
  /** Rows of the year that stood against a stand-in and now stand against a pulled club. */
  moved: NearCount;
  /** The same rows asked of a decoy: another pulled club of the namer's state on that page. */
  decoy: NearCount;
  /** A sample of the moved rows, namer, the name, and the club it was filed onto. */
  sample: { namer: string; name: string; club: string; state: string }[];
  /**
   * Whether the rule chose its rows for being neighbours (`InStateRule.vouched`): then they are
   * neighbours by construction, and their rate says nothing of how many are right.
   */
  selectedOnNeighbours: boolean;
  seconds: number;
};

/**
 * The rows of the year the rules as shipped already file by name: a pulled club on one side, a
 * pulled club's schedule on the other, and nothing of the first club's own schedules in it. How
 * often those are between neighbours is how often a right reading of a name is.
 */
export const filedByName = (state: GcImportState, year: number): NearCount => {
  const byId = new Map(state.teams.map((team) => [team.id, team]));
  const scheduleOf = new Map<string, string>();
  state.teams.forEach((team) =>
    team.gcTeams?.forEach((link) => scheduleOf.set(link.teamId, team.id))
  );
  const met = ownOpponentsOf(state);
  const out: NearCount = { rows: 0, near: 0 };
  for (const game of gamesOfYear(state, year)) {
    const namer = game.source ? scheduleOf.get(game.source.teamId) : undefined;
    if (!namer) continue;
    const club = namer === game.teamAId ? game.teamBId : game.teamAId;
    if (club === namer || !isPulled(byId.get(club))) continue;
    const own = byId.get(club)?.gcTeams?.map((link) => link.teamId) ?? [];
    const listed =
      (game.alsoRows ?? []).some((row) => own.includes(row.teamId)) ||
      (game.alsoFrom ?? []).some((schedule) => own.includes(schedule));
    if (listed) continue;
    out.rows += 1;
    if (areOwnNeighbours(met, namer, club)) out.near += 1;
  }
  return out;
};

/**
 * The share of the moved rows that are wrong, read between how often a right row is between
 * neighbours (`right`, the rows already filed by name) and how often a wrong one would be (the
 * decoys): if right rows are neighbours a share r of the time and wrong ones d, rows of which a
 * share w are wrong are neighbours (1 - w) r + w d of the time. Null where r and d do not differ.
 */
export const wrongShare = (moved: NearCount, decoy: NearCount, right: NearCount): number | null => {
  if (moved.rows === 0 || decoy.rows === 0 || right.rows === 0) return null;
  const r = right.near / right.rows;
  const d = decoy.near / decoy.rows;
  const o = moved.near / moved.rows;
  if (r - d <= 0) return null;
  return Math.min(1, Math.max(0, (r - o) / (r - d)));
};

/**
 * A reading's wrong share (`wrongShare`), or null where the rule chose its rows on the very measure
 * the share is read from (Codex on #471): rows a rule files only where the clubs are neighbours are
 * neighbours every time, which read as none wrong whatever they are. The bound for such a rule is
 * read off the reading without the test instead: the decoys' rate times its wrong share, over its
 * rate.
 */
export const readingWrongShare = (reading: RuleReading, right: NearCount): number | null =>
  reading.selectedOnNeighbours ? null : wrongShare(reading.moved, reading.decoy, right);

/** A string's hash, to pick a decoy the same way every run. */
const hashOf = (text: string): number => {
  let hash = 2166136261;
  for (let at = 0; at < text.length; at += 1) {
    hash ^= text.charCodeAt(at);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

/**
 * The pool tidied under `rules` (by the caller's `tidy`, which passes what the nightly passes) and
 * read against the pool as it was.
 */
export const readRules = (
  before: GcImportState,
  year: number,
  key: string,
  rules: TidyRules,
  tidy: (state: GcImportState, rules: TidyRules) => PoolTidy,
  sampleSize = 25,
  now: () => number = Date.now,
  /** Handed the tidied pool, for a measurement read off it after (`fittedJoinsOf`). */
  keep?: (state: GcImportState) => void
): RuleReading => {
  const started = now();
  const result = tidy(before, rules);
  const after = result.state;
  keep?.(after);
  const byIdBefore = new Map(before.teams.map((team) => [team.id, team]));
  const byIdAfter = new Map(after.teams.map((team) => [team.id, team]));
  const gameAfter = new Map(after.games.map((game) => [game.id, game]));
  const met = ownOpponentsOf(before);
  const scheduleOf = new Map<string, string>();
  before.teams.forEach((team) =>
    team.gcTeams?.forEach((link) => scheduleOf.set(link.teamId, team.id))
  );
  // The pulled clubs of each state that played on each page, for a decoy.
  const onPage = new Map<string, string[]>();
  for (const game of before.games) {
    for (const id of [game.teamAId, game.teamBId]) {
      const team = byIdBefore.get(id);
      if (!isPulled(team) || !team?.state) continue;
      const at = `${game.ageGroupId}\u0000${team.state}`;
      const clubs = onPage.get(at) ?? [];
      clubs.push(id);
      onPage.set(at, clubs);
    }
  }
  onPage.forEach((clubs, at) => onPage.set(at, [...new Set(clubs)].sort()));
  const moved: NearCount = { rows: 0, near: 0 };
  const decoy: NearCount = { rows: 0, near: 0 };
  const sample: RuleReading["sample"] = [];
  for (const game of gamesOfYear(before, year)) {
    const was = isNameOnly(byIdBefore.get(game.teamAId))
      ? "A"
      : isNameOnly(byIdBefore.get(game.teamBId))
        ? "B"
        : undefined;
    if (!was) continue;
    const later = gameAfter.get(game.id);
    if (!later) continue;
    const standInId = was === "A" ? game.teamAId : game.teamBId;
    const clubId = was === "A" ? later.teamAId : later.teamBId;
    const club = byIdAfter.get(clubId);
    if (clubId === standInId || !isPulled(club)) continue;
    const namer = game.source ? scheduleOf.get(game.source.teamId) : undefined;
    if (!namer || namer === clubId) continue;
    moved.rows += 1;
    if (areOwnNeighbours(met, namer, clubId)) moved.near += 1;
    const namerTeam = byIdBefore.get(namer);
    const pool =
      (namerTeam?.state && onPage.get(`${game.ageGroupId}\u0000${namerTeam.state}`)) || [];
    const choices = pool.filter((id) => id !== namer && id !== clubId);
    if (choices.length > 0) {
      const pick = choices[hashOf(game.id) % choices.length]!;
      decoy.rows += 1;
      if (areOwnNeighbours(met, namer, pick)) decoy.near += 1;
    }
    if (sample.length < sampleSize && hashOf(`${key}|${game.id}`) % 7 === 0) {
      sample.push({
        namer: namerTeam?.name ?? namer,
        name: byIdBefore.get(standInId)?.name ?? standInId,
        club: club?.name ?? clubId,
        state: club?.state ?? "?",
      });
    }
  }
  return {
    key,
    passes: result.passes,
    refiled: result.refiled,
    resettled: result.resettled,
    named: result.named,
    after: leaningOf(after, year),
    moved,
    decoy,
    sample,
    selectedOnNeighbours: rules.inState?.vouched === true,
    seconds: (now() - started) / 1000,
  };
};

/*
 * The measurement before the namesake join reads a name that only fits a club (`FittedRule`): the
 * games it joins on the pool as the rules before it left it, and the same with every row against a
 * slot a week or a fortnight either side, where its game is not, so each join there is one a false
 * pair would make. The namesake join was measured so before it shipped (`joinNamesakeHalves`).
 */

const DAY_MS = 86_400_000;

/** The pool with every row against a slot moved `days` on, its date and its start. */
export const withSlotRowsMoved = (state: GcImportState, days: number): GcImportState => {
  if (days === 0) return state;
  const slots = new Set(
    state.teams
      .filter((team) => team.placeholder === true && !isPulled(team))
      .map((team) => team.id)
  );
  const games = state.games.map((game) => {
    if (!slots.has(game.teamAId) && !slots.has(game.teamBId)) return game;
    const at = game.startTs === undefined ? Number.NaN : Date.parse(game.startTs);
    const day = game.date === undefined ? Number.NaN : Date.parse(`${game.date}T12:00:00.000Z`);
    return {
      ...game,
      ...(Number.isNaN(at) ? {} : { startTs: new Date(at + days * DAY_MS).toISOString() }),
      ...(Number.isNaN(day)
        ? {}
        : { date: new Date(day + days * DAY_MS).toISOString().slice(0, 10) }),
    };
  });
  return { ...state, games };
};

/** The games one reading of the join makes that the rules without it do not. */
export type FittedJoins = {
  joined: number;
  /** Of those, between clubs of one state or two sharing a border. */
  near: number;
  sample: { namer: string; name: string; club: string; states: string; score: string }[];
};

/** The joins `rules` makes on `state` beyond those `without` makes (`joinNamesakeHalves`). */
export const fittedJoinsOf = (
  state: GcImportState,
  rules: TidyRules,
  without: TidyRules,
  refused: NotThisTeam,
  near: (a: string | undefined, b: string | undefined) => boolean,
  sampleSize = 0
): FittedJoins => {
  const joinedOn = (rulesRead: TidyRules) =>
    new Map(
      joinNamesakeHalves(state, refused, rulesRead)
        .state.games.filter((game) => game.joinedFrom !== undefined)
        .map((game) => [game.id, game] as const)
    );
  const before = joinedOn(without);
  const byId = new Map(state.teams.map((team) => [team.id, team]));
  const out: FittedJoins = { joined: 0, near: 0, sample: [] };
  joinedOn(rules).forEach((game, id) => {
    if (before.get(id)?.teamBId === game.teamBId) return;
    const namer = byId.get(game.teamAId);
    const club = byId.get(game.teamBId);
    out.joined += 1;
    if (namer?.state && club?.state && near(namer.state, club.state)) out.near += 1;
    if (out.sample.length < sampleSize && hashOf(id) % 3 === 0) {
      out.sample.push({
        namer: namer?.name ?? game.teamAId,
        name: byId.get(game.joinedFrom!)?.name ?? game.joinedFrom!,
        club: club?.name ?? game.teamBId,
        states: `${namer?.state ?? "?"}-${club?.state ?? "?"}`,
        score: `${game.teamAScore}-${game.teamBScore}`,
      });
    }
  });
  return out;
};
