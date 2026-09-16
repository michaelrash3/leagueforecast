/**
 * Recognising a club by who coaches it.
 *
 * GameChanger never says which teams belong to the same organisation. Names do not answer it
 * either: "27/28 HD" and "HD 2029" are one club in Albuquerque, and nothing in those two strings
 * says so. The coaches do — both are run by Eric Varela and Sam Wilson.
 *
 * Measured over an export of 52,470 teams, two teams sharing two staff names are in the same state
 * 97.8% of the time and the same town 89.0%. Sharing exactly one: 56.8% and 43.1%, which is barely
 * better than picking a team at random from the same part of the country. That gap is the whole
 * design. Clubs commonly require an organisation officer on every team's staff, so one shared name
 * is very often that officer and nothing more. (A smaller export taken the same week gave 97.4 and
 * 88.9 against 58.1 and 44.9 — the same answer, which is why these thresholds are constants rather
 * than something fitted.)
 *
 * The officers are visible in the data and can be excluded outright. In that export 429 names
 * appear on ten teams or more — one on a hundred and thirty-three, one of them called "2d sports
 * gc 2026" — and a name spread that wide says nothing about any two teams carrying it.
 *
 * One thing this is not. Among pairs sharing two staff, only 22% are the same age group: shared
 * staff finds the *club*, not the team. It is why nothing here merges anything. It proposes.
 *
 * Two is the whole of the threshold, and a third name adds nothing worth a tier of its own. Three
 * shared staff is 98.4% same-state against two's 97.8%, and 90.6% same-town against 87.2% — the
 * question was already answered. What a third name does raise is the chance the pair is the same
 * *squad* rather than a sibling team, from 19.7% same-age-group to 34.9%; but once the age level
 * and the season are known to match, two and three are indistinguishable again (81.9% and 81.7% of
 * such pairs share a word of their team name). So the count separates club from stranger, and the
 * squad year separates team from sibling. `likelySameSquad` below is that second question.
 *
 * The count is still worth keeping past two, for ordering: given several clubs to choose between,
 * the one sharing more coaches is the better guess. There is no point looking past four — the
 * export lists at most four coaches a card, so five shared occurs eight times in fifty thousand
 * teams.
 */

