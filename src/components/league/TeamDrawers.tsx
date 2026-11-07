import { type Dispatch, type SetStateAction, Suspense } from "react";
import type { useGoldRace } from "../../hooks/useGoldRace";
import type { useSelectedTeam } from "../../hooks/useSelectedTeam";
import type { LeagueAverageStats } from "../../lib/teamStats";
import type { GameLog, LastImpact, Matchup, Settings, TeamWithProjection } from "../../lib/types";
import { ErrorBoundary } from "../ErrorBoundary";
import { compareDrawerView, teamDrawerView } from "./leagueViews";

// The drawers, each drawn by its own chunk once loaded (`leagueViews.ts`, 2.1).
const TeamDrawer = teamDrawerView.View;
const CompareDrawer = compareDrawerView.View;

/** What `TeamDrawers` reads of App, each by the name App gives it. */
export type TeamDrawersProps = {
  closeTeamData: () => void;
  compareTeam: TeamWithProjection | null;
  dashboardRows: TeamWithProjection[];
  formatGoldPct: ReturnType<typeof useGoldRace>["formatGoldPct"];
  goldCutoff: number;
  hasCutLine: boolean;
  lastImpact: LastImpact | null;
  leagueAverageStats: LeagueAverageStats;
  leagueEditable: boolean;
  logs: Record<string, GameLog>;
  matchups: Matchup[];
  renameLeagueTeam: (teamId: string, nextName: string) => void;
  runsOnly: boolean;
  selectedTeam: TeamWithProjection | null;
  selectedTeamDetail: ReturnType<typeof useSelectedTeam>["selectedTeamDetail"];
  selectedTeamSplitSummary: ReturnType<typeof useSelectedTeam>["selectedTeamSplitSummary"];
  selectedTeamTrendSummary: ReturnType<typeof useSelectedTeam>["selectedTeamTrendSummary"];
  setCompareTeamId: Dispatch<SetStateAction<string | null>>;
  settings: Settings;
};

/**
 * The team drawer and the compare drawer, over the page while a team is open: each fetched the
 * first time it is opened, each behind a boundary of its own, so a download that fails is said
 * over the page with Close and Try again rather than reaching the root's.
 *
 * App.tsx drew these inline. They moved here whole and are drawn where they were, with what they
 * read of App handed in by the names App gives them.
 */
export function TeamDrawers({
  closeTeamData,
  compareTeam,
  dashboardRows,
  formatGoldPct,
  goldCutoff,
  hasCutLine,
  lastImpact,
  leagueAverageStats,
  leagueEditable,
  logs,
  matchups,
  renameLeagueTeam,
  runsOnly,
  selectedTeam,
  selectedTeamDetail,
  selectedTeamSplitSummary,
  selectedTeamTrendSummary,
  setCompareTeamId,
  settings,
}: TeamDrawersProps) {
  return (
    <>
      {/* Each drawer is fetched the first time it is opened (2.1, 2.7), so each has a boundary of
          its own: a download that fails is said over the page, with Close, and is asked for again
          on Try again or the next opening (though a browser may answer from the failure it keeps
          for the visit, which only Reload the page clears), rather than reaching the root's
          boundary, whose Try again would open the panel again from the address and fail again. */}
      {selectedTeam && (
        <ErrorBoundary area="The team panel" onReset={teamDrawerView.reset} onClose={closeTeamData}>
          <Suspense fallback={null}>
            <TeamDrawer
              team={selectedTeam}
              range={
                selectedTeamDetail?.range ?? {
                  best: selectedTeam.rank ?? 99,
                  worst: selectedTeam.rank ?? 99,
                  baseline: selectedTeam.rank ?? 99,
                }
              }
              bubble={selectedTeamDetail?.bubble ?? ""}
              detailsPending={!selectedTeamDetail}
              currentSosRank={selectedTeamDetail?.currentSosRank ?? null}
              sos={selectedTeamDetail?.sos ?? { label: "", rating: 0, opponents: "" }}
              swings={selectedTeamDetail?.swings ?? []}
              clinchScenarios={selectedTeamDetail?.clinchScenarios ?? []}
              titleRace={selectedTeamDetail?.titleRace ?? ""}
              goldPctLabel={selectedTeamDetail?.goldPctLabel ?? formatGoldPct(selectedTeam)}
              cutoff={goldCutoff}
              magicForGold={
                selectedTeamDetail?.magic ?? {
                  type: "magic",
                  ownWinsNeeded: 0,
                  opponentLossesNeeded: 0,
                  description: "",
                }
              }
              eliminationNumber={
                selectedTeamDetail?.elimination ?? {
                  type: "elimination",
                  ownWinsNeeded: 0,
                  opponentLossesNeeded: 0,
                  description: "",
                }
              }
              splitSummary={selectedTeamSplitSummary}
              trendSummary={selectedTeamTrendSummary}
              leagueAverageStats={leagueAverageStats}
              pitchMode={settings.pitchMode}
              trackErrors={settings.trackErrors}
              runsOnly={runsOnly}
              hasCutLine={hasCutLine}
              projectionExplanations={
                lastImpact?.projectionExplanations?.find((e) => e.teamId === selectedTeam.id)
                  ?.items ?? []
              }
              onClose={closeTeamData}
              onRename={
                leagueEditable ? (name) => renameLeagueTeam(selectedTeam.id, name) : undefined
              }
              onCompare={() => {
                const candidate = dashboardRows.find((team) => team.id !== selectedTeam.id);
                setCompareTeamId(candidate ? candidate.id : null);
              }}
            />
          </Suspense>
        </ErrorBoundary>
      )}

      {selectedTeam && compareTeam && (
        <ErrorBoundary
          area="The comparison"
          onReset={compareDrawerView.reset}
          onClose={() => setCompareTeamId(null)}
        >
          <Suspense fallback={null}>
            <CompareDrawer
              left={selectedTeam}
              right={compareTeam}
              allTeams={dashboardRows}
              matchups={matchups}
              logs={logs}
              runsOnly={runsOnly}
              onClose={() => setCompareTeamId(null)}
              onPickRight={(id) => setCompareTeamId(id)}
            />
          </Suspense>
        </ErrorBoundary>
      )}
    </>
  );
}
