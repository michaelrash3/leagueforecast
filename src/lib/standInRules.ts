import type { GcImportState, PoolTidy, TidyRules } from "./gameChangerImport";
import {
  ageGroupYear,
  isScoutGamePlayed,
  startsWithinTheHour,
  type ScoutGame,
  type ScoutTeam,
} from "./teamRankings";

/*
 * The measurement before the stand-in rule ships (`inStateNamesakes`): the pool tidied under each
 * reading of it, and for each, how much of the squad year still leans on a stand-in or a slot, and
 * whether the rows it filed look like the club's. A research tool's arithmetic, kept here so a test
 * can hold it; `scripts/standInSweep.ts` reads the cloud copy and prints it.
 *
 * Whether a row filed onto a club is right has no answer in the data: the row is filed there
 * because the club's own schedule does not have it. So it is read off who the club plays. A youth
 * club's games are against its neighbours, so the club a schedule named and the club whose schedule
 * named it share a pulled opponent, or have met, when the name was right; for a club of the
 * namer's state picked at random from the same page, they do much less often. The rows the rules as
 * shipped already file by name (the club's own schedules not holding them) say how often a right
 * one does; a decoy for each row filed says how often a wrong one would. Between the two the share
 * of the new rows that are wrong is read off where theirs falls: `wrongShare`.
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

/**
 * The year's played games against a slot, and of those with a start, how many have a row of
 * another schedule against a club known only by name within the hour that day: a game a better
 * reading of a name might yet pair the slot with. The rest have nothing at that hour to pair with,
 * however the names are read: the other side's schedule was never pulled.
 */
export type SlotsRead = { played: number; timed: number; standInAtTheHour: number };

export const slotsRead = (state: GcImportState, year: number): SlotsRead => {
  const byId = new Map(state.teams.map((team) => [team.id, team]));
  const games = gamesOfYear(state, year);
  const standInStarts = new Map<string, string[]>();
  for (const game of games) {
    if (!game.date || !game.startTs) continue;
    const a = byId.get(game.teamAId);
    const b = byId.get(game.teamBId);
    if ((isNameOnly(a) && isPulled(b)) || (isNameOnly(b) && isPulled(a))) {
      const at = standInStarts.get(game.date) ?? [];
      at.push(game.startTs);
      standInStarts.set(game.date, at);
    }
  }
  const out: SlotsRead = { played: 0, timed: 0, standInAtTheHour: 0 };
  for (const game of games) {
    const slot = [game.teamAId, game.teamBId].some((id) => byId.get(id)?.placeholder === true);
    if (!slot || !isScoutGamePlayed(game)) continue;
    out.played += 1;
    if (!game.date || !game.startTs) continue;
    out.timed += 1;
    const start = game.startTs;
    if ((standInStarts.get(game.date) ?? []).some((other) => startsWithinTheHour(other, start))) {
      out.standInAtTheHour += 1;
    }
  }
  return out;
};

/** Who each pulled club has met in a game against another pulled club. */
const metOf = (state: GcImportState): Map<string, Set<string>> => {
  const byId = new Map(state.teams.map((team) => [team.id, team]));
  const met = new Map<string, Set<string>>();
  const note = (a: string, b: string) => {
    const seen = met.get(a) ?? new Set<string>();
    seen.add(b);
    met.set(a, seen);
  };
  for (const game of state.games) {
    if (!isPulled(byId.get(game.teamAId)) || !isPulled(byId.get(game.teamBId))) continue;
    note(game.teamAId, game.teamBId);
    note(game.teamBId, game.teamAId);
  }
  return met;
};

/** Whether two pulled clubs have met, or share a pulled opponent: neighbours. */
const neighbours = (met: Map<string, Set<string>>, a: string, b: string): boolean => {
  const mine = met.get(a);
  const theirs = met.get(b);
  if (!mine || !theirs) return false;
  if (mine.has(b)) return true;
  for (const club of mine) if (club !== b && theirs.has(club)) return true;
  return false;
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
  slots: SlotsRead;
  /** Rows of the year that stood against a stand-in and now stand against a pulled club. */
  moved: NearCount;
  /** The same rows asked of a decoy: another pulled club of the namer's state on that page. */
  decoy: NearCount;
  /** A sample of the moved rows, namer, the name, and the club it was filed onto. */
  sample: { namer: string; name: string; club: string; state: string }[];
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
  const met = metOf(state);
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
    if (neighbours(met, namer, club)) out.near += 1;
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
  now: () => number = Date.now
): RuleReading => {
  const started = now();
  const result = tidy(before, rules);
  const after = result.state;
  const byIdBefore = new Map(before.teams.map((team) => [team.id, team]));
  const byIdAfter = new Map(after.teams.map((team) => [team.id, team]));
  const gameAfter = new Map(after.games.map((game) => [game.id, game]));
  const met = metOf(before);
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
    if (neighbours(met, namer, clubId)) moved.near += 1;
    const namerTeam = byIdBefore.get(namer);
    const pool =
      (namerTeam?.state && onPage.get(`${game.ageGroupId}\u0000${namerTeam.state}`)) || [];
    const choices = pool.filter((id) => id !== namer && id !== clubId);
    if (choices.length > 0) {
      const pick = choices[hashOf(game.id) % choices.length]!;
      decoy.rows += 1;
      if (neighbours(met, namer, pick)) decoy.near += 1;
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
    slots: slotsRead(after, year),
    moved,
    decoy,
    sample,
    seconds: (now() - started) / 1000,
  };
};
