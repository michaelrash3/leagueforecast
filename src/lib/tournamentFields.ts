/**
 * The tournament fields built on the Scouting tab, saved in this browser by age group, so a
 * weekend's field is there again on Saturday morning without being rebuilt from memory.
 */
export type SavedField = { name: string; teamIds: string[]; pools: number; advance: number };

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
        const { name, teamIds, pools, advance } = item as Record<string, unknown>;
        if (typeof name !== "string" || !Array.isArray(teamIds)) return [];
        return [
          {
            name,
            teamIds: teamIds.filter((id): id is string => typeof id === "string"),
            pools: typeof pools === "number" ? pools : 1,
            advance: typeof advance === "number" ? advance : 4,
          },
        ];
      });
    });
    return out;
  } catch {
    return {};
  }
};

export const readSavedFields = (ageGroupId: string): SavedField[] => readAll()[ageGroupId] ?? [];

/** Saves a field under its name, replacing one of the same name. */
export const saveField = (ageGroupId: string, field: SavedField): SavedField[] => {
  const all = readAll();
  const kept = (all[ageGroupId] ?? []).filter((saved) => saved.name !== field.name);
  all[ageGroupId] = [...kept, field].sort((a, b) => a.name.localeCompare(b.name));
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // A field that cannot be kept is still on screen; it is only the next visit that loses it.
  }
  return all[ageGroupId];
};

export const deleteField = (ageGroupId: string, name: string): SavedField[] => {
  const all = readAll();
  all[ageGroupId] = (all[ageGroupId] ?? []).filter((saved) => saved.name !== name);
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // As above.
  }
  return all[ageGroupId];
};
