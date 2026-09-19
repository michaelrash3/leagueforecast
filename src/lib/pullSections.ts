import { ageGroupLevel, ageGroupYear, type AgeGroup, type ScoutTeam } from "./teamRankings";

/**
 * One run's worth of a pull: the pages it is authoritative for, and the ids it fetches.
 */
export type PullSection = {
  /**
   * The pages whose games this section holds and may replace.
   *
   * Empty for ids nobody has pulled before. A team with no link is on no page yet, so the section
   * that fetches it owns nothing and can only add: its games are laid over whatever year they turn
   * out to belong to, never written as a replacement for a page it was not holding.
   */
  ageGroupIds: string[];
  /** GameChanger team ids to fetch, in the order they were given. */
  teamIds: string[];
  /** What to show while it runs. */
  label: string;
};

/**
 * Splits a pull into sections, one per page, so a run never holds the whole pool.
 *
 * The fold keeps an index over every game it can match against, and that index is what runs a tab
 * out of memory: measured at forty thousand teams and two hundred thousand games it is 253 MB on
 * top of 79 MB of pool. The roster is only 25 MB of that and the games are all the rest, linearly
 * — so a section that holds one page of six holds 99 MB instead of 332 MB, with every team still
 * there to be matched against.
 *
 * A GameChanger id lives on exactly one page, because that is what a link records, so the split is
 * a grouping rather than a judgement. Sections come out in page order — by year, then by age level
 * — so a run walks the season the way somebody reading it would.
 *
 * What this costs is that a section cannot see another page's games while it folds. Two pages of
 * one year can hold the same cross-age tournament game, and matching is keyed on the year, so the
 * same fixture can arrive twice during a run. The tidy collapses those afterwards by that same
 * year key, pool-wide, and it runs at the end of every pull — so the duplicate is a state the pool
 * passes through rather than one it is left in.
 */
export const pullSections = (
  teamIds: readonly string[],
  teams: readonly ScoutTeam[],
  ageGroups: readonly AgeGroup[]
): PullSection[] => {
  const pageOfGcId = new Map<string, string>();
  teams.forEach((team) => {
    (team.gcTeams ?? []).forEach((link) => {
      // First link wins: an id that somehow appears twice is still one id to fetch, and the page
      // it was first filed under is the page holding its games.
      if (!pageOfGcId.has(link.teamId)) pageOfGcId.set(link.teamId, link.ageGroupId);
    });
  });

  const groupById = new Map(ageGroups.map((group) => [group.id, group]));
  const byPage = new Map<string, string[]>();
  const unfiled: string[] = [];

  teamIds.forEach((id) => {
    const page = pageOfGcId.get(id);
    // A link to a page that no longer exists is as good as no link: nothing owns those games.
    if (page === undefined || !groupById.has(page)) {
      unfiled.push(id);
      return;
    }
    const bucket = byPage.get(page);
    if (bucket) bucket.push(id);
    else byPage.set(page, [id]);
  });

  const sortKey = (groupId: string) => {
    const group = groupById.get(groupId);
    return [ageGroupYear(group) ?? Number.MAX_SAFE_INTEGER, ageGroupLevel(group) ?? 99] as const;
  };

  const sections: PullSection[] = [...byPage.entries()]
    .sort(([a], [b]) => {
      const [yearA, levelA] = sortKey(a);
      const [yearB, levelB] = sortKey(b);
      return yearA - yearB || levelA - levelB || a.localeCompare(b);
    })
    .map(([groupId, ids]) => ({
      ageGroupIds: [groupId],
      teamIds: ids,
      label: groupById.get(groupId)?.name ?? groupId,
    }));

  // Last, and on its own: these create pages rather than refreshing one, so nothing they write is
  // a replacement and the order they land in does not matter to anything already stored.
  if (unfiled.length > 0) {
    sections.push({ ageGroupIds: [], teamIds: unfiled, label: "Teams not pulled before" });
  }

  return sections;
};
