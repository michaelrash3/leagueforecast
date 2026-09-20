import { useCallback, useEffect, useState } from "react";
import {
  createSeason,
  deleteSeason,
  duplicateSeason,
  getActiveSeasonId,
  listSeasons,
  renameSeason,
  setActiveSeason,
  type SeasonMeta,
} from "../lib/storage";
import type { ConfirmState } from "./useConfirmation";
import type { ToastTone } from "./useToast";

export type SeasonsOptions = {
  /**
   * The season's editable label, as the settings hold it. The index keeps its own name for each
   * season and the two are shown side by side — the header switcher reads the index, the settings
   * card the label — so a label typed in one place has to reach the other or they disagree.
   */
  seasonLabel: string;
  /**
   * Pulls the active season's stored data into whatever holds it, and clears what was transient.
   *
   * Passed in rather than done here because the season index is all this hook knows about: which
   * seasons exist and which one is active. What a season *is* — its teams, its schedule, its
   * scores, its settings, the selection and the undo snapshot on top of them — belongs to the
   * caller, and a hook that reached into all of it would be the component again under a new name.
   */
  loadActiveSeason: () => void;
  showToast: (message: string, options?: { tone?: ToastTone }) => void;
  requestConfirmation: (options: ConfirmState) => Promise<boolean>;
};

export type Seasons = {
  /** Every season this browser holds, in the order the index keeps them. */
  all: SeasonMeta[];
  activeId: string;
  /** Re-reads the index and the active season's data. For a restore, which replaces both. */
  reload: () => void;
  switchTo: (id: string) => void;
  create: (name: string) => void;
  duplicate: (id: string, name: string) => void;
  /** Asks first; deleting the only season is refused, with a toast saying so. */
  remove: (id: string) => Promise<void>;
};

/**
 * Which seasons exist, which one is being looked at, and the four things that can be done to that
 * list.
 *
 * The index lives in `localStorage` and is not React state, so every operation here writes it and
 * then reads it back rather than keeping a copy in step by hand: the store is the truth and a
 * second copy of it is a second thing to get wrong.
 */
export function useSeasons({
  seasonLabel,
  loadActiveSeason,
  showToast,
  requestConfirmation,
}: SeasonsOptions): Seasons {
  const [all, setAll] = useState<SeasonMeta[]>(() => listSeasons());
  const [activeId, setActiveId] = useState<string>(() => getActiveSeasonId());

  const reload = useCallback(() => {
    loadActiveSeason();
    setAll(listSeasons());
    setActiveId(getActiveSeasonId());
  }, [loadActiveSeason]);

  const switchTo = useCallback(
    (id: string) => {
      if (id === getActiveSeasonId()) return;
      if (!setActiveSeason(id)) return;
      reload();
      const name = listSeasons().find((season) => season.id === id)?.name ?? "season";
      showToast(`Switched to ${name}.`, { tone: "info" });
    },
    [reload, showToast]
  );

  const create = useCallback(
    (name: string) => {
      const meta = createSeason(name);
      setAll(listSeasons());
      showToast(`Created ${meta.name}. Switch to it when ready.`, { tone: "success" });
    },
    [showToast]
  );

  const duplicate = useCallback(
    (id: string, name: string) => {
      const meta = duplicateSeason(id, name);
      if (!meta) return;
      setAll(listSeasons());
      showToast(`Duplicated into ${meta.name}.`, { tone: "success" });
    },
    [showToast]
  );

  const remove = useCallback(
    async (id: string) => {
      const target = listSeasons().find((season) => season.id === id);
      if (!target) return;
      const confirmed = await requestConfirmation({
        title: `Delete ${target.name}?`,
        message:
          "This permanently removes that season's teams, games, scores, and settings from this browser. It cannot be undone.",
        confirmLabel: "Delete season",
      });
      if (!confirmed) return;
      const wasActive = getActiveSeasonId() === id;
      if (!deleteSeason(id)) {
        showToast("Cannot delete the only season.", { tone: "error" });
        return;
      }
      // Deleting the season being looked at moves the active one, so its data has to be re-read;
      // deleting any other only shortens the list.
      if (wasActive) reload();
      else setAll(listSeasons());
      showToast(`Deleted ${target.name}.`, { tone: "success" });
    },
    [reload, requestConfirmation, showToast]
  );

  // Keeps the index's name for the active season in step with its editable label, so the header
  // switcher and the season manager always show the name that was typed under "Season label".
  useEffect(() => {
    const label = seasonLabel.trim();
    if (!label) return;
    const current = all.find((season) => season.id === activeId);
    if (current && current.name !== label && renameSeason(activeId, label)) {
      // Reflecting localStorage back into React after writing to it. The season index is the
      // source of truth and is not React state, so re-reading it here is the sync, not a cascade.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAll(listSeasons());
    }
  }, [seasonLabel, activeId, all]);

  return { all, activeId, reload, switchTo, create, duplicate, remove };
}
