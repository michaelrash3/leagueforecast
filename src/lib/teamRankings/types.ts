/**
 * What a Team Rankings pool is made of.
 *
 * Team Rankings is a separate, age-group-scoped-but-globally-rostered ranking pool: teams are a
 * single global list, because the same real-world opponent is one entity across seasons and age
 * levels, but a ranking is only ever computed for one age group's games at a time, because
 * different age levels are not comparable. An age group is a user-defined label bundling whichever
 * League Standings seasons belong to the same age level — "2027" might bundle a "Fall 2026" and a
 * "Spring 2027" season, since a club often runs two or more per age-group year.
 *
 * These are here rather than in `teamRankings.ts` so that the modules split out of it can share
 * them without importing each other, and without importing the barrel that re-exports them all.
 */

export type AgeGroup = {
  id: string;
  /**
   * Display label, always derived from `ageLevel` + `year` for anything created since the season
   * picker shipped (`formatAgeGroupName`). Older groups were free text ("2027, 10U"), so this
   * stays the authoritative thing to *show*; `ageGroupSeason` is the thing to *reason* with.
   */
  name: string;
  /** Age level in years, 8-18, as in 10U. Absent on groups saved before the picker existed. */
  ageLevel?: number;
  /** Season year, as in the 2028 of "10U 2028". Absent on groups saved before the picker. */
  year?: number;
  /** League Standings `SeasonMeta.id`s that belong to this age group. */
  seasonIds: string[];
  /**
   * The earlier age group this one carries on from — last year's squad, e.g. "9U 2027" for a
   * "10U 2028". Only used to carry team-name suggestions forward as a squad ages up; results are
   * never pooled across age groups, since a 9U score says nothing about a 10U game.
   */
  continuesFromId?: string;
  /** "Our" team *in this age group*, so two squads running at once can each have one. */
  myTeamId?: string;
};

export type ScoutTeam = {
  id: string;
  name: string;
  /**
   * Legacy global "our team" marker, kept so rankings saved before `AgeGroup.myTeamId` existed
   * still highlight the right team. `AgeGroup.myTeamId` supersedes it — a club can run a 9U and an
   * 11U squad at once, and each needs its own — so new marks are written there instead.
   * Cosmetic/organizational only, either way: neither flag may feed into `buildTeamRankings` or
   * `predictMatchup`'s math. Our own team is ranked by the exact same opponent-adjusted formula as
   * everyone else.
   */
  isMine?: boolean;
  /**
   * Two-letter state, uppercase, when it is known. Optional on purpose: most opponents arrive from
   * a screenshot or a schedule that never says where they are from, and a team with no state is a
   * team you simply have not told, not a team from nowhere.
   */
  state?: string;
  /** City, when a source gave one. Display only, like `state`; it never reaches the maths. */
  city?: string;
  /**
   * A name that stood in for a team nobody had decided yet — "TBD", "Winner of Game 3", a blank
   * cell on a bracket. The game it came from is real and is kept, but the club on the other side
   * of it is not known, so this entity is a slot rather than a team.
   *
   * Two things follow, and both matter. Each placeholder is its own slot, never pooled with
   * another of the same name: one shared "TBD" would sit in the rating graph as an opponent that
   * dozens of unrelated teams had all played, and the fit would read that as evidence about how
   * they compare to each other. And a slot is never ranked, because there is no club to rank.
   *
   * It still stands in the fit as one unknown opponent of its own, which is how the game counts
   * for the team that played it: beating a slot reads as beating an ordinary team, because a
   * single game against a single opponent is pulled to the middle by the same shrinkage as any
   * other. Naming it later — renaming the slot onto the real club, which merges the two — moves
   * the game to where it always belonged.
   */
  placeholder?: true;
  /**
   * A club known only because somebody else's schedule named it as their opponent.
   *
   * There is no club behind it yet, only a name and perhaps a picture: no id anybody pulled, no
   * town, no state, and a record made of whatever fraction of its season happens to face a team
   * that *was* pulled. Rating that against clubs whose whole schedule is here would put a team
   * with one recorded win above teams that played thirty games, so it is left out of the tables —
   * exactly as a bracket slot is, and for the same reason.
   *
   * It still stands in the fit as the opponent it was, which is how the game counts for the club
   * that played it. Pull the club's own id, or add it by hand, and the mark comes off: at that
   * point it is a team somebody has vouched for, and it is ranked like any other.
   */
  nameOnly?: true;
  /**
   * The picture a club was listed with by whoever named it as their opponent.
   *
   * An opponent has no GameChanger id — a schedule never gives one — so there is no link to hang
   * its avatar on, and a name is not an identity in a pool holding a dozen clubs called the same
   * thing. The picture is, and it is the one thing that means the same on two schedules, so it is
   * kept here: the next schedule to name this club recognises it, and so does the club itself when
   * its own id is finally pulled. Without it a club named by two schedules becomes two teams and
   * its games are filed twice.
   */
  avatarKey?: string;
  /**
   * The GameChanger teams this team is known by, one per GameChanger season: GameChanger mints a
   * new team id every season, so a club's Fall and Spring squads arrive as two ids that the user
   * has paired onto one team here. Identity by id is what keeps the country's many "Yankees" apart:
   * two teams with different GameChanger ids are two teams, whatever they are called.
   */
  gcTeams?: GcTeamLink[];
};

