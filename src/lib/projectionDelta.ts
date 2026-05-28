import type { GameLog, Matchup, Settings, Team } from "./types";
import { isFinal } from "./util";

export type ProjectionDeltaReason =
  | "result-change"
  | "schedule-strength"
  | "tiebreak-change"
  | "settings-change"
  | "odds-change"
  | "projection-change";

export type ProjectionRelevantSettings = Partial<
  Pick<
    Settings,
    | "goldCutoff"
    | "regularSeasonGamesPerTeam"
    | "winPoints"
    | "tiePoints"
    | "runDiffTiebreaker"
    | "tiebreakerOrder"
    | "maxScoreCap"
    | "modelAggression"
  >
>;

export type ProjectionTiebreakStats = {
  runDifferential?: number;
  runsFor?: number;
  runsAgainst?: number;
};

export type ProjectionTeamSnapshot = {
  teamId: string;
  rank?: number;
  goldOdds?: number;
  projectedPoints?: number;
  standingsPoints?: number;
  tiebreakers?: ProjectionTiebreakStats;
};

export type ProjectionSnapshot = {
  teams: ProjectionTeamSnapshot[];
  settings?: ProjectionRelevantSettings;
  matchupCount?: number;
  logCount?: number;
  finalizedGameCount?: number;
  createdAt: string;
};

export type ProjectionDeltaField =
  | "team"
  | "rank"
  | "goldOdds"
  | "projectedPoints"
  | "standingsPoints"
  | "tiebreakers"
  | "settings"
  | "matchupCount"
  | "logCount"
  | "finalizedGameCount";

export type ProjectionTeamDeltaChange = {
  field: ProjectionDeltaField;
  reason: ProjectionDeltaReason;
  before?: number | string | boolean | null;
  after?: number | string | boolean | null;
  delta?: number;
};

export type ProjectionTeamDelta = {
  teamId: string;
  status: "added" | "removed" | "changed" | "unchanged";
  before?: ProjectionTeamSnapshot;
  after?: ProjectionTeamSnapshot;
  changes: ProjectionTeamDeltaChange[];
  reasons: ProjectionDeltaReason[];
};

export type ProjectionSnapshotDelta = {
  before: ProjectionSnapshot;
  after: ProjectionSnapshot;
  teams: ProjectionTeamDelta[];
  reasons: ProjectionDeltaReason[];
};

export type BuildProjectionSnapshotInput = {
  teams: Array<
    Pick<Team, "id" | "w" | "t" | "rs" | "ra" | "runDiff"> & {
      rank?: number;
      projectedRank?: number;
      goldPct?: number;
      goldOdds?: number;
    }
  >;
  settings?: ProjectionRelevantSettings;
  projectedTeams?: Array<
    Pick<Team, "id" | "w" | "t" | "rs" | "ra" | "runDiff"> & {
      rank?: number;
    }
  >;
  matchups?: Matchup[];
  logs?: Record<string, GameLog>;
  matchupCount?: number;
  logCount?: number;
  finalizedGameCount?: number;
  createdAt?: string | number | Date;
};

const toIsoTimestamp = (value: string | number | Date | undefined) => {
  if (value === undefined) return new Date().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return new Date(value).toISOString();
  return value;
};

const pointsFor = (
  team: Pick<Team, "w" | "t"> | undefined,
  settings: ProjectionRelevantSettings | undefined
) => {
  if (!team) return undefined;
  const winPoints = settings?.winPoints ?? 1;
  const tiePoints = settings?.tiePoints ?? 0.5;
  return team.w * winPoints + team.t * tiePoints;
};

const countFinalizedGames = (
  matchups: Matchup[] | undefined,
  logs: Record<string, GameLog> | undefined
) => {
  if (!matchups || !logs) return undefined;
  return matchups.filter((matchup) => isFinal(logs[matchup.id])).length;
};

const valuesDiffer = (
  before: number | string | boolean | undefined,
  after: number | string | boolean | undefined
) => before !== after;

const addReason = (reasons: ProjectionDeltaReason[], reason: ProjectionDeltaReason) => {
  if (!reasons.includes(reason)) reasons.push(reason);
};

const addNumericChange = (
  changes: ProjectionTeamDeltaChange[],
  field: ProjectionDeltaField,
  reason: ProjectionDeltaReason,
  before: number | undefined,
  after: number | undefined
) => {
  if (!valuesDiffer(before, after)) return;
  changes.push({
    field,
    reason,
    before: before ?? null,
    after: after ?? null,
    delta: before !== undefined && after !== undefined ? after - before : undefined,
  });
};

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
};

const sameObject = (before: unknown, after: unknown) =>
  stableStringify(before ?? {}) === stableStringify(after ?? {});

const changedTiebreakers = (
  before: ProjectionTiebreakStats | undefined,
  after: ProjectionTiebreakStats | undefined
) => !sameObject(before, after);

