/**
 * The tidy's stamp: which rules a pool was last tidied by, the fingerprint that tells a pool the
 * tidy has seen from one it has not, and the lines that say what a tidy did.
 *
 * Kept apart from the tidy itself (`gameChangerImport.ts`, which re-exports all of it) because
 * Team Rankings reads a pool's stamp the moment it opens, to decide whether a tidy is due, and the
 * tidy is the largest module the page has: read from there, opening Team Rankings fetched all of
 * it, though only the Import and Setup sections and the tidy worker run it.
 */
import type { GcImportState, PoolTidy } from "./gameChangerImport";
import type { ScoutTeam } from "./teamRankings/types";

/**
 * Bumped whenever a tidy pass changes what it does to a pool.
 *
 * It rides in the signature so a pool the tidy has already seen reads as one it has not, exactly
 * once, after a release that changes a rule. Without it a pool nobody has touched keeps whatever
 * the old rules decided for ever: the stamp still matches, so the tidy never runs, so the new rule
 * never reaches anything already here.
 *
 *   2 — reading a graduating class out of a name
 *   3 — deleting the teams that are not playing baseball
 *   4 — taking a game off a club that plays nowhere near the age it was played at
 *   5 — deleting the high school squads
 *   6 — joining a game each club filed against a stand-in for the other, and reclaiming a row
 *       from a namesake when the other club's schedule holds it against a stand-in for the puller
 *   7 — keeping once a game two coaches scored differently at one start time: joining the two
 *       halves, settling a stand-in into the named row, and taking a row back from a namesake
 *   8 — filing a stand-in onto the one namesake in a bordering state when none is in the puller's
 *   9 — keeping once a game two clubs' schedules started within the hour of each other, or gave
 *       the same result at any start, with the other club's score kept beside it rather than in a
 *       note; the blitzball refusal released before it had no bump of its own, and reaches a pool
 *       already tidied with this one
 *  10 — keeping once a game each club's schedule lists that nothing on the other's accounts for,
 *       whatever the two clocks say, and taking away a game its club's schedule no longer lists
 *  11 — settling a club's own row against a stand-in into a game another club's schedule lists
 *       against it that none of its own schedules does, within the hour and scored within four runs
 *  12 — that settle read again on every tidy and put back where the schedules stop bearing it out,
 *       and made for a row filed against a pulled club whose schedules never list the game, on
 *       scores that agree
 *  13 — that settle left alone for a row the named club answers with a row of its own claimed
 *       elsewhere, held back only for a row of the club's the collapse could still join, and no
 *       longer refused a copy that holds the club's schedule on record with no row kept; a row
 *       typed two levels from a club that nothing of its own plays at taken off it; a stand-in
 *       filed twice under a class-year or rare name made one; and two halves whose results
 *       mirror within the hour joined across any border
 *  14 — across regions, a row with no result on either side neither settled nor claimed into a
 *       copy on the clock alone
 *  15 — a row standing as a game and folded into another, or folded into two, kept in one
 *  16 — a copy moved to the club whose own schedule has it at its very start, the result mirrored,
 *       against a slot, any stand-in, or a club of the puller's name, a namesake or a name that
 *       fits in one region; never onto the puller
 *  17 — a row against a slot or a stand-in whose name fits, with the very same result, claimed at
 *       any clock into a copy holding the club on record, and from the day either side into a
 *       copy that does not
 *  18 — a stand-in merged into any earlier entry of its name it shares a naming state with, not
 *       the first alone; and a row filed by name onto a pulled club regions away, which nothing of
 *       that club's own backs, taken off it
 *  19 — a copy a row of its own day could be and went into none of left to no row a day off; and
 *       a row that named its opponent by the club's picture never moved off it on a name
 *  20 — a row filed by name onto a pulled club whose own schedules have no game that day taken
 *       off it, and a name no longer filing a row onto such a club, at arrival or in the refile
 *  21 — a stand-in filed onto the one pulled club a name no other club carries can mean, in the
 *       namer's state or next door, though its own schedules have no game that day, and such a
 *       row left on it
 *  22 — deleting the pulled clubs every one of whose GameChanger names says the page is no team, a
 *       practice, a test or an old page marked do not use, an old page's games another club's own
 *       schedule lists kept on a slot; and softball, fastpitch, slowpitch and kickball read as not
 *       baseball
 *  23 — joining a game one club filed against a stand-in of the other's very name and the other
 *       against a stand-in or a slot, mirrored within the hour and the only match each way
 *  24 — a name that is only "Team", with nothing more than a number, a letter or an age, read as
 *       a page that is no team: such a pulled club deleted where the pool calls it so too, and
 *       such a stand-in's games kept on slots of their own
 *  25 — a lone capital V, one nothing joins to a word, read as varsity, the owner's ruling of 18
 *       October 2026, and "J.V." as JV, so such a club deleted as a high school squad; and the
 *       school pass reading a pulled club by the names GameChanger gives it and keeping a stand-in
 *       a row named at an age under fourteen off an age label, so it deletes no club the import
 *       files
 *  26 — a copy holding its club's own row of the game as a claim left on that club unless a
 *       namesake's own row stands against the puller itself, so two namesakes stop taking turns
 *  27 — a pulled club GameChanger gave no state given the one its club's other teams are in
 *  28 — the namesake join reading a stand-in sharing no word with the namer's name as the namer
 *       where the two clubs are neighbours and nothing else about the game says otherwise
 *  29 — a third GameChanger team's copy of a game both clubs' own schedules hold set not to count
 *  30 — such a copy read out to three hours from the game where nothing fits within the hour, the
 *       owner's choice of 21 October 2026
 *  31 — such a copy past the hour left counting where its own club's schedule has a game of its
 *       own at the hour of the game it fits
 *  32 — a scored game against a slot listed as TBD set not to count, the owner's rule of 26
 *       October 2026
 *  33 — a stand-in filed onto the one pulled club of its name at its level in the namer's state,
 *       where the two are neighbours by their own schedules, though the club's own schedules have
 *       no game that day (`inStateNamesakes`), and such a row left on it
 *  34 — failing that, onto the one pulled club of its name near the namer at its level, or spelled
 *       near it, or within two levels (`oneNamesake`), the owner's "If you can get to 25%, great"
 *       of 28 October 2026, and such a row left on it
 *  35 — the namesake join reading a stand-in of no pulled club's name as each club its name fits,
 *       where that club's own row of the game is against a slot, between neighbours: the owner's
 *       "Both teams have the game" of 28 October 2026
 *  36 — a row filed by name onto a pulled club far from its namer, or more than two levels from
 *       its own, left on it where the club's own row of that game stands beside it, the result
 *       mirrored within the hour (`ownCopyOf`), so a game two far-apart clubs both list is one game
 *       between them rather than a row passed round every pass and counted twice
 *  37 — two same-named squads folded into one club only on a game both filed against one pulled
 *       third club, read by its id: never a slot, a stand-in, another club of that name or each
 *       other, and never where the owner said they are two clubs, nor two squads one survivor takes
 *       in one pass that could not be one club themselves (`mergeSameSquadIds`)
 *  38 — the owner's "Same team as" read as standing for that namer's later rows of the name: the
 *       club it was folded into, at the row's level and squad year, no earlier than a week before
 *       its own season and never within the hour of a game of its own, at arrival and in the
 *       refile, and such a row left on it, unless the owner says Not this team
 *       (`answeredNamesakes`); a build on rules 37 would take those rows off again
 */
