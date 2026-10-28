import {
  ageLevelFromName,
  parseGcAgeLevel,
  parseGcTeamId,
  type GcGame,
  type GcTeamSchedule,
} from "./gameChangerApi";
import { draftStart, type StartDraft, type StartPage } from "./leagueStart";
import { squadYearFromName } from "./seasonNames";
import { teamNameKey } from "./teamRankings/names";
import type { ScoutGame } from "./teamRankings/types";
import { segmentOn } from "./teamRankings/seasons";

/**
 * Starting a League Standings season from a GameChanger organization's own schedule, read through
 * the app's GameChanger proxy: the owner's choice of 26 October 2026, over the Organizations file
 * and the clubs Team Rankings has pulled, which a league's organization is often not in.
 *
 * GameChanger has no public route from an organization to its games that this app has seen
 * answer, but it does from an organization to its teams (`/public/organizations/{id}/teams`, which
 * the GC miner reads), and from each team to its schedule, which the proxy has always read. So an
 * organization's league games are its teams' schedules, the games between two of its teams paired
 * across the two schedules that list them, as the organization's own schedule page shows them.
 *
 * Nothing here is stored: the teams, the games and the season the owner makes from them are worked
 * out on this device from what the proxy hands back.
 */

/** A season as GameChanger names one: "fall" and 2026. */
export type GcSeasonName = { name: string; year: number };

/** One team an organization lists, as much of it as the list gave. */
export type GcOrgTeam = {
  id: string;
  name: string;
  season?: GcSeasonName;
  /** The age group as the list wrote it ("9U"), and its level where one reads off it or the name. */
  ageLabel?: string;
  ageLevel?: number;
  city?: string;
  state?: string;
};