/** One GameChanger team id and what GameChanger said about it the last time it was pulled. */
export type GcTeamLink = {
  /** GameChanger's public team id — the 12 characters in web.gc.com/teams/<id>. */
  teamId: string;
  /** The name exactly as GameChanger has it, age label and all, for matching and display. */
  name: string;
  /** The age group this GameChanger team's schedule is filed under. */
  ageGroupId: string;
  /** GameChanger's season for this team id: "fall", "winter", "spring" or "summer". */
  season?: string;
  /** The calendar year GameChanger gives that season ("Fall 2026" → 2026). */
  seasonYear?: number;
  /** The age level GameChanger lists, as a number (9 for "9U"). */
  ageLevel?: number;
  /**
   * The id of the team's avatar image. GameChanger names an opponent but never gives its team id;
   * the avatar it shows beside that name is the one stable thing that survives the trip, so a
   * matching avatar on someone else's schedule is how a name-only opponent is recognised as a team
   * already pulled by id.
   */
  avatarKey?: string;
  /** GameChanger's own season record when last pulled — a check on the games read, never rated. */
  record?: { win: number; loss: number; tie: number };
  /**
   * The coaches the user's team list named for this id.
   *
   * Two GameChanger ids sharing two of these are nearly always one club — see `gcStaff.ts` for the
   * measurements. It is the only thing in the data that says so: GameChanger never names an
   * organisation, and club names are written differently on every page it owns.
   */
  staff?: string[];
  /**
   * Players on the roster when the list was taken, and when that was.
   *
   * It takes nine to field a side, so fewer means this is probably a page rather than a team yet.
   * The timestamp is what makes coming back to it possible: a squad of six in September is twelve
   * in October, and only a second count can say which.
   */
  playerCount?: number;
  countedAt?: string;
  /** When this id's schedule was last pulled, ISO timestamp. */
  importedAt?: string;
};

/** Where a game came from, when it was not typed in here. */
export type ScoutGameSource = {
  kind: "gamechanger";
  /** The GameChanger team whose schedule listed the game. */
  teamId: string;
  /** GameChanger's id for the game on that team's schedule — what a re-pull matches on. */
  gameId: string;
};

/**
 * One schedule's row folded into a game, kept whole enough to be judged again.
 *
 * A fold decided on one day's schedules has to stand up to the next day's: a start moves, a score
 * is posted, a doubleheader that sat at one placeholder slot is spread over two. So the row is kept
 * as the schedule last gave it — its start and its score from its own seat — and the tidy puts
 * every folded row back beside the rows still standing and groups them all again
 * (`collapseSameGames`), which moves a row to the game it now fits or stands it up as a game of its
 * own.
 */
export type FoldedRow = {
  /** The GameChanger team whose schedule listed it. */
  teamId: string;
  /** Its id on that schedule. */
  gameId: string;
  startTs?: string;
  /**
   * The day its schedule filed it on, where that is not the game's: one club's copy of a game dated
   * a day off the other's, folded in on the same result or the same start a day apart. Kept so a
   * copy stood back up is filed on its own day, not the game's.
   */
  date?: string;
  /** Its own club's runs, as its schedule gave them. */
  ownScore?: number;
  /** The other club's runs, as its schedule gave them. */
  opponentScore?: number;
  /** Its own club is the game's side B, not side A. */
  onSideB?: boolean;
};