/** A name a spreadsheet wrote, as something two spreadsheets can agree on. */
export const staffKey = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[.,'’]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * A staff name on this many teams or more is an organisation's officer rather than a team's coach,
 * and carries no information about any two of them.
 *
 * Ten, from the shape of the real data: 102,654 of 123,460 names appear on exactly one team,
 * 14,499 on two, 3,130 on three, and the count keeps falling away — so the four hundred above this
 * line are a different kind of thing rather than the tail of the same one.
 */
export const ORG_WIDE_TEAM_COUNT = 10;

/** How much two teams' staff says they are one club. */
export type ClubAffinity = "none" | "weak" | "strong";

export type StaffIndex = {
  /** Team ids carrying a staff name, by name. */
  teamsByStaff: ReadonlyMap<string, readonly string[]>;
  /** The staff of one team, by team id. */
  staffByTeam: ReadonlyMap<string, readonly string[]>;
  /** Whether a name is spread widely enough to be an officer rather than a coach. */
  isOrgWide: (key: string) => boolean;
};

export type StaffedTeam = { teamId: string; staff?: readonly string[] };

/** Builds the index both directions, over whatever the list gave. */
export const buildStaffIndex = (teams: readonly StaffedTeam[]): StaffIndex => {
  const teamsByStaff = new Map<string, string[]>();
  const staffByTeam = new Map<string, string[]>();

  teams.forEach(({ teamId, staff }) => {
    if (!staff || staff.length === 0) return;
    const keys: string[] = [];
    staff.forEach((name) => {
      const key = staffKey(name);
      if (!key || keys.includes(key)) return;
      keys.push(key);
      const carrying = teamsByStaff.get(key);
      if (carrying) carrying.push(teamId);
      else teamsByStaff.set(key, [teamId]);
    });
    if (keys.length > 0) staffByTeam.set(teamId, keys);
  });

  return {
    teamsByStaff,
    staffByTeam,
    isOrgWide: (key) => (teamsByStaff.get(key)?.length ?? 0) >= ORG_WIDE_TEAM_COUNT,
  };
};

/**
 * The staff two teams share, with the organisation's officers left out.
 *
 * Those are dropped rather than counted-and-discounted because they are not weak evidence, they
 * are no evidence: a name on eighty-seven teams is on them for a reason that has nothing to do
 * with any pair of them.
 */
export const sharedStaff = (a: string, b: string, index: StaffIndex): string[] => {
  const mine = index.staffByTeam.get(a);
  const theirs = index.staffByTeam.get(b);
  if (!mine || !theirs) return [];
  const other = new Set(theirs);
  return mine.filter((key) => other.has(key) && !index.isOrgWide(key));
};

/**
 * What two teams' shared staff amounts to.
 *
 * "strong" is two or more coaches in common, which in the real export means the same town nine
 * times in ten. "weak" is one, which is as likely to be a club officer sitting on both cards as
 * anything else — worth showing somebody, never worth acting on by itself.
 */
export const clubAffinity = (a: string, b: string, index: StaffIndex): ClubAffinity => {
  const shared = sharedStaff(a, b, index).length;
  if (shared >= 2) return "strong";
  return shared === 1 ? "weak" : "none";
};

/** Enough of a squad to ask whether two GameChanger ids are the same team rather than siblings. */
export type SquadOf = (teamId: string) => {
  ageLevel?: number;
  season?: { season: string; year: number };
};

/**
 * Whether two ids look like one squad rather than two teams of one club.
 *
 * Shared staff alone cannot tell them apart: four in five pairs that share two coaches are a club
 * running several age groups, which must never be merged into each other. What separates them is
 * the squad year — the same coaches, at the same age level, in the same season, is one team
 * somebody listed twice far more often than it is a club fielding two identical squads.
 *
 * A missing age level or season answers no, not yes. An unknown is not a match, and this feeds a
 * merge proposal, where a wrong yes costs a club its history.
 */
export const likelySameSquad = (
  a: string,
  b: string,
  index: StaffIndex,
  squadOf: SquadOf
): boolean => {
  if (clubAffinity(a, b, index) !== "strong") return false;
  const mine = squadOf(a);
  const theirs = squadOf(b);
  if (mine.ageLevel === undefined || mine.ageLevel !== theirs.ageLevel) return false;
  if (!mine.season || !theirs.season) return false;
  return mine.season.season === theirs.season.season && mine.season.year === theirs.season.year;
};

export type ClubRelation = {
  teamId: string;
  affinity: Exclude<ClubAffinity, "none">;
  /** The coaches in common, as keys — what to show when somebody asks why. */
  shared: string[];
};

/**
 * Every team that looks like the same club as this one, strongest first.
 *
 * Reached through the index rather than by comparing against every team, so a pool of twenty
 * thousand costs the size of this team's staff rather than the size of the pool.
 */
export const clubRelations = (teamId: string, index: StaffIndex): ClubRelation[] => {
  const mine = index.staffByTeam.get(teamId);
  if (!mine) return [];

  const sharedBy = new Map<string, string[]>();
  mine.forEach((key) => {
    if (index.isOrgWide(key)) return;
    index.teamsByStaff.get(key)?.forEach((other) => {
      if (other === teamId) return;
      const found = sharedBy.get(other);
      if (found) found.push(key);
      else sharedBy.set(other, [key]);
    });
  });

  return [...sharedBy.entries()]
    .map(([other, shared]) => ({
      teamId: other,
      affinity: (shared.length >= 2 ? "strong" : "weak") as Exclude<ClubAffinity, "none">,
      shared,
    }))
    .sort((a, b) => b.shared.length - a.shared.length || a.teamId.localeCompare(b.teamId));
};

/** One line saying why two teams look related, for somebody deciding whether they are. */
export const describeRelation = (
  relation: ClubRelation,
  nameOf?: (key: string) => string
): string => {
  const names = relation.shared.map((key) => nameOf?.(key) ?? key);
  if (relation.affinity === "strong") {
    return `Shares ${names.length} coaches (${names.join(", ")}) — almost always the same club.`;
  }
  return `Shares one coach (${names[0] ?? "?"}) — often just a club officer, so this is a hint rather than a match.`;
};