/** What reading an organization's team list found, or why it found nothing. */
export type GcOrgTeamsReading =
  { ok: true; teams: GcOrgTeam[] } | { ok: false; message: string; keys?: string[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

/** The wrappers a listed entity has been seen in (the miner's `unwrapHit`). */
const unwrap = (raw: Record<string, unknown>): Record<string, unknown> => {
  for (const key of ["result", "entity", "_source", "data", "item"]) {
    const inner = raw[key];
    if (isRecord(inner)) return inner;
  }
  const attributes = raw.attributes;
  if (isRecord(attributes)) return { ...attributes, id: raw.id ?? attributes.id };
  return raw;
};

const SEASON_NAMES = new Set(["spring", "summer", "fall", "winter"]);

/** A season object, "fall 2026" or a season name and year beside each other, or nothing. */
const seasonOf = (it: Record<string, unknown>): GcSeasonName | undefined => {
  const given = it.season ?? it.team_season;
  const read = (name: unknown, year: unknown): GcSeasonName | undefined => {
    const word = text(name)?.toLowerCase();
    const number = typeof year === "string" ? Number(year) : year;
    return word && SEASON_NAMES.has(word) && Number.isInteger(number)
      ? { name: word, year: number as number }
      : undefined;
  };
  if (isRecord(given)) return read(given.name ?? given.season ?? given.label, given.year);
  const written = text(given)
    ?.toLowerCase()
    .match(/^(spring|summer|fall|winter)\W+(20\d\d)$/);
  if (written) return read(written[1], written[2]);
  return read(it.season_name, it.season_year);
};

/** The id a team page uses: `public_id` first, as the miner reads it, never an internal UUID. */
const idOf = (it: Record<string, unknown>): string | undefined => {
  for (const key of ["public_id", "id", "team_id"]) {
    const id = parseGcTeamId(text(it[key]) ?? "");
    if (id) return id;
  }
  for (const key of ["gc_url", "url", "web_url", "share_url", "schedule_url"]) {
    const id = parseGcTeamId(text(it[key]) ?? "");
    if (id) return id;
  }
  return undefined;
};

const TEAM_LIST_KEYS = ["teams", "data", "results", "items"] as const;

/**
 * The teams in the body GameChanger answered an organization's team list with: the list itself or
 * one inside it, each entry read as the miner reads one (`expandSingleOrganization`), every team
 * once. A body that is not JSON, or holds no list of teams, says so with its top-level keys, so a
 * shape nobody has seen can be read from what the owner sees.
 */
export const readGcOrgTeams = (body: string): GcOrgTeamsReading => {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { ok: false, message: "GameChanger's list of the organization's teams was not JSON." };
  }
  const list = Array.isArray(json)
    ? json
    : isRecord(json)
      ? (TEAM_LIST_KEYS.map((key) => json[key]).find(Array.isArray) ??
        (isRecord(json.data) && Array.isArray(json.data.teams) ? json.data.teams : undefined))
      : undefined;
  if (!Array.isArray(list)) {
    return {
      ok: false,
      message:
        "GameChanger's answer for the organization holds no list of teams this app can read.",
      ...(isRecord(json) ? { keys: Object.keys(json).slice(0, 20) } : {}),
    };
  }
  const seen = new Set<string>();
  const teams: GcOrgTeam[] = [];
  list.forEach((raw) => {
    if (!isRecord(raw)) return;
    const it = unwrap(raw);
    const id = idOf(it);
    if (!id || seen.has(id)) return;
    seen.add(id);
    const name =
      text(it.name) ?? text(it.team_name) ?? text(it.display_name) ?? `GameChanger team ${id}`;
    const ageLabel = text(it.age_group) ?? text(it.age) ?? text(it.division);
    const ageLevel = parseGcAgeLevel(ageLabel) ?? ageLevelFromName(name);
    const season = seasonOf(it) ?? (isRecord(raw) && raw !== it ? seasonOf(raw) : undefined);
    const location = isRecord(it.location) ? it.location : {};
    const city = text(location.city) ?? text(it.city);
    const state = text(location.state) ?? text(it.state);
    teams.push({
      id,
      name,
      ...(season ? { season } : {}),
      ...(ageLabel ? { ageLabel } : {}),
      ...(ageLevel === undefined ? {} : { ageLevel }),
      ...(city ? { city } : {}),
      ...(state ? { state } : {}),
    });
  });
  return { ok: true, teams };
};

/** The teams of one season at one age, which a league's division is. */
export type GcOrgGroup = {
  key: string;
  label: string;
  season?: GcSeasonName;
  ageLevel?: number;
  teams: GcOrgTeam[];
};

const SEASON_ORDER = ["winter", "spring", "summer", "fall"];
const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * An organization's teams by season and age, the newest season first and the youngest age first in
 * it, each team by name: a league organization lists every division of every season it has run,
 * and a League Standings season is one of them. Teams the list gives no season or age for are a
 * group of their own, last.
 */
export const groupOrgTeams = (teams: readonly GcOrgTeam[]): GcOrgGroup[] => {
  const groups = new Map<string, GcOrgGroup>();
  teams.forEach((team) => {
    const season = team.season;
    const key = `${season ? `${season.year}-${season.name}` : "-"}|${team.ageLevel ?? "-"}`;
    const known = groups.get(key);
    if (known) {
      known.teams.push(team);
      return;
    }
    const words = [
      season ? `${capital(season.name)} ${season.year}` : undefined,
      team.ageLevel === undefined ? undefined : `${team.ageLevel}U`,
    ].filter(Boolean);
    groups.set(key, {
      key,
      label: words.length > 0 ? words.join(" · ") : "Season and age not given",
      ...(season ? { season } : {}),
      ...(team.ageLevel === undefined ? {} : { ageLevel: team.ageLevel }),
      teams: [team],
    });
  });
  const rank = (group: GcOrgGroup) =>
    group.season
      ? group.season.year * 10 + SEASON_ORDER.indexOf(group.season.name)
      : Number.NEGATIVE_INFINITY;
  return [...groups.values()]
    .map((group) => ({
      ...group,
      teams: [...group.teams].sort(
        (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
      ),
    }))
    .sort(
      (a, b) =>
        rank(b) - rank(a) ||
        (a.ageLevel ?? Number.POSITIVE_INFINITY) - (b.ageLevel ?? Number.POSITIVE_INFINITY) ||
        a.label.localeCompare(b.label)
    );
};

/** The page the games are filed under here: none of Team Rankings', since nothing is stored. */
const ORG_PAGE = "gc-organization";

/** One team's schedule as the proxy pulled it. */
export type PulledOrgTeam = { teamId: string; schedule: GcTeamSchedule };

/** A schedule's game, from the side of the team whose schedule it is, against one of the others. */
type Listed = { from: string; against: string; game: GcGame; order: string };

/** Its score, from its own side, when GameChanger calls it final. */
const scoreOf = (game: GcGame): { own: number; theirs: number } | undefined =>
  game.status === "completed" && game.teamScore !== undefined && game.opponentScore !== undefined
    ? { own: game.teamScore, theirs: game.opponentScore }
    : undefined;

/**
 * The games among an organization's pulled teams, as the pool keeps games (`ScoutGame`), so a start
 * drafts them as it drafts a Team Rankings page's (`draftStart`).
 *
 * A game's opponent is one of the pulled teams where its name is that team's and no other pulled
 * team's (`teamNameKey`). A game against anybody else is kept too, against that opponent's
 * name, only so that a team seen playing somebody else that day marks its league game there as
 * likely a tournament's (`tournamentReason`); a start leaves it out of the league.
 *
 * Both teams' schedules list a league game. On each day, each pair's games are paired across the
 * two schedules by their start (`pairCopies`), so a doubleheader stays two games and a game one
 * schedule leaves out is kept on its own. GameChanger says which side was at home, and the game is stood up
 * away first, as League Standings writes it: the away side's own schedule speaks for the score, and
 * the home side's goes beside it where the two disagree, as the pool keeps a second schedule's word
 * (`reportedByB`). A canceled game, or one with no day, is left out.
 */
export const orgGames = (pulled: readonly PulledOrgTeam[]): ScoutGame[] => {
  const ids = new Set(pulled.map((team) => team.teamId));
  const byName = new Map<string, string | null>();
  pulled.forEach(({ teamId, schedule }) => {
    const key = teamNameKey(schedule.profile.name);
    if (!key) return;
    const known = byName.get(key);
    byName.set(key, known === undefined || known === teamId ? teamId : null);
  });
  const opponentOf = (game: GcGame, from: string): string | undefined => {
    const named = byName.get(teamNameKey(game.opponentName));
    return named && named !== from ? named : undefined;
  };

  const league = new Map<string, Map<string, Listed[]>>();
  const outside: ScoutGame[] = [];
  pulled.forEach(({ teamId, schedule }) => {
    schedule.games.forEach((game) => {
      if (game.status === "canceled" || !game.date) return;
      const order = `${game.startTs ?? ""} ${game.id}`;
      const opponent = opponentOf(game, teamId);
      if (opponent === undefined || !ids.has(opponent)) {
        outside.push({
          id: `${teamId}:${game.id}`,
          ageGroupId: ORG_PAGE,
          teamAId: teamId,
          teamBId: `outside:${teamNameKey(game.opponentName) || game.id}`,
          date: game.date,
        });
        return;
      }
      const pair = [teamId, opponent].sort().join("|");
      const days = league.get(pair) ?? new Map<string, Listed[]>();
      league.set(pair, days);
      const listed = days.get(game.date) ?? [];
      listed.push({ from: teamId, against: opponent, game, order });
      days.set(game.date, listed);
    });
  });

  const games: ScoutGame[] = [];
  league.forEach((days, pair) => {
    const [first, second] = pair.split("|") as [string, string];
    days.forEach((listed, date) => {
      const side = (id: string) =>
        listed.filter((one) => one.from === id).sort((a, b) => a.order.localeCompare(b.order));
      pairCopies(side(first), side(second)).forEach((copies) => games.push(standUp(copies, date)));
    });
  });
  return [...games, ...outside];
};

/** Two schedules' starts this far apart or less can be one game; a doubleheader's are hours apart. */
const SAME_GAME_MS = 60 * 60_000;

/**
 * One pair's games on one day, as each schedule lists them, matched into games: by their start, the
 * nearest first, within the hour, since one scorekeeper's 6:00 is another's 6:05 and a
 * doubleheader's two games are hours apart. A copy with no start (an all-day entry) can be told by
 * nothing else, so it takes the other side's first copy left over; any copy still unmatched is a
 * game of its own. Not by place in the list: with a doubleheader one schedule lists in full and the
 * other only half of, that paired the first game's copy with the second's (Codex on #460).
 */
const pairCopies = (
  mine: readonly Listed[],
  theirs: readonly Listed[]
): Array<[Listed | undefined, Listed | undefined]> => {
  const startOf = (copy: Listed) => Date.parse(copy.game.startTs ?? "");
  const near: Array<{ at: number; to: number; apart: number }> = [];
  mine.forEach((one, at) =>
    theirs.forEach((other, to) => {
      const apart = Math.abs(startOf(one) - startOf(other));
      if (apart <= SAME_GAME_MS) near.push({ at, to, apart });
    })
  );
  near.sort((a, b) => a.apart - b.apart || a.at - b.at || a.to - b.to);
  const pairs: Array<[Listed | undefined, Listed | undefined]> = [];
  const usedMine = new Set<number>();
  const usedTheirs = new Set<number>();
  near.forEach(({ at, to }) => {
    if (usedMine.has(at) || usedTheirs.has(to)) return;
    usedMine.add(at);
    usedTheirs.add(to);
    pairs.push([mine[at], theirs[to]]);
  });
  const untimed = (copy: Listed) => !Number.isFinite(startOf(copy));
  const leftOver = theirs.filter((_, to) => !usedTheirs.has(to));
  mine.forEach((one, at) => {
    if (usedMine.has(at)) return;
    const match = leftOver.findIndex((other) => untimed(one) || untimed(other));
    pairs.push([one, match < 0 ? undefined : leftOver.splice(match, 1)[0]]);
  });
  leftOver.forEach((other) => pairs.push([undefined, other]));
  const first = ([one, other]: [Listed | undefined, Listed | undefined]) =>
    [one?.order, other?.order].filter((order): order is string => order !== undefined).sort()[0] ??
    "";
  return pairs.sort((a, b) => first(a).localeCompare(first(b)));
};

/** One league game from the one or two schedules that list it, stood up away first. */
const standUp = (copies: [Listed | undefined, Listed | undefined], date: string): ScoutGame => {
  const listed = copies.filter((copy): copy is Listed => copy !== undefined);
  const first = listed[0]!;
  // Who was away: the first schedule to say; where neither does, the first schedule's own side.
  const said = listed.find((copy) => copy.game.homeAway !== undefined);
  const awayId = said ? (said.game.homeAway === "away" ? said.from : said.against) : first.from;
  const homeId = awayId === first.from ? first.against : first.from;
  const away = listed.find((copy) => copy.from === awayId);
  const home = listed.find((copy) => copy.from === homeId);
  const awayScore = away ? scoreOf(away.game) : undefined;
  const homeScore = home ? scoreOf(home.game) : undefined;
  // The away side's schedule speaks for the score; the home side's where the away side's has none.
  const runs = awayScore
    ? { away: awayScore.own, home: awayScore.theirs }
    : homeScore
      ? { away: homeScore.theirs, home: homeScore.own }
      : undefined;
  const named = away ?? first;
  return {
    id: `${named.from}:${named.game.id}`,
    ageGroupId: ORG_PAGE,
    teamAId: awayId,
    teamBId: homeId,
    date,
    ...(named.game.startTs ? { startTs: named.game.startTs } : {}),
    ...(runs ? { teamAScore: runs.away, teamBScore: runs.home } : {}),
    ...(awayScore && homeScore
      ? { reportedByB: { teamAScore: homeScore.theirs, teamBScore: homeScore.own } }
      : {}),
  };
};

/**
 * The draft a start from an organization's pulled teams opens on: every game between two of
 * `clubIds`, over every day they played, as a Team Rankings start drafts its own (`draftStart`).
 * GameChanger keeps a team to one season, so its whole schedule is the season's, and no stretch of
 * days is asked. Every pulled team's games are read, so one taken out of the league still marks a
 * day the others played it on.
 */
export const orgDraft = (
  pulled: readonly PulledOrgTeam[],
  clubIds: readonly string[]
): StartDraft => {
  const games = orgGames(pulled);
  const days = games.flatMap((game) => (game.date ? [game.date] : [])).sort();
  return draftStart({
    clubIds,
    games,
    from: days[0] ?? "0000-01-01",
    to: days[days.length - 1] ?? "9999-12-31",
  });
};

/**
 * The Team Rankings page a season from these teams belongs on, by its age and squad year, so it is
 * placed there as a start from Team Rankings places its season: the group's age, else the age most
 * of the pulled teams' own profiles give; the group's season ("Fall 2026" is squad year 2027,
 * `squadYearFromName`), else the squad year of its first game. Undefined where either cannot be
 * read, and the season is made without being placed.
 */
export const orgStartPage = (
  group: GcOrgGroup,
  pulled: readonly PulledOrgTeam[],
  draft: StartDraft
): StartPage | undefined => {
  const counts = new Map<number, number>();
  pulled.forEach(({ schedule }) => {
    const level = schedule.profile.ageLevel;
    if (level !== undefined) counts.set(level, (counts.get(level) ?? 0) + 1);
  });
  const most = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
  const ageLevel = group.ageLevel ?? most;
  const firstDay = draft.games[0]?.date;
  const year = group.season
    ? squadYearFromName(`${group.season.name} ${group.season.year}`)
    : firstDay
      ? segmentOn(firstDay).year
      : undefined;
  if (ageLevel === undefined || year === undefined) return undefined;
  return { id: "", name: `${ageLevel}U ${year}`, ageLevel, year };
};