export const buildProjectionSnapshot = ({
  teams,
  settings,
  projectedTeams,
  matchups,
  logs,
  matchupCount,
  logCount,
  finalizedGameCount,
  createdAt,
}: BuildProjectionSnapshotInput): ProjectionSnapshot => {
  const projectedById = new Map(projectedTeams?.map((team) => [team.id, team]) ?? []);

  return {
    teams: teams.map((team) => {
      const projected = projectedById.get(team.id);
      return {
        teamId: team.id,
        rank: team.projectedRank ?? projected?.rank ?? team.rank,
        goldOdds: team.goldOdds ?? team.goldPct,
        projectedPoints: pointsFor(projected ?? team, settings),
        standingsPoints: pointsFor(team, settings),
        tiebreakers: {
          runDifferential: projected?.runDiff ?? team.runDiff,
          runsFor: projected?.rs ?? team.rs,
          runsAgainst: projected?.ra ?? team.ra,
        },
      };
    }),
    settings,
    matchupCount: matchupCount ?? matchups?.length,
    logCount: logCount ?? (logs ? Object.keys(logs).length : undefined),
    finalizedGameCount: finalizedGameCount ?? countFinalizedGames(matchups, logs),
    createdAt: toIsoTimestamp(createdAt),
  };
};

export const diffProjectionTeam = (
  before: ProjectionTeamSnapshot | undefined,
  after: ProjectionTeamSnapshot | undefined,
  context: {
    settingsChanged?: boolean;
    matchupCountChanged?: boolean;
    logCountChanged?: boolean;
    finalizedGameCountChanged?: boolean;
  } = {}
): ProjectionTeamDelta => {
  const teamId = after?.teamId ?? before?.teamId ?? "";

  if (!before) {
    return {
      teamId,
      status: "added",
      after,
      changes: [{ field: "team", reason: "projection-change", before: null, after: teamId }],
      reasons: ["projection-change"],
    };
  }

  if (!after) {
    return {
      teamId,
      status: "removed",
      before,
      changes: [{ field: "team", reason: "projection-change", before: teamId, after: null }],
      reasons: ["projection-change"],
    };
  }

  const changes: ProjectionTeamDeltaChange[] = [];
  const tiebreakersChanged = changedTiebreakers(before.tiebreakers, after.tiebreakers);
  const rankReason: ProjectionDeltaReason = tiebreakersChanged
    ? "tiebreak-change"
    : "projection-change";

  addNumericChange(changes, "rank", rankReason, before.rank, after.rank);
  addNumericChange(changes, "goldOdds", "odds-change", before.goldOdds, after.goldOdds);
  addNumericChange(
    changes,
    "projectedPoints",
    "projection-change",
    before.projectedPoints,
    after.projectedPoints
  );
  addNumericChange(
    changes,
    "standingsPoints",
    "result-change",
    before.standingsPoints,
    after.standingsPoints
  );

  if (tiebreakersChanged) {
    changes.push({ field: "tiebreakers", reason: "tiebreak-change" });
  }
  if (context.settingsChanged) {
    changes.push({ field: "settings", reason: "settings-change" });
  }
  if (context.matchupCountChanged) {
    changes.push({ field: "matchupCount", reason: "schedule-strength" });
  }
  if (context.logCountChanged) {
    changes.push({ field: "logCount", reason: "result-change" });
  }
  if (context.finalizedGameCountChanged) {
    changes.push({ field: "finalizedGameCount", reason: "result-change" });
  }

  const reasons: ProjectionDeltaReason[] = [];
  changes.forEach((change) => addReason(reasons, change.reason));

  return {
    teamId,
    status: changes.length ? "changed" : "unchanged",
    before,
    after,
    changes,
    reasons,
  };
};

export const diffProjectionSnapshots = (
  before: ProjectionSnapshot,
  after: ProjectionSnapshot
): ProjectionSnapshotDelta => {
  const beforeById = new Map(before.teams.map((team) => [team.teamId, team]));
  const afterById = new Map(after.teams.map((team) => [team.teamId, team]));
  const teamIds = Array.from(new Set([...beforeById.keys(), ...afterById.keys()])).sort();

  const context = {
    settingsChanged: !sameObject(before.settings, after.settings),
    matchupCountChanged: before.matchupCount !== after.matchupCount,
    logCountChanged: before.logCount !== after.logCount,
    finalizedGameCountChanged: before.finalizedGameCount !== after.finalizedGameCount,
  };

  const teams = teamIds.map((teamId) =>
    diffProjectionTeam(beforeById.get(teamId), afterById.get(teamId), context)
  );
  const reasons: ProjectionDeltaReason[] = [];
  teams.forEach((team) => team.reasons.forEach((reason) => addReason(reasons, reason)));

  return { before, after, teams, reasons };
};
