/**
 * The two halves of a fixture, as a file — what joining a stand-in to its club is measured on.
 *
 * Both clubs post a game, and GameChanger's games payload names the opponent without an id. So
 * when the Raiders are pulled their row says "River City Raptors", and if the Raptors have not
 * been adopted by then that row goes onto a stand-in. When the Raptors are pulled and refuse the
 * stand-in — a neighbour across a state line is refused, `stateFits` — their own row for the same
 * game goes onto a stand-in for the Raiders, or onto the Raiders twice. One game, two rows, and
 * neither club connected to the other. The pool-names export showed the shape of it: 4,995
 * stand-ins with exactly one ranked club of the same name, age and year, and 1,357 of those
 * mirrored, each club holding a stand-in for the other.
 *
 * The game is what can prove a join where a name cannot. A club plays one game at one instant, so
 * a Raiders row at 6 PM against "Raptorz" and a Raptors row at 6 PM against the Raiders are one
 * game, spelling and all. Whether that holds often enough to act on, and how often it would join
 * two games that merely share a start time, is a question for the pool's own games — and the
 * whole-browser backup that carries them is too large to hand over. This is the part of it the
 * question needs: every row with a stand-in or a bracket slot on one side, and beside it each row
 * that could be its other half.
 *
 * "Could be" is deliberately generous, because the rule is decided afterwards against this file
 * and a candidate left out here is one no rule can be tried on. A candidate is written when:
 *
 * - **same-club** — the puller has another row at the very same instant. It cannot play two games
 *   at once, so one of them is the other's half, already filed against somebody.
 * - **fixture** — another club has a row at the same instant, in the same season year, whose
 *   names support at least one of the two claims (that club is the stand-in; its opponent is the
 *   puller) and whose result does not contradict — or supports both claims if it does. Only a row
 *   that is itself unsettled qualifies: against a stand-in or a slot of its own, or against a
 *   pulled club of exactly the puller's name, a namesake it may have been filed against. A row
 *   between two clubs that are already connected is somebody else's game: on a pool of real names
 *   paired at random, admitting those raised the stand-in rows with a decoy at the instant from 460
 *   to 2,057 and those with a same-day "match" from 1,343 to 5,649 — every one of them chance — and
 *   took thirty seconds rather than twelve.
 * - **same-day** — the same, on the same day at another time or with no time, held to more: both
 *   names supporting it and the results not contradicting. The two schedules of one game do not
 *   always agree on its start: `resolveSlotGames` records that requiring the times to match left
 *   about a thousand settled games standing. One name and a mirrored result is not enough on a day:
 *   on a pool of real names paired at random, admitting it took the same-day search from 1,343
 *   rows of 94,000 to 6,104, every one of them chance. The puller's own other rows that day are
 *   asked the same question.
 * - **decoy** / **day-decoy** — the fixture and same-day searches run again a week either side, at
 *   the same hour and the same day of the week, where the schedule looks the same and the game is
 *   not there. What turns up is the rate at which each search matches by chance, which is the
 *   false-positive tripwire a rule is measured against. A week rather than an hour, because an hour
 *   off is exactly the mistake two coaches typing one start time make.
 *
 * Rows with no candidate at all are written too, as `none`, because they are the denominator.
 *
 * "Supports" is loose on purpose — the same key, the same letters run together, a word in common
 * that is not a colour or "baseball", or a word a slip apart (a letter dropped, added, changed or
 * two swapped), which is what lets a misspelling through. It lets through a changed digit too, and
 * "2032" beside "2033" is two graduating classes rather than a typo; the file carries both names in
 * full, so a stricter reading can be applied to it afterwards. Nothing in the app reads this file.
 *
 * Each side's date is written beside its start time, and each club's last pull beside its name,
 * because the first question about a pair that never joined is why the rung that joins exact
 * names did not: `scheduleConfirms` needs the dates to agree and the results to mirror, and a row
 * filed before today's rules is never looked at again on arrival.
 */