/** The id a GameChanger row is filed under: its schedule and its game id on that schedule. */
export const gcRowId = (teamId: string, gameId: string): string => `gc_${teamId}_${gameId}`;

export type ScoutGame = {
  id: string;
  teamAId: string;
  teamBId: string;
  /**
   * Both present = a completed result (counts toward ratings/record). Both absent = a scheduled/
   * future game — logged so the team shows up in the pool ahead of time, but excluded from every
   * rating and record calculation until a score is entered.
   */
  teamAScore?: number;
  teamBScore?: number;
  /**
   * The score as side B's own schedule gave it, in this game's order: A's runs, then B's.
   *
   * Side A is always the club whose schedule the game came off (`source`) — true of every one of
   * the 248,371 games in the pool of 24 September 2026 — and `teamAScore`/`teamBScore` are what
   * that schedule says, or side B's where side A has posted nothing. When side B's own schedule
   * lists the game, its score is kept here rather than written over side A's. Two schedules
   * disagreed about 13,865 games in that pool, 563 of them about who won, and a single score let
   * whichever schedule was pulled last speak for both clubs, flipping as the refresh went round.
   * Each club's page and record read its own schedule's score (`scoreSeenBy`); the rating reads
   * the game once, at the average of the two (`ratedMargin`).
   */
  reportedByB?: { teamAScore: number; teamBScore: number };
  /**
   * `teamAScore`/`teamBScore` were filled from side B's schedule because side A has posted nothing,
   * so they are side B's word rather than side A's, and go when side B's row does.
   */
  scoreFromB?: boolean;
  /**
   * `teamAScore`/`teamBScore` were filled from another row of side A's own — the same game listed
   * twice — because the row the game stands on has posted nothing, so they go when that row does.
   * Kept as the game's own, a score given by the second listing stayed behind when the two rows
   * turned out to be two games, and the result counted twice.
   */
  scoreFromTwin?: boolean;
  /**
   * The row this game stands on (`source`) is one its schedule no longer lists: deleted, cancelled
   * or taken off the day. Set by the pull that finds it gone and cleared by one that lists it again;
   * the tidy then takes the game away and stands up the rows folded into it, so what the other
   * club's schedule and the club's own new entry say of the game is what is left. Kept, a game its
   * club deleted and entered again all day stood beside the new entry holding the other club's
   * copy, and the one game was counted twice.
   */
  withdrawn?: boolean;
  /** References an `AgeGroup.id` — the age level this result belongs to. */
  ageGroupId: string;
  /**
   * Logged, but deliberately kept out of the ratings and records.
   *
   * Fall tournaments routinely pair a team against the age group above or below, depending on who
   * entered. Those games happened and are worth keeping — but a 10U beating an 8U says nothing
   * about how it stacks up against other 10Us, and letting it count would flatter or punish both
   * sides for something neither chose.
   */
  excluded?: boolean;
  date?: string;
  event?: string;
  note?: string;
  /**
   * The age level each side was playing at, when the source said (8 for 8U). Absent means the
   * level of the age group the game is filed under. They differ when a team plays up or down —
   * an 8U entering a 9U tournament — and that difference is what the rating model reads as an
   * age gap: see `AGE_GAP_RUNS_PER_YEAR` in powerRating.ts. Recorded per game rather than per
   * team because a team's level is a fact about a season, while what the source knows is which
   * level each game was played at.
   */
  ageLevelA?: number;
  ageLevelB?: number;
  /**
   * Other GameChanger schedules that also listed this game, by their team id.
   *
   * Written when a stand-in row is folded into this one: the fold removes a row, and with it the
   * fact that the schedule it came from listed this opponent that day. That fact is load-bearing.
   * Two clubs that meet twice in a day are often written as one named game and one "TBD" on the
   * same schedule, and once the TBD is settled the two results look exactly like one game two
   * scorekeepers disagreed about — which is how a real doubleheader result came to be deleted.
   * Keeping the source here lets `collapseSameGames` see that the schedule accounted for two
   * meetings and leave both alone.
   */
  alsoFrom?: string[];
  /**
   * The GameChanger rows folded into this one, each kept whole (`FoldedRow`).
   *
   * `alsoFrom` says a schedule listed this game; this says which of its rows it was and what that
   * row said. The schedule alone was not enough once a club meets another twice in a day: a game
   * that had taken one of the other club's two rows still named that club's schedule, the other row
   * read as the same one pulled again, and Next Level Prospects' two 10-2 losses to Bama Ballers on
   * 12 September 2026 became one. With the row, a re-pull finds the game its copy went into, and
   * with its start and score the tidy can put it back beside the other rows of the day and group
   * them again (`collapseSameGames`), so a fold made on one day's schedules is never final.
   */
  alsoRows?: FoldedRow[];
  /** Season label from the source, as in "Fall 2026" — display and filtering only. */
  season?: string;
  /**
   * When the game started, as the source gave it (an instant, in UTC). Only some sources know it,
   * and nothing is rated by it — it is here to tell two games of a doubleheader apart, which is
   * what makes it safe to say that one schedule's "TBD" and another schedule's named game are the
   * same fixture.
   */
  startTs?: string;
  /** Present when the game was pulled from GameChanger rather than typed in. */
  source?: ScoutGameSource;
};

