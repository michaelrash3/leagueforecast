/**
 * Pool health's list of the leaders whose schedules reach least far beyond their own group: every
 * club in a state's top ten or the nation's top twenty-five on its page's year board whose
 * community of the schedule (`scheduleCommunities.ts`) has played fewer than `FEW_OUTSIDE_GAMES`
 * rated games outside itself, or that is off the largest piece altogether (`comparable` false).
 *
 * Such a club's rating starts at its group's level, and only games against teams outside the group
 * can say whether that level is right. GameChanger names an opponent on a schedule but gives it no
 * id, so the owner has to find those opponents and paste them into a pull. The list says which:
 * each club's opponents known only by name, with their games, and where it played none, its
 * group's. It is worked out from the boards' own rows and fit (`fewOutsideLeaders.ts`), by the
 * device's worker and the server alike, so the two cards show one list; this module is what the
 * card reads it with, and pulls in nothing of the fit.
 *
 * Measured on the owner's backup of 11 October 2026 (the 2027 squad year's year boards, 222,010
 * rated games): 1,160 clubs in 652 groups, 1,020 of them off the largest piece and 140 in it with 1
 * or 2 outside games, between them 1,900 distinct opponents known only by name over 2,928 games;
 * 422 clubs played none of their own, and 192 of those sit in groups where every side is pulled
 * already, with nothing left to find.
 */

/** A community with fewer rated games than this outside itself puts its leaders on the list. */
export const FEW_OUTSIDE_GAMES = 3;

/** The state board's top, as the board draws it (`RankingsSection`'s `STATE_TOP`). */
export const FEW_OUTSIDE_STATE_TOP = 10;

/** The national board's top, as the board draws it (`RankingsSection`'s `NATIONAL_TOP`). */
export const FEW_OUTSIDE_NATIONAL_TOP = 25;

/** A side known only by name, and all of its rated games in the year. */
export type FewOutsideSide = { teamId: string; name: string; rated: number };

/** A side known only by name that a listed club played: its games against the club, and all of them. */
export type FewOutsideOpponent = FewOutsideSide & { games: number };

/**
 * A listed club's group, its community of the schedule: how many sides it holds, of each kind, and
 * its rated games with exactly one side in it.
 */
export type FewOutsideGroup = {
  /** Every side in it, of the four kinds below. */
  sides: number;
  /** Pulled from GameChanger. */
  pulled: number;
  /** Clubs entered by hand: neither pulled, nor known only by name, nor a slot. */
  byHand: number;
  /** Known only from somebody else's schedule. */
  nameOnly: number;
  /** Bracket slots, a "TBD", which name nobody. */
  slots: number;
  outside: number;
  /** Its sides known only by name, the most rated games first: the teams to find for it. */
  toFind: FewOutsideSide[];
};

export type FewOutsideLeader = {
  teamId: string;
  name: string;
  /** The page whose board it leads, and that page's squad year (null for a page with none). */
  pageId: string;
  page: string;
  year: number | null;
  state?: string;
  /** Its place on its state's board of the page; null for a club with no state. */
  stateRank: number | null;
  /** Its place on the page's national board. */
  rank: number;
  record: string;
  /** Its group, by its place in the list's `groups`. */
  group: number;
  /** The sides known only by name it played, the most games against it first. */
  opponents: FewOutsideOpponent[];
};

/**
 * The leaders by state rank (a club with no state after every one with a state), then by national
 * rank, then by the order of their pages; each group once, in the order its first leader comes.
 */
export type FewOutsideList = { leaders: FewOutsideLeader[]; groups: FewOutsideGroup[] };

/**
 * The teams to find for a leader: the ones it played, or where it played none known only by name,
 * the ones its group did. Pulling them is what can join its group to the rest of the schedule.
 */
export const teamsToFind = (
  list: Pick<FewOutsideList, "groups">,
  leader: Pick<FewOutsideLeader, "group" | "opponents">
): readonly FewOutsideSide[] =>
  leader.opponents.length > 0 ? leader.opponents : (list.groups[leader.group]?.toFind ?? []);

/** Names as the copy button hands them over: one a line, each once, ready to search for. */
export const namesText = (sides: readonly Pick<FewOutsideSide, "name">[]): string =>
  [...new Set(sides.map((side) => side.name))].join("\n");
