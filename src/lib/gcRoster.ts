/**
 * Which GameChanger pages are actually teams.
 *
 * It takes nine to field a side. A page with fewer players on it is not a team yet — it is a page
 * somebody made and did not finish, a squad still being assembled, or a tryout roster that will
 * never play. In an export of 52,470 teams, 1,434 of them — one in thirty-six — have between two
 * and eight players, and none at all have fewer than two.
 *
 * None of them are thrown away. A squad being assembled in September is a real team by October,
 * and the roster count is the thing that says which. They are marked instead, kept out of the way
 * of the pull, and looked at again later: if the roster grew past nine, it was a team all along.
 */

/** Players needed to field a side, and so the line between a team and a page. */
export const MIN_REAL_ROSTER = 9;

/** How long to leave an under-strength team alone before looking at it again. */
export const RECHECK_AFTER_DAYS = 14;

const DAY_MS = 86_400_000;

export type RosterStanding =
  /** Nine or more: a team. */
  | "full"
  /** Two to eight: not a team yet, and worth looking at again. */
  | "short"
  /** Nobody said, which is not the same as nobody being on it. */
  | "unknown";

export const rosterStanding = (playerCount: number | undefined): RosterStanding => {
  if (playerCount === undefined || !Number.isFinite(playerCount)) return "unknown";
  return playerCount >= MIN_REAL_ROSTER ? "full" : "short";
};

/** What a roster count is worth saying about a team, or nothing when there is nothing to say. */
export const describeRoster = (playerCount: number | undefined): string | null => {
  const standing = rosterStanding(playerCount);
  if (standing !== "short") return null;
  return `${playerCount} player${playerCount === 1 ? "" : "s"} — it takes ${MIN_REAL_ROSTER} to field a side, so this may not be a team yet.`;
};

/** A team as the roster watch sees it: how many players, and when that was last true. */
export type WatchedTeam = {
  teamId: string;
  playerCount?: number;
  /** ISO timestamp of the list or pull the count came from. */
  countedAt?: string;
};

export type RosterWatchEntry = {
  teamId: string;
  playerCount: number;
  countedAt?: string;
  /** Whether enough time has passed to be worth asking GameChanger again. */
  due: boolean;
};

/**
 * The under-strength teams, and which of them are worth asking about again.
 *
 * A team counted today is not asked about again today — the count came from the same export the
 * question is about. One never counted is due immediately, since there is nothing to go on.
 */
export const rosterWatchList = (
  teams: readonly WatchedTeam[],
  now: number = Date.now(),
  afterDays: number = RECHECK_AFTER_DAYS
): RosterWatchEntry[] =>
  teams
    .flatMap((team) => {
      if (rosterStanding(team.playerCount) !== "short") return [];
      const at = team.countedAt ? Date.parse(team.countedAt) : Number.NaN;
      const due = !Number.isFinite(at) || now - at >= afterDays * DAY_MS;
      return [
        {
          teamId: team.teamId,
          playerCount: team.playerCount as number,
          ...(team.countedAt ? { countedAt: team.countedAt } : {}),
          due,
        },
      ];
    })
    // Due first, then the emptiest — the two-player pages are the least likely to become teams.
    .sort(
      (a, b) =>
        Number(b.due) - Number(a.due) ||
        a.playerCount - b.playerCount ||
        a.teamId.localeCompare(b.teamId)
    );

export type RosterChange = {
  teamId: string;
  was: number;
  now: number;
  /** It crossed the line: a page that was not a team is one now. */
  becameReal: boolean;
};

/**
 * What a later count says about the teams being watched.
 *
 * The point of the watch: a squad of six in September that is twelve in October was a real team
 * being assembled, and the roster count is the only thing that ever said so. A count that went
 * down is reported too — a page being emptied is its own answer.
 */
export const rosterChanges = (
  before: readonly WatchedTeam[],
  after: readonly WatchedTeam[]
): RosterChange[] => {
  const then = new Map(before.map((team) => [team.teamId, team.playerCount]));
  return after.flatMap((team) => {
    const was = then.get(team.teamId);
    const now = team.playerCount;
    if (was === undefined || now === undefined || was === now) return [];
    return [
      {
        teamId: team.teamId,
        was,
        now,
        becameReal: was < MIN_REAL_ROSTER && now >= MIN_REAL_ROSTER,
      },
    ];
  });
};
