/**
 * Which organizations each team sits under, as the user's Organizations file says, and the age
 * that gives a team GameChanger left ageless.
 *
 * GameChanger's public API has no route from a team to its leagues, and the team export's own
 * league column was empty on every row of three real exports — 309,504 rows between them. The
 * Organizations export is the other half: each organization with the ids of the teams under it.
 * An organization whose name states an age, "ENA 8U Fall 2026", says the age of every team under
 * it; `ageFromOrgName` reads it, refusing the event-sounding names and spans that measured badly,
 * and over 2,240 teams with an age of their own to check it against the reading agreed 95.1% of
 * the time. A team under two organizations whose names disagree gets nothing from either.
 *
 * Only ever the last word. The import applies this where GameChanger's own field and the team's
 * own name are both silent (`importOne`, as `listed.ageLevel`), so a team that states its age is
 * never moved by its organization's name.
 *
 * Kept whole rather than reduced to ages, so a later file can replace one organization's list
 * without forgetting the rest: an export taken part of the way through a crawl, and then the whole
 * of it, add up to what the whole crawl found.
 */

import { ageFromOrgName, type GcOrgListEntry } from "./gameChangerApi";
import type { NamedAgeAsk } from "./ageUnknown";

/** An organization as it is kept: what it is called and the teams the file put under it. */
export type MemberOrg = { orgId: string; name: string; teamIds: string[] };

export type OrgMembership = {
  orgs: MemberOrg[];
  /** When a file last changed what is kept; what a waiting team's last ask is compared with. */
  savedAt: string;
};

export const NO_MEMBERSHIP: OrgMembership = { orgs: [], savedAt: "" };

/** Whatever was stored, as a membership. Anything malformed is dropped rather than guessed at. */
export const coerceOrgMembership = (raw: unknown): OrgMembership => {
  if (!raw || typeof raw !== "object") return NO_MEMBERSHIP;
  const { orgs, savedAt } = raw as { orgs?: unknown; savedAt?: unknown };
  if (!Array.isArray(orgs)) return NO_MEMBERSHIP;
  const kept: MemberOrg[] = [];
  orgs.forEach((org) => {
    if (!org || typeof org !== "object") return;
    const { orgId, name, teamIds } = org as Record<string, unknown>;
    if (typeof orgId !== "string" || !orgId || typeof name !== "string") return;
    if (!Array.isArray(teamIds)) return;
    const ids = teamIds.filter((id): id is string => typeof id === "string" && id.length > 0);
    if (ids.length > 0) kept.push({ orgId, name, teamIds: ids });
  });
  return { orgs: kept, savedAt: typeof savedAt === "string" ? savedAt : "" };
};

/**
 * The membership with a file's organizations in it. An organization the file names replaces the
 * one kept under its id; one it does not name is kept as it was. Only organizations with a name
 * and at least one team are kept, since those are the only ones that can say anything. `savedAt`
 * moves only when something changed, so reading the same file twice does not send every waiting
 * team round again.
 */
export const mergeOrgMembership = (
  kept: OrgMembership,
  incoming: readonly GcOrgListEntry[],
  now: string
): OrgMembership => {
  const byId = new Map(kept.orgs.map((org) => [org.orgId, org]));
  let changed = false;
  incoming.forEach((entry) => {
    if (!entry.name || !entry.teamIds?.length) return;
    const next: MemberOrg = { orgId: entry.orgId, name: entry.name, teamIds: entry.teamIds };
    const before = byId.get(entry.orgId);
    if (
      before &&
      before.name === next.name &&
      before.teamIds.length === next.teamIds.length &&
      before.teamIds.every((id, at) => id === next.teamIds[at])
    ) {
      return;
    }
    byId.set(entry.orgId, next);
    changed = true;
  });
  return changed ? { orgs: [...byId.values()], savedAt: now } : kept;
};

/**
 * The age each team's organizations give it: the one level every organization naming an age
 * agrees on. A team under organizations that name two different ages is left out, because a
 * league and a tournament are one word apart in a crawl that types every organization "travel",
 * and a disagreement is the sign of exactly that.
 */
export const orgAgesByTeam = (membership: OrgMembership): Map<string, number> => {
  const levels = new Map<string, Set<number>>();
  membership.orgs.forEach((org) => {
    const level = ageFromOrgName(org.name);
    if (level === undefined) return;
    org.teamIds.forEach((teamId) => {
      const seen = levels.get(teamId);
      if (seen) seen.add(level);
      else levels.set(teamId, new Set([level]));
    });
  });
  const ages = new Map<string, number>();
  levels.forEach((seen, teamId) => {
    if (seen.size === 1) ages.set(teamId, [...seen][0]!);
  });
  return ages;
};

/**
 * The waiting list's asking rules, told about the teams an Organizations file can now age.
 *
 * Such a team is exactly what a hand-named age is to the rota: something the last ask could not
 * have known. So it is asked once more straight away — `ageUnknownDue` puts an answer given since
 * the last ask ahead of everything, and here the answer is dated by the file — and it is asked
 * again even after the rota had given up on it. A name typed by hand stays first: its own date is
 * the one used.
 */
export const withOrgAges = (
  named: NamedAgeAsk,
  ages: ReadonlyMap<string, number>,
  savedAt: string
): NamedAgeAsk => ({
  has: (teamId) => named.has(teamId) || ages.has(teamId),
  get: (teamId) => named.get(teamId) ?? (ages.has(teamId) ? { namedAt: savedAt } : undefined),
});
