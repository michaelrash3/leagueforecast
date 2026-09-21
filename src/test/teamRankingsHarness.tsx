import { render, type RenderResult } from "@testing-library/react";
import { vi } from "vitest";
import { TeamRankingsView } from "../components/TeamRankingsView";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../lib/teamRankings";
import {
  resetTeamRankingsStore,
  saveAgeGroups,
  saveAgeUnknown,
  saveScoutGames,
  saveScoutTeams,
  saveTidyStamp,
} from "../lib/teamRankingsStorage";
import { poolSignature } from "../lib/gameChangerImport";
import type { SeasonMeta } from "../lib/storage";
import type { AgeUnknownList } from "../lib/ageUnknown";

/**
 * Renders Team Rankings over a pool you describe, the way a browser would find it.
 *
 * Everything the view shows comes out of storage during its first render, so a test seeds storage
 * and then renders — there is no prop to hand it a pool through. jsdom has no IndexedDB, so the
 * store stays on localStorage and every load and save below is synchronous, which is what lets a
 * test assert on the table immediately after a click.
 */

export type Pool = {
  ageGroups: AgeGroup[];
  teams: ScoutTeam[];
  games: ScoutGame[];
  seasons?: SeasonMeta[];
  /** Starting URL query, as a user arriving on a link would have. */
  search?: string;
  /**
   * Leaves the tidy stamp unset, so the view finds a pool it does not recognise and tidies it
   * unasked — which is what a restored backup or a pull closed mid-tidy looks like.
   */
  untidied?: boolean;
  /** Teams nobody could age, for the review card on Setup. */
  ageless?: AgeUnknownList;
};

export type Harness = RenderResult & {
  showToast: ReturnType<typeof vi.fn>;
  requestConfirmation: ReturnType<typeof vi.fn>;
  onDataChange: ReturnType<typeof vi.fn>;
  /** Every message passed to `showToast`, in order. */
  toasts: () => string[];
};

/** An age group whose name is derived the way the picker derives it. */
export const ageGroup = (
  ageLevel: number,
  year: number,
  extra: Partial<AgeGroup> = {}
): AgeGroup => ({
  id: `ag_${ageLevel}u_${year}`,
  name: `${ageLevel}U ${year}`,
  ageLevel,
  year,
  seasonIds: [],
  ...extra,
});

export const team = (id: string, name: string, extra: Partial<ScoutTeam> = {}): ScoutTeam => ({
  id,
  name,
  ...extra,
});

/**
 * A date inside a squad year, which runs August 1 of the year before to July 31. A fixture dated
 * outside its page's window is filtered out of every rating, so this is what a game wants unless
 * the test is about that rule.
 */
export const seasonDate = (year: number): string => `${year - 1}-09-12`;

/**
 * A played game. The date defaults to nothing rather than to a day, because a date only belongs to
 * a squad year and the helper is not told which one; a game with no date is counted everywhere.
 */
export const game = (
  id: string,
  ageGroupId: string,
  teamAId: string,
  teamBId: string,
  teamAScore: number,
  teamBScore: number,
  extra: Partial<ScoutGame> = {}
): ScoutGame => ({
  id,
  ageGroupId,
  teamAId,
  teamBId,
  teamAScore,
  teamBScore,
  ...extra,
});

/**
 * Seeds storage and renders the view.
 *
 * The tidy stamp is set to the pool's own signature so the tidy pass that runs on an unrecognised
 * pool stays out of the way: it is worth its own tests, and left armed it rewrites the pool a
 * moment after every render here, which would make each assertion race it.
 */
export const renderTeamRankings = (pool: Pool): Harness => {
  resetTeamRankingsStore();
  window.localStorage.clear();
  window.history.replaceState(null, "", `/${pool.search ?? ""}`);

  saveAgeGroups(pool.ageGroups);
  saveScoutTeams(pool.teams);
  saveScoutGames(pool.games);
  if (pool.ageless) saveAgeUnknown(pool.ageless);
  if (!pool.untidied) {
    saveTidyStamp(
      poolSignature({ ageGroups: pool.ageGroups, teams: pool.teams, games: pool.games })
    );
  }

  const showToast = vi.fn();
  const requestConfirmation = vi.fn().mockResolvedValue(true);
  const onDataChange = vi.fn();

  const result = render(
    <TeamRankingsView
      seasons={pool.seasons ?? []}
      showToast={showToast}
      requestConfirmation={requestConfirmation}
      onDataChange={onDataChange}
    />
  );

  return {
    ...result,
    showToast,
    requestConfirmation,
    onDataChange,
    toasts: () => showToast.mock.calls.map((call) => String(call[0])),
  };
};