/** A game only counts toward ratings/records once both scores are recorded. */
export const isScoutGamePlayed = (game: ScoutGame): boolean =>
  Number.isFinite(game.teamAScore) && Number.isFinite(game.teamBScore);

export type ScoutRankingRow = {
  /** Rank in the unfiltered table, set only when a filter has renumbered `rank`. */
  overallRank?: number;
  teamId: string;
  teamName: string;
  isMine: boolean;
  rank: number;
  /**
   * What the table ranks and shows: the opponent-adjusted expected margin vs an average team in
   * this pool, in runs, less one standard error for how little may stand behind it. See
   * `confidentRating` and `EVIDENCE_STANDARD_ERRORS`.
   */
  rating: number;
  /**
   * The fit's own estimate, undiscounted — the best guess rather than the confident one.
   *
   * Kept beside `rating` because the two answer different questions and a reader deserves both:
   * "+7.9 off four games, so it is ranked at +6.5" is the whole explanation of why a 4-0 club is
   * not first in the nation, and without this the table could only assert the conclusion.
   */
  pointRating: number;
  record: string;
  wins: number;
  losses: number;
  ties: number;
  games: number;
  rawMargin: number;
  strengthOfSchedule: number;
  sosRank: number;
  /** Home level of this team in the pool's year, when known. */
  ageLevel?: number;
  /** Counted games against a side at a different level. */
  crossAgeGames: number;
  /**
   * How many clubs are in this one's connected piece of the schedule — everything it can reach
   * through a chain of opponents.
   *
   * Not a measure of quality or of evidence. It is the size of the group this club's rating is
   * measured *within*: the ridge pins every piece to average zero on its own, so a club in a piece
   * of twelve has a rating relative to those twelve and no relation at all to one in the main
   * piece. See `scheduleComponents`.
   */
  componentSize: number;
  /**
   * An opaque token for which piece it is. Two rows sharing it have been compared; two rows that
   * do not have not, whatever either has played.
   *
   * Opaque on purpose — it is one of the club ids in the piece, and which one depends on the order
   * the games were walked. Its only meaning is equality, and nothing should store it or show it.
   */
  componentId: string;
  /**
   * Whether this club is in the largest piece — the one the table is really a ranking of.
   *
   * A club outside it is still ranked, because it played real games and hiding it would be worse,
   * but its number is not on the same scale as the rest of the column and the table says so.
   */
  comparable: boolean;
  /** True when the team is pinned to at least one GameChanger id. */
  fromGameChanger: boolean;
};

export type MatchupTier = "Favored" | "Toss-up" | "Underdog";

export type MatchupPreview = {
  opponentId: string;
  opponentName: string;
  opponentRank: number;
  /** Positive favors the team the report was built for. */
  projectedMargin: number;
  winProb: number;
  tier: MatchupTier;
  /**
   * True when the two have never been compared — no chain of common opponents joins them.
   *
   * The margin and the probability are still here, because they are the only answer the model has
   * and refusing to show one would be no more honest than showing it silently. What they are not
   * is a prediction: the two ratings are measured against two different zeros, so their difference
   * is two unrelated numbers subtracted. A reader told that can weigh it; a reader not told cannot.
   */
  unconnected: boolean;
};