import { csvEscape } from "./csv";
import { ageGroupLevel, ageGroupYear, teamNameKey } from "./teamRankings";
import type { AgeGroup, ScoutGame, ScoutTeam } from "./teamRankings";

export const STAND_IN_FIXTURES_CSV_HEADERS = [
  "Kind",
  "Game ID",
  "Date",
  "Start",
  "Year",
  "Level",
  "Puller ID",
  "Puller Name",
  "Puller State",
  "Puller Filed",
  "Puller Pulled",
  "Stand-in ID",
  "Stand-in Name",
  "Stand-in Kind",
  "Puller Score",
  "Stand-in Score",
  // How many of each were found, before the caps on what is written.
  "Candidates",
  "Same Day",
  "Decoys",
  "Day Decoys",
  "Other Game ID",
  "Other Date",
  "Other Start",
  "Other Level",
  // The side of the other row claimed to be the stand-in…
  "Match ID",
  "Match Name",
  "Match State",
  "Match Kind",
  "Match Pulled",
  // …and the side claimed to be the puller.
  "Opposite ID",
  "Opposite Name",
  "Opposite Kind",
  "Match Score",
  "Opposite Score",
  "Filed By",
  "Scores",
  "Name Links",
  "Exact Names",
  "Same Event",
] as const;

/** Written per stand-in row, strongest first; the counts beside them are never capped. */
const MAX_FIXTURES = 5;
const MAX_SAME_DAY = 3;
const MAX_DECOYS = 3;
/**
 * Stand-in rows searched between breaths. A pool of real size takes seconds, and a tab that does
 * not repaint for that long looks hung and can be offered to the user to kill.
 */
const ROWS_BETWEEN_PAUSES = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

type Kind = "club" | "name-only" | "slot" | "other";

const kindOf = (team: ScoutTeam | undefined): Kind =>
  team?.placeholder
    ? "slot"
    : team?.nameOnly
      ? "name-only"
      : team?.gcTeams?.length
        ? "club"
        : "other";

/**
 * Words too common to say two names are one club. Colours are how a club tells its own squads
 * apart, so they separate teams rather than join them; the rest are on every other name.
 */
const GENERIC = new Set([
  "baseball",
  "club",
  "team",
  "the",
  "and",
  "fall",
  "spring",
  "summer",
  "winter",
  "elite",
  "select",
  "travel",
  "academy",
  "black",
  "blue",
  "red",
  "white",
  "gold",
  "navy",
  "grey",
  "gray",
  "green",
  "orange",
  "purple",
  "silver",
  "maroon",
  "royal",
]);

/** Too short to call a one-letter difference a misspelling: "Heat" and "Heap" are two names. */
const MIN_SPELLING_LENGTH = 5;

/**
 * Whether two spellings are one slip apart: a letter dropped, added or changed, or two neighbours
 * swapped. "Woodchuks" and "Woodchucks" are; "Heat" and "Heap" are too short to say.
 */
const oneSlipApart = (a: string, b: string): boolean => {
  if (a === b) return true;
  if (a.length < MIN_SPELLING_LENGTH || b.length < MIN_SPELLING_LENGTH) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (long.length - short.length > 1) return false;
  let i = 0;
  while (i < short.length && short[i] === long[i]) i += 1;
  // The rest of `short` from `from` against the rest of `long` from `from + skip`, without making
  // either: this runs for every pair of words an instant's index hands back.
  const restMatches = (from: number, skip: number) => {
    for (let j = from; j < short.length; j += 1) if (short[j] !== long[j + skip]) return false;
    return true;
  };
  if (short.length === long.length) {
    // Changed here, or swapped with the next letter; either way the rest must be the same.
    return (
      restMatches(i + 1, 0) ||
      (short[i] === long[i + 1] && short[i + 1] === long[i] && restMatches(i + 2, 0))
    );
  }
  // One letter more on the long side, here.
  return restMatches(i, 1);
};