const TIDY_RULES_VERSION = 38;

/**
 * A cheap fingerprint of a pool: enough to tell "this is the pool the tidy last saw" from "this
 * is not", without hashing forty thousand rows. Counts and the newest GameChanger fetch cover a
 * pull, a restore and a reset; a hand edit that keeps every count the same and lands on an
 * already-tidied pool has nothing for the tidy to do anyway.
 */
/**
 * When the newest GameChanger schedule in the pool was fetched, or null for a pool nobody has
 * pulled into. What "these rankings are from data pulled nine days ago" reads.
 */
export const latestImportedAt = (teams: readonly ScoutTeam[]): string | null => {
  let latest = "";
  teams.forEach((team) => {
    team.gcTeams?.forEach((link) => {
      if (link.importedAt && link.importedAt > latest) latest = link.importedAt;
    });
  });
  return latest || null;
};

/**
 * The fingerprint from its parts, for a caller that knows how many games there are without
 * holding them: the games are stored a year at a time and counted off the store, so deciding
 * whether the tidy has seen this pool need not decode two hundred thousand of them to find out.
 */
export const poolSignatureOf = (
  counts: { ageGroups: number; teams: number; games: number },
  latestImport: string | null
): string =>
  `r${TIDY_RULES_VERSION}|${counts.ageGroups}|${counts.teams}|${counts.games}|${latestImport ?? ""}`;

/**
 * Whether a stored stamp was written by tidy rules newer than this build's. Such a pool is left
 * alone: this build's older rules would undo some of what the newer ones did, and with the cloud
 * copy carrying the pool between devices, a device on each build would take the other's pool and
 * tidy it back, every time either opened, each time re-sending the whole pool.
 */
export const stampFromNewerRules = (stamp: string | null): boolean => {
  const rules = /^r(\d+)\|/.exec(stamp ?? "");
  return rules !== null && Number(rules[1]) > TIDY_RULES_VERSION;
};

