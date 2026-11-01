import { shownClubId, type ClubLookup } from "./teamRankings/leagueBridge";

/**
 * The tournament fields built on the Scouting tab, saved in this browser by age group, so a
 * weekend's field is there again on Saturday morning without being rebuilt from memory.
 *
 * Each club with a GameChanger id it carried on the page (`gc`, beside `teamIds` place for place,
 * "" where it had none, left out where none had one): a club's id here is the pool's own, and a
 * fold or Team Rankings started again can leave it naming another club. Read by it
 * (`readSavedFields`), a club folded into another is that club, and one whose id is another
 * club's now is shown gone, not ranked here, rather than played as that club.
 */
export type SavedField = {
  name: string;
  teamIds: string[];
  pools: number;
  advance: number;
  gc?: string[];
};

const KEY = "lf_tournament_fields_v1";

const readAll = (): Record<string, SavedField[]> => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, SavedField[]> = {};
    Object.entries(parsed).forEach(([ageGroupId, list]) => {
      if (!Array.isArray(list)) return;
      out[ageGroupId] = list.flatMap((item: unknown): SavedField[] => {
        if (!item || typeof item !== "object") return [];
        const { name, teamIds, pools, advance, gc } = item as Record<string, unknown>;
        if (typeof name !== "string" || !Array.isArray(teamIds)) return [];
        // Each id with the GameChanger id kept in its place, so a club left out takes its own.
        const kept = Array.isArray(gc) ? (gc as unknown[]) : [];
        const clubs = (teamIds as unknown[]).flatMap((id, at): [string, string][] => {
          if (typeof id !== "string") return [];
          const one = kept[at];
          return [[id, typeof one === "string" ? one : ""]];
        });
        const ids = clubs.map(([, one]) => one);
        return [
          {
            name,
            teamIds: clubs.map(([id]) => id),
            pools: typeof pools === "number" ? pools : 1,
            advance: typeof advance === "number" ? advance : 4,
            ...(ids.some(Boolean) ? { gc: ids } : {}),
          },
        ];
      });
    });
    return out;
  } catch {
    return {};
  }
};

/**
 * A field's clubs as `lookup` reads them (`shownClubId`): each under the id of the club it is now,
 * followed or shown gone, and two folded into one club once. As kept with nothing to read them by.
 */
const shownField = (field: SavedField, lookup: ClubLookup | null): SavedField => {
  if (!lookup || !field.gc) return field;
  const teamIds: string[] = [];
  const gc: string[] = [];
  field.teamIds.forEach((id, at) => {
    const kept = field.gc?.[at] ?? "";
    const shown = shownClubId({ id, ...(kept ? { gc: kept } : {}) }, lookup);
    if (teamIds.includes(shown)) return;
    teamIds.push(shown);
    gc.push(kept);
  });
  return { ...field, teamIds, gc };
};

/** A page's saved fields, each club as `lookup` reads it where one is given (`shownField`). */
export const readSavedFields = (
  ageGroupId: string,
  lookup: ClubLookup | null = null
): SavedField[] => (readAll()[ageGroupId] ?? []).map((field) => shownField(field, lookup));

/**
 * Saves a field under its name, replacing one of the same name, and hands back the page's fields
 * as `lookup` reads them, as `readSavedFields` does.
 */
export const saveField = (
  ageGroupId: string,
  field: SavedField,
  lookup: ClubLookup | null = null
): SavedField[] => {
  const all = readAll();
  const kept = (all[ageGroupId] ?? []).filter((saved) => saved.name !== field.name);
  all[ageGroupId] = [...kept, field].sort((a, b) => a.name.localeCompare(b.name));
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // A field that cannot be kept is still on screen; it is only the next visit that loses it.
  }
  return all[ageGroupId].map((one) => shownField(one, lookup));
};

export const deleteField = (
  ageGroupId: string,
  name: string,
  lookup: ClubLookup | null = null
): SavedField[] => {
  const all = readAll();
  all[ageGroupId] = (all[ageGroupId] ?? []).filter((saved) => saved.name !== name);
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // As above.
  }
  return all[ageGroupId].map((one) => shownField(one, lookup));
};