/**
 * A spelling with each letter left out in turn, and the spelling itself — what an index files a
 * name under, so that "Woodchuks" finds "Woodchucks" without comparing every name at an instant
 * with every other. Any two spellings a slip apart share one of these. So do a few that are two
 * slips apart — a letter off the front of one and onto the end of the other — which is why
 * `oneSlipApart` is asked again of whatever the index hands back.
 */
const slipKeys = (spelling: string): string[] => {
  if (spelling.length < MIN_SPELLING_LENGTH) return [];
  const keys = [spelling];
  for (let i = 0; i < spelling.length; i += 1) {
    keys.push(spelling.slice(0, i) + spelling.slice(i + 1));
  }
  return keys;
};

type NameShape = {
  key: string;
  tokens: string[];
  tokenSet: Set<string>;
  /** The whole name run together, letters and digits only: "Blue Jays" and "Bluejays" are one. */
  squashed: string;
};

const shapeOf = (name: string): NameShape => {
  const key = teamNameKey(name);
  const tokens = key
    .split(" ")
    .map((token) => token.replace(/[^a-z0-9]/g, ""))
    .filter((token) => token.length >= 3 && !/^\d+$/.test(token) && !GENERIC.has(token));
  return { key, tokens, tokenSet: new Set(tokens), squashed: key.replace(/[^a-z0-9]/g, "") };
};

/**
 * The same key, the same letters run together, a word in common, or a word a slip apart — so
 * "Woodchuks" is akin to "Woodchucks Black" as well as to "Woodchucks", and "Blue Jays" to
 * "Bluejays". A slip is looked for word by word rather than across the whole name: a name of
 * several words with one misspelt still shares the others, and slip keys for whole names were the
 * largest cost in the export on a pool of real size.
 */
const akin = (a: NameShape, b: NameShape): boolean =>
  a.key === b.key ||
  a.squashed === b.squashed ||
  a.tokens.some((token) => b.tokenSet.has(token)) ||
  a.tokens.some((mine) => b.tokens.some((theirs) => oneSlipApart(mine, theirs)));

/**
 * What an index files a name under — exactly the four things `akin` accepts, so the index finds
 * everything it would and it is asked again only because slip keys are generous. Made when a name
 * is filed or looked up, never kept: a score of strings for each of a hundred thousand teams is
 * more than a browser tab should hold for a diagnostic.
 */
const nameKeysOf = (shape: NameShape): string[] => {
  // A key twice files an entry twice, which every search already reads past; making them unique
  // cost more than it saved.
  const keys = [`=${shape.key}`, `s${shape.squashed}`];
  shape.tokens.forEach((token) => {
    keys.push(`w${token}`);
    slipKeys(token).forEach((slip) => keys.push(`~${slip}`));
  });
  return keys;
};

type Scores = "agree" | "differ" | "unscored";

/** Whether a pair of results says the same thing: `mine`/`theirs` read off both rows in one orientation. */
const relate = (
  mine: number | undefined,
  theirs: number | undefined,
  mineThere: number | undefined,
  theirsThere: number | undefined
): Scores => {
  if (mine === undefined || theirs === undefined) return "unscored";
  if (mineThere === undefined || theirsThere === undefined) return "unscored";
  return mine === mineThere && theirs === theirsThere ? "agree" : "differ";
};

const scoreOf = (game: ScoutGame, teamId: string): number | undefined =>
  game.teamAId === teamId ? game.teamAScore : game.teamBScore;

type CandidateKind = "same-club" | "fixture" | "same-day" | "decoy" | "day-decoy";

type Candidate = {
  kind: CandidateKind;
  game: ScoutGame;
  matchId: string;
  oppositeId: string;
  scores: Scores;
  links: number;
  exact: number;
};

const strength = (c: Candidate): number =>
  c.links * 10 + (c.scores === "agree" ? 4 : c.scores === "unscored" ? 2 : 0) + c.exact;

