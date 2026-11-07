import { type Dispatch, type SetStateAction, useCallback, useMemo } from "react";
import { displayName } from "../lib/format";
import { ownGameSwing, rootFor } from "../lib/goldSwing";
import { type LeagueClubRank, leagueClubRankFor, scoutRoute } from "../lib/leagueClubRanks";
import { magicForGold, neededResults } from "../lib/magic";
import { needsLines, ourTeamSummary, rootForLines } from "../lib/ourTeam";
import { type AppMode, writeOurTeam } from "../lib/preferences";
import { rankingsSearch } from "../lib/rankingsRoute";
import { askToScout } from "../lib/scoutRequest";
import { EXACT_MAGIC_REMAINING_GAME_LIMIT, NEEDS_REMAINING_GAME_LIMIT } from "../lib/searchLimits";
import type { GoldSwing } from "../lib/sim";
import type { ClubLookup } from "../lib/teamRankings/leagueBridge";
import type { Matchup, Settings, TeamWithProjection } from "../lib/types";
import type { useGoldRace } from "./useGoldRace";

/**
 * The team this browser follows, which leads the Dashboard: picking it, for this season only; its
 * card, with its place, its magic number and what it cannot do without while those searches are
 * quick, its next two games and how the next one moves its Gold %, and the results to root for;
 * where its club stands on Team Rankings; and the Scout button that opens that club's report there.
 *
 * App.tsx worked these out under "Header / selection". They moved here whole and are called where
 * they were.
 */
export type OurTeamInputs = {
  activeSeasonId: string;
  activeSeasonKey: string;
  appMode: AppMode;
  dashboardById: Map<string, TeamWithProjection>;
  dashboardRows: TeamWithProjection[];
  goldCutoff: number;
  hasCutLine: boolean;
  nextTwoSwingGames: ReturnType<typeof useGoldRace>["nextTwoSwingGames"];
  ourSwing: GoldSwing | undefined;
  ourTeamId: string | null;
  remainingGames: Matchup[];
  scoutClubs: ClubLookup | null;
  searchedCount: number;
  seasonSettings: Settings;
  setAppMode: Dispatch<SetStateAction<AppMode>>;
  setOurTeamPick: Dispatch<SetStateAction<{ season: string; teamId: string | null }>>;
};

export function useOurTeam({
  activeSeasonId,
  activeSeasonKey,
  appMode,
  dashboardById,
  dashboardRows,
  goldCutoff,
  hasCutLine,
  nextTwoSwingGames,
  ourSwing,
  ourTeamId,
  remainingGames,
  scoutClubs,
  searchedCount,
  seasonSettings,
  setAppMode,
  setOurTeamPick,
}: OurTeamInputs) {
  const pickOurTeam = useCallback(
    (teamId: string | null) => {
      writeOurTeam(activeSeasonId, teamId);
      setOurTeamPick({ season: activeSeasonKey, teamId });
    },
    // App's own state setter, which never changes: named only because, handed in, the hooks lint
    // can no longer see that it is.
    [activeSeasonId, activeSeasonKey, setOurTeamPick]
  );
  /*
   * Where the followed team's club stands on Team Rankings, as its board last stood there
   * (`leagueClubRankFor`). Read again whenever the League side is shown, since the Rankings side
   * is what writes it.
   */
  const ourClubRank = useMemo(
    () =>
      ourTeamId && appMode === "league"
        ? leagueClubRankFor(activeSeasonId, ourTeamId, scoutClubs)
        : undefined,
    [activeSeasonId, ourTeamId, appMode, scoutClubs]
  );
  /*
   * League Standings' Scout button: Team Rankings' Scouting on the page a team's club was ranked
   * on, with that club's report open (`scoutRoute`, `askToScout`). The route is written in place,
   * as switching between the two halves of the app writes it (`useAppMode`), so Back does what it
   * always has.
   */
  const scoutClub = useCallback(
    (rank: LeagueClubRank) => {
      askToScout(rank.clubId);
      const search = rankingsSearch(window.location.search, scoutRoute(rank));
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${search}${window.location.hash}`
      );
      setAppMode("rankings");
    },
    [setAppMode]
  );
  const ourTeam = useMemo(() => {
    const team = ourTeamId ? dashboardById.get(ourTeamId) : undefined;
    if (!team) return null;
    const magic =
      hasCutLine && searchedCount <= EXACT_MAGIC_REMAINING_GAME_LIMIT
        ? magicForGold(team.id, dashboardRows, remainingGames, goldCutoff, seasonSettings)
            .description
        : undefined;
    /*
     * What it cannot do without, exact, late enough that the search is quick: on a full table with
     * ties worth half a win, ten games left took 245 ms at worst against 1.5 s at fifteen.
     */
    const needed =
      hasCutLine && searchedCount <= NEEDS_REMAINING_GAME_LIMIT
        ? neededResults(team.id, dashboardRows, remainingGames, goldCutoff, seasonSettings)
        : null;
    const needs = needed
      ? needsLines(team.id, needed, (id) => displayName(dashboardById.get(id)?.name ?? id))
      : undefined;
    const swings = nextTwoSwingGames(team.id);
    // The odds' own seasons, read by how each game went: worked out with the odds, at no extra draw.
    const swing = ourSwing?.teamId === team.id ? ourSwing : undefined;
    const nextGame = swings[0]?.game;
    const nextGold = swing && nextGame ? ownGameSwing(swing, nextGame) : null;
    const picks = swing ? rootFor(swing, remainingGames) : [];
    const nameOf = (id: string) => displayName(dashboardById.get(id)?.name ?? id);
    return ourTeamSummary(team, dashboardRows.length, {
      hasCutLine,
      swings,
      ...(magic ? { magic } : {}),
      ...(needs ? { needs } : {}),
      ...(nextGold ? { nextGold } : {}),
      ...(picks.length ? { rootFor: rootForLines(picks, nameOf) } : {}),
    });
  }, [
    ourTeamId,
    dashboardById,
    dashboardRows,
    hasCutLine,
    searchedCount,
    remainingGames,
    goldCutoff,
    seasonSettings,
    nextTwoSwingGames,
    ourSwing,
  ]);

  return { ourClubRank, ourTeam, pickOurTeam, scoutClub };
}