export const poolSignature = (state: GcImportState): string =>
  poolSignatureOf(
    { ageGroups: state.ageGroups.length, teams: state.teams.length, games: state.games.length },
    latestImportedAt(state.teams)
  );

/** One line per thing the tidy did; nothing for a pass that found nothing. */
export const describeTidy = (tidy: Omit<PoolTidy, "state">): string[] => {
  const plural = (count: number, one: string, many: string) =>
    `${count} ${count === 1 ? one : many}`;
  return [
    ...(tidy.pruned > 0
      ? [
          `${plural(tidy.pruned, "game", "games")} dated before the season began (August 1), left out.`,
        ]
      : []),
    ...(tidy.withdrawn > 0
      ? [
          `${plural(tidy.withdrawn, "game", "games")} its club's schedule no longer lists, taken out, and the other club's copy placed again.`,
        ]
      : []),
    ...(tidy.named > 0
      ? [
          `${plural(tidy.named, "placeholder", "placeholders")} named from the other team's schedule.`,
        ]
      : []),
    ...(tidy.joined > 0
      ? [
          `${plural(tidy.joined, "game", "games")} both clubs had filed against a stand-in for the other, now one game between them.`,
        ]
      : []),
    ...(tidy.namesakeJoined > 0
      ? [
          `${plural(tidy.namesakeJoined, "game", "games")} one club filed under the other's very name and the other against a stand-in, now one game between them, or put back apart.`,
        ]
      : []),
    ...(tidy.reclaimed > 0
      ? [
          `${plural(tidy.reclaimed, "game", "games")} moved to the club of that name whose own schedule holds it.`,
        ]
      : []),
    ...(tidy.resettled > 0
      ? [
          `${plural(tidy.resettled, "game", "games")} taken off a club that plays nowhere near that age, or nowhere near the club that filed it.`,
        ]
      : []),
    ...(tidy.refiled > 0
      ? [
          `${plural(tidy.refiled, "game", "games")} filed onto the one club of that name in the same state.`,
        ]
      : []),
    ...(tidy.merged > 0
      ? [`${plural(tidy.merged, "opponent", "opponents")} entered twice under one name, made one.`]
      : []),
    ...(tidy.claimed > 0
      ? [
          `${plural(tidy.claimed, "game", "games")} filed under a name matched to the other club's own copy, or put back where that copy no longer fits.`,
        ]
      : []),
    ...(tidy.releveled > 0
      ? [
          `${plural(tidy.releveled, "age level", "age levels")} worked out from a name that said one all along.`,
        ]
      : []),
    ...(tidy.stateFilled > 0
      ? [
          `${plural(tidy.stateFilled, "club's state", "clubs' states")} filled in from the same club's other teams.`,
        ]
      : []),
    ...(tidy.countedElsewhere > 0
      ? [
          `${plural(tidy.countedElsewhere, "copy", "copies")} of a game both clubs' own schedules already hold set not to count, or counted again once they stop holding it.`,
        ]
      : []),
    ...(tidy.tbdSlots > 0
      ? [
          `${plural(tidy.tbdSlots, "game", "games")} against a TBD slot set not to count: a game another team's schedule holds at that date and time counts in its place, and one nobody's does counts for nothing.`,
        ]
      : []),
    ...(tidy.notBaseball > 0
      ? [
          `${plural(tidy.notBaseball, "wiffle ball, blitzball or softball team", "wiffle ball, blitzball or softball teams")} deleted, and their results with them.`,
        ]
      : []),
    ...(tidy.highSchool > 0
      ? [
          `${plural(tidy.highSchool, "high school squad", "high school squads")} deleted, and their results with them.`,
        ]
      : []),
    ...(tidy.notATeam > 0
      ? [
          `${plural(tidy.notATeam, "practice, test, old or unnamed team page", "practice, test, old or unnamed team pages")} deleted, and their results with them.`,
        ]
      : []),
    ...(tidy.idle > 0
      ? [
          `${plural(tidy.idle, "opponent", "opponents")} no game names any more, taken off the list.`,
        ]
      : []),
    ...(tidy.folded > 0
      ? [
          `${plural(tidy.folded, "team", "teams")} folded into a club already here under another GameChanger id.`,
        ]
      : []),
    ...(tidy.paired > 0
      ? [
          `${plural(tidy.paired, "squad", "squads")} paired on into the next season — same name, same town, same state.`,
        ]
      : []),
    ...(tidy.collapsed > 0
      ? [`${plural(tidy.collapsed, "game", "games")} that had been written down twice, now once.`]
      : []),
    ...(tidy.regrouped > 0
      ? [
          `${plural(tidy.regrouped, "game", "games")} whose copies from the other club's schedule were matched again.`,
        ]
      : []),
  ];
};