const byStrength = (a: Candidate, b: Candidate): number =>
  strength(b) - strength(a) || (a.game.id < b.game.id ? -1 : a.game.id > b.game.id ? 1 : 0);

/**
 * At the instant: both names — whatever the results say, since one start time is one game and two
 * scores for it are a dispute about it — or one name and a mirrored result. One shared word and
 * nothing else was the chance match: on a pool of real names paired at random it found a candidate
 * for 18,679 of 84,000 stand-in rows, more than one in five, a rate no rule could act on, so the
 * file does not carry it.
 */
const fixtureAccepts = (links: number, scores: Scores): boolean =>
  links === 2 || scores === "agree";

/**
 * On the day, with no shared instant to lean on: both names, and a contradicting result never,
 * because at another time that is as likely a second game.
 */
const sameDayAccepts = (links: number, scores: Scores): boolean =>
  links === 2 && scores !== "differ";

/**
 * One instant's games, or one day's, indexed by what a lookup asks of them: the rows each team is
 * on, the club sides of unsettled rows by name, and the sides opposite them by name. Built for a
 * week or two of the season at a time, because an index over every game in a nationwide pool at
 * once would hold millions of keys to answer questions about a few thousand.
 */
/**
 * One side of a row as an index files it, with what a search asks of it carried along — the two
 * names' shapes and whether the far side is a slot — rather than looked up again on every visit.
 */
type Entry = {
  game: ScoutGame;
  club: string;
  other: string;
  clubShape: NameShape;
  otherShape: NameShape;
  otherIsSlot: boolean;
};
/** A row as the puller's own rows are read: which side is whose, and nothing more. */
type TeamEntry = Pick<Entry, "game" | "club" | "other">;
type GameIndex = {
  byTeam: Map<string, TeamEntry[]>;
  byClubName: Map<string, Entry[]>;
  byOppositeName: Map<string, Entry[]>;
};

const push = <E>(index: Map<string, E[]>, key: string, entry: E) => {
  const bucket = index.get(key);
  if (bucket) bucket.push(entry);
  else index.set(key, [entry]);
};

/** "2026-09-19" a number of days on, or undefined for a date that does not read as one. */
const shiftDay = (date: string, days: number): string | undefined => {
  const ms = Date.parse(`${date}T00:00:00.000Z`);
  return Number.isFinite(ms) ? new Date(ms + days * DAY_MS).toISOString().slice(0, 10) : undefined;
};

/** A season has a few hundred distinct days and every row asks about three of them. */
const dayShifts = new Map<string, string | undefined>();
const shiftDayOnce = (date: string, days: number): string | undefined => {
  const key = `${date}${days}`;
  if (dayShifts.has(key)) return dayShifts.get(key);
  const shifted = shiftDay(date, days);
  dayShifts.set(key, shifted);
  return shifted;
};

type Found = {
  candidates: Candidate[];
  sameDay: Candidate[];
  decoys: Candidate[];
  dayDecoys: Candidate[];
};
const NOTHING_FOUND: Found = { candidates: [], sameDay: [], decoys: [], dayDecoys: [] };

/**
 * The stand-in rows and their candidate other halves, a chunk at a time, for a Blob to assemble
 * without one giant string. `pause` is awaited every thousand rows searched, with how many of how
 * many are done, so a caller on the page can say how far along it is and hand the browser a moment
 * to paint; a test leaves it out. On a pool of 241,000 games built from real team names it took
 * twelve seconds, which is why it says.
 */
export const standInFixturesCsvParts = async (
  teams: readonly ScoutTeam[],
  ageGroups: readonly AgeGroup[],
  games: readonly ScoutGame[],
  pause: (searched: number, of: number) => Promise<void> = () => Promise.resolve()
): Promise<string[]> => {
  const teamById = new Map(teams.map((team) => [team.id, team]));
  // Read once per group: parsing a group's name for every row was a twentieth of the export.
  const yearByGroup = new Map(ageGroups.map((group) => [group.id, ageGroupYear(group)]));
  const levelByGroup = new Map(ageGroups.map((group) => [group.id, ageGroupLevel(group)]));
  const yearOf = (game: ScoutGame) => yearByGroup.get(game.ageGroupId);
  const levelOf = (game: ScoutGame) => levelByGroup.get(game.ageGroupId);
  const shapes = new Map<string, NameShape>();
  const shape = (teamId: string): NameShape => {
    const known = shapes.get(teamId);
    if (known) return known;
    const made = shapeOf(teamById.get(teamId)?.name ?? teamId);
    shapes.set(teamId, made);
    return made;
  };
  const kinds = new Map(teams.map((team) => [team.id, kindOf(team)]));
  const kind = (teamId: string): Kind => kinds.get(teamId) ?? "other";
  const gcIds = (teamId: string) =>
    new Set((teamById.get(teamId)?.gcTeams ?? []).map((link) => link.teamId));
  /** The last time any of a club's listings was pulled; ISO strings sort as instants. */
  const pulledAt = (teamId: string): string =>
    (teamById.get(teamId)?.gcTeams ?? []).reduce(
      (latest, link) =>
        link.importedAt !== undefined && link.importedAt > latest ? link.importedAt : latest,
      ""
    );
  const instantOf = (game: ScoutGame): number | undefined => {
    if (!game.startTs) return undefined;
    const ms = Date.parse(game.startTs);
    return Number.isFinite(ms) ? ms : undefined;
  };

  // The rows in question: one side a pulled club, the other a stand-in or a bracket slot.
  type StandInRow = { game: ScoutGame; pullerId: string; standInId: string; at?: number };
  const standInRows: StandInRow[] = [];
  // Read once: parsing a start time inside the search was the one thing in it that was not cheap.
  const instants = new Map<ScoutGame, number>();
  const byInstant = new Map<number, ScoutGame[]>();
  const byDay = new Map<string, ScoutGame[]>();
  const file = <K>(buckets: Map<K, ScoutGame[]>, key: K, game: ScoutGame) => {
    const bucket = buckets.get(key);
    if (bucket) bucket.push(game);
    else buckets.set(key, [game]);
  };
  games.forEach((game) => {
    const at = instantOf(game);
    if (at !== undefined) {
      instants.set(game, at);
      file(byInstant, at, game);
    }
    if (game.date) file(byDay, game.date, game);
    const a = kind(game.teamAId);
    const b = kind(game.teamBId);
    const standIn = (k: Kind) => k === "name-only" || k === "slot";
    if (a === "club" && standIn(b)) {
      standInRows.push({ game, pullerId: game.teamAId, standInId: game.teamBId, at });
    } else if (b === "club" && standIn(a)) {
      standInRows.push({ game, pullerId: game.teamBId, standInId: game.teamAId, at });
    }
  });

  const indexOf = (bucket: readonly ScoutGame[]): GameIndex => {
    const index: GameIndex = {
      byTeam: new Map(),
      byClubName: new Map(),
      byOppositeName: new Map(),
    };
    bucket.forEach((game) => {
      push(index.byTeam, game.teamAId, { game, club: game.teamAId, other: game.teamBId });
      push(index.byTeam, game.teamBId, { game, club: game.teamBId, other: game.teamAId });
      const sides: [string, string][] = [
        [game.teamAId, game.teamBId],
        [game.teamBId, game.teamAId],
      ];
      sides.forEach(([club, other]) => {
        if (kind(club) !== "club") return;
        const entry: Entry = {
          game,
          club,
          other,
          clubShape: shape(club),
          otherShape: shape(other),
          otherIsSlot: kind(other) === "slot",
        };
        const otherKind = kind(other);
        if (otherKind === "club") {
          // Settled, unless the side opposite is a namesake of the puller: the exact name only.
          push(index.byOppositeName, `=${entry.otherShape.key}`, entry);
          return;
        }
        if (otherKind !== "name-only" && otherKind !== "slot") return;
        nameKeysOf(entry.clubShape).forEach((key) => push(index.byClubName, key, entry));
        if (otherKind === "name-only") {
          nameKeysOf(entry.otherShape).forEach((key) => push(index.byOppositeName, key, entry));
        }
      });
    });
    return index;
  };
  // A sliding window of indexes, dropped once the rows being searched have moved past them.
  const instantIndexes = new Map<number, GameIndex>();
  const dayIndexes = new Map<string, GameIndex>();
  const atInstant = (at: number): GameIndex => {
    const known = instantIndexes.get(at);
    if (known) return known;
    const made = indexOf(byInstant.get(at) ?? []);
    instantIndexes.set(at, made);
    return made;
  };
  const onDay = (day: string): GameIndex => {
    const known = dayIndexes.get(day);
    if (known) return known;
    const made = indexOf(byDay.get(day) ?? []);
    dayIndexes.set(day, made);
    return made;
  };

  type Keys = { standIn: string[]; puller: string[] };
  /**
   * Another club's unsettled row in `index` that could be this stand-in row's other half, as far
   * as the names can say and `accepts` allows. A same-day search leaves the rows at this row's own
   * instant to the fixture search, which has already asked about them. `bothNames` says `accepts`
   * takes nothing less, so only rows filed under both names' keys are read at all — a whole day's
   * rows sharing a common word are otherwise most of the export's time.
   */
  const othersHalves = (
    row: StandInRow,
    index: GameIndex,
    keys: Keys,
    kindName: CandidateKind,
    accepts: (links: number, scores: Scores) => boolean,
    skipOwnInstant: boolean,
    bothNames: boolean
  ): Candidate[] => {
    const { game, pullerId, standInId } = row;
    const puller = shape(pullerId);
    const standIn = shape(standInId);
    const standInIsSlot = kind(standInId) === "slot";
    const year = yearOf(game);
    // By the entry itself: one row sits under several of its names' keys, as the same object.
    const seen = new Set<Entry>();
    const found: Candidate[] = [];
    const consider = (entry: Entry) => {
      if (seen.has(entry)) return;
      seen.add(entry);
      const { game: other, club, other: opposite } = entry;
      if (other.id === game.id) return;
      // A row the puller is on is asked about separately; one the stand-in is on says nothing.
      if (other.teamAId === pullerId || other.teamBId === pullerId) return;
      if (club === standInId || opposite === standInId) return;
      if (yearOf(other) !== year) return;
      if (skipOwnInstant && row.at !== undefined && instants.get(other) === row.at) return;
      const scores = relate(
        scoreOf(game, pullerId),
        scoreOf(game, standInId),
        scoreOf(other, opposite),
        scoreOf(other, club)
      );
      // The results first, because they are arithmetic and the names are not: a pairing that
      // both names could not carry is not worth reading the names for.
      if (!accepts(2, scores)) return;
      const matchLinks = !standInIsSlot && akin(standIn, entry.clubShape) ? 1 : 0;
      // Nor, when it needs both, one the first name has already failed.
      if (matchLinks === 0 && !accepts(1, scores)) return;
      const oppositeLinks = !entry.otherIsSlot && akin(puller, entry.otherShape) ? 1 : 0;
      const links = matchLinks + oppositeLinks;
      // The index is generous about spelling, so what it hands back is asked again here.
      if (links === 0) return;
      if (!accepts(links, scores)) return;
      const exact =
        (!standInIsSlot && standIn.key === entry.clubShape.key ? 1 : 0) +
        (!entry.otherIsSlot && puller.key === entry.otherShape.key ? 1 : 0);
      found.push({
        kind: kindName,
        game: other,
        matchId: club,
        oppositeId: opposite,
        scores,
        links,
        exact,
      });
    };
    if (bothNames) {
      const underTheStandIn = new Set<Entry>();
      keys.standIn.forEach((key) =>
        index.byClubName.get(key)?.forEach((entry) => underTheStandIn.add(entry))
      );
      keys.puller.forEach((key) =>
        index.byOppositeName.get(key)?.forEach((entry) => {
          if (underTheStandIn.has(entry)) consider(entry);
        })
      );
    } else {
      keys.standIn.forEach((key) => index.byClubName.get(key)?.forEach(consider));
      keys.puller.forEach((key) => index.byOppositeName.get(key)?.forEach(consider));
    }
    return found.sort(byStrength);
  };

  /**
   * The puller's own other rows in `index`: at this instant, where it cannot have played two
   * games; or on this day at another time, held to what a same-day candidate is held to.
   */
  const pullersOwn = (row: StandInRow, index: GameIndex, onTheDay: boolean): Candidate[] => {
    const { game, pullerId, standInId } = row;
    const standIn = shape(standInId);
    const standInIsSlot = kind(standInId) === "slot";
    const found: Candidate[] = [];
    (index.byTeam.get(pullerId) ?? []).forEach(({ game: other, other: match }) => {
      if (other.id === game.id || match === standInId) return;
      if (onTheDay && row.at !== undefined && instants.get(other) === row.at) return;
      const matchIsSlot = kind(match) === "slot";
      const akinName = !standInIsSlot && !matchIsSlot && akin(standIn, shape(match));
      const links = akinName ? 2 : 1;
      const scores = relate(
        scoreOf(game, pullerId),
        scoreOf(game, standInId),
        scoreOf(other, pullerId),
        scoreOf(other, match)
      );
      if (onTheDay && !sameDayAccepts(links, scores)) return;
      found.push({
        kind: onTheDay ? "same-day" : "same-club",
        game: other,
        matchId: match,
        oppositeId: pullerId,
        scores,
        links,
        exact: (!standInIsSlot && standIn.key === shape(match).key ? 1 : 0) + 1,
      });
    });
    return found.sort(byStrength);
  };

  const search = (row: StandInRow): Found => {
    const day = row.game.date;
    const at = row.at;
    const keys: Keys = {
      standIn: kind(row.standInId) === "slot" ? [] : nameKeysOf(shape(row.standInId)),
      puller: nameKeysOf(shape(row.pullerId)),
    };
    const candidates =
      at === undefined
        ? []
        : [
            ...pullersOwn(row, atInstant(at), false),
            ...othersHalves(row, atInstant(at), keys, "fixture", fixtureAccepts, false, false),
          ];
    const decoys =
      at === undefined
        ? []
        : [at - WEEK_MS, at + WEEK_MS]
            .flatMap((when) =>
              othersHalves(row, atInstant(when), keys, "decoy", fixtureAccepts, false, false)
            )
            .sort(byStrength);
    if (!day) return { ...NOTHING_FOUND, candidates, decoys };
    const sameDay = [
      ...pullersOwn(row, onDay(day), true),
      ...othersHalves(row, onDay(day), keys, "same-day", sameDayAccepts, true, true),
    ].sort(byStrength);
    const dayDecoys = [shiftDayOnce(day, -7), shiftDayOnce(day, 7)]
      .flatMap((when) =>
        when === undefined
          ? []
          : othersHalves(row, onDay(when), keys, "day-decoy", sameDayAccepts, false, true)
      )
      .sort(byStrength);
    return { candidates, sameDay, decoys, dayDecoys };
  };

  // Day by day, then instant by instant, so each index is built once and dropped once the window
  // has passed it. The window reaches a little over a week back, for the decoys.
  const ordered = standInRows
    .map((row, order) => ({ row, order }))
    .sort(
      (a, b) =>
        (a.row.game.date ?? "￿").localeCompare(b.row.game.date ?? "￿") ||
        (a.row.at ?? Infinity) - (b.row.at ?? Infinity) ||
        a.order - b.order
    );
  const found = new Map<StandInRow, Found>();
  for (const [searched, { row }] of ordered.entries()) {
    if (searched > 0 && searched % ROWS_BETWEEN_PAUSES === 0) {
      await pause(searched, ordered.length);
    }
    if (row.at !== undefined) {
      const oldestInstant = row.at - WEEK_MS - DAY_MS;
      instantIndexes.forEach((_, when) => {
        if (when < oldestInstant) instantIndexes.delete(when);
      });
    }
    const oldestDay = row.game.date ? shiftDayOnce(row.game.date, -8) : undefined;
    if (oldestDay !== undefined) {
      dayIndexes.forEach((_, day) => {
        if (day < oldestDay) dayIndexes.delete(day);
      });
    }
    found.set(row, search(row));
  }

  const parts = [`${STAND_IN_FIXTURES_CSV_HEADERS.join(",")}\n`];
  const nameOf = (teamId: string) => teamById.get(teamId)?.name ?? teamId;
  const stateOf = (teamId: string) => teamById.get(teamId)?.state ?? "";
  const scoreCell = (value: number | undefined) => (value === undefined ? "" : value);
  const eventKey = (game: ScoutGame) => game.event?.trim().toLowerCase() || undefined;
  standInRows.forEach((row) => {
    const { game, pullerId, standInId } = row;
    const those = found.get(row) ?? NOTHING_FOUND;
    const pullerIds = gcIds(pullerId);
    const head = [
      game.id,
      game.date ?? "",
      game.startTs ?? "",
      yearOf(game) ?? "",
      levelOf(game) ?? "",
      pullerId,
      nameOf(pullerId),
      stateOf(pullerId),
      game.source ? (pullerIds.has(game.source.teamId) ? "yes" : "no") : "",
      pulledAt(pullerId),
      standInId,
      nameOf(standInId),
      kind(standInId),
      scoreCell(scoreOf(game, pullerId)),
      scoreCell(scoreOf(game, standInId)),
      those.candidates.length,
      those.sameDay.length,
      those.decoys.length,
      those.dayDecoys.length,
    ];
    const line = (kindName: string, tail: (string | number)[]) =>
      parts.push(`${[kindName, ...head, ...tail].map(csvEscape).join(",")}\n`);
    const tailOf = (c: Candidate): (string | number)[] => {
      const source = c.game.source?.teamId;
      const filedBy =
        source === undefined
          ? ""
          : gcIds(c.matchId).has(source)
            ? "match"
            : gcIds(c.oppositeId).has(source)
              ? "opposite"
              : "";
      const mine = eventKey(game);
      const theirs = eventKey(c.game);
      return [
        c.game.id,
        c.game.date ?? "",
        c.game.startTs ?? "",
        levelOf(c.game) ?? "",
        c.matchId,
        nameOf(c.matchId),
        stateOf(c.matchId),
        kind(c.matchId),
        pulledAt(c.matchId),
        c.oppositeId,
        nameOf(c.oppositeId),
        kind(c.oppositeId),
        scoreCell(scoreOf(c.game, c.matchId)),
        scoreCell(scoreOf(c.game, c.oppositeId)),
        filedBy,
        c.scores,
        c.links,
        c.exact,
        mine === undefined || theirs === undefined ? "" : mine === theirs ? "yes" : "no",
      ];
    };
    const shown = [
      ...those.candidates.filter((c) => c.kind === "same-club"),
      ...those.candidates.filter((c) => c.kind === "fixture").slice(0, MAX_FIXTURES),
      ...those.sameDay.slice(0, MAX_SAME_DAY),
      ...those.decoys.slice(0, MAX_DECOYS),
      ...those.dayDecoys.slice(0, MAX_DECOYS),
    ];
    if (shown.length === 0) {
      line("none", []);
      return;
    }
    shown.forEach((c) => line(c.kind, tailOf(c)));
  });
  return parts;
};

/** "gamechanger-stand-in-fixtures-2026-09-22.csv" */
export const standInFixturesCsvFilename = (day: string): string =>
  `gamechanger-stand-in-fixtures-${day}.csv`;
