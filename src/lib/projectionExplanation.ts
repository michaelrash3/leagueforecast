import type {
  ProjectionSnapshotDelta,
  ProjectionTeamDelta,
  ProjectionTeamDeltaChange,
} from "./projectionDelta";

export type ProjectionExplanationOptions = {
  /** Maximum number of explanation strings to return. Defaults to 3. */
  maxItems?: number;
  /** Minimum absolute Gold odds movement, in percentage points, worth explaining. */
  goldOddsThreshold?: number;
  /** Minimum absolute projected-rank movement worth explaining. */
  rankThreshold?: number;
  /** Minimum absolute projected-points movement worth explaining. */
  projectedPointsThreshold?: number;
  /** Minimum absolute standings-points movement worth explaining. */
  standingsPointsThreshold?: number;
};

export type ProjectionExplanationInput =
  | ProjectionTeamDelta
  | {
      delta: ProjectionSnapshotDelta;
      teamId: string;
    };

type ExplanationCandidate = {
  text: string;
  impact: number;
  order: number;
};

const DEFAULT_MAX_ITEMS = 3;
const DEFAULT_GOLD_ODDS_THRESHOLD = 3;
const DEFAULT_RANK_THRESHOLD = 1;
const DEFAULT_POINTS_THRESHOLD = 0.5;

const absoluteDelta = (change: ProjectionTeamDeltaChange) =>
  typeof change.delta === "number" ? Math.abs(change.delta) : 0;

const finiteDelta = (change: ProjectionTeamDeltaChange) =>
  typeof change.delta === "number" && Number.isFinite(change.delta) ? change.delta : undefined;

const findTeamDelta = (input: ProjectionExplanationInput): ProjectionTeamDelta | undefined => {
  if ("delta" in input) {
    return input.delta.teams.find((team) => team.teamId === input.teamId);
  }
  return input;
};

const pluralize = (amount: number, singular: string, plural = `${singular}s`) =>
  amount === 1 ? singular : plural;

const formatCount = (amount: number) => {
  if (Number.isInteger(amount)) return amount.toString();
  return amount.toFixed(1).replace(/\.0$/, "");
};

const rankText = (delta: number, reason: ProjectionTeamDeltaChange["reason"]) => {
  const spots = Math.abs(delta);
  const spotText = `${formatCount(spots)} ${pluralize(spots, "spot")}`;

  if (delta < 0) {
    return reason === "tiebreak-change"
      ? `Tiebreak movement lifted the projected finish by ${spotText}.`
      : `Recent results lifted the projected finish by ${spotText}.`;
  }

  return reason === "tiebreak-change"
    ? `Tiebreak movement pushed the projected finish down by ${spotText}.`
    : `Recent results pushed the projected finish down by ${spotText}.`;
};

const goldOddsText = (delta: number, rankMovedTowardCutoff: boolean) => {
  const points = Math.round(Math.abs(delta));
  const pointText = `${points} ${pluralize(points, "point")}`;

  if (delta > 0) {
    return rankMovedTowardCutoff
      ? `Gold odds lifted by ${pointText} as the projected finish moved up.`
      : `Gold odds lifted by ${pointText} after the projection moved up.`;
  }

  return rankMovedTowardCutoff
    ? `Gold odds dipped by ${pointText} after the projected finish moved closer to the cutoff.`
    : `Gold odds dipped by ${pointText} after the projection moved down.`;
};

const projectedPointsText = (delta: number) => {
  const points = formatCount(Math.abs(delta));
  if (delta > 0) return `Projected points nudged up by ${points}, lifting the Gold outlook.`;
  return `Projected points dipped by ${points}, softening the Gold outlook.`;
};

const standingsPointsText = (delta: number) => {
  const points = formatCount(Math.abs(delta));
  if (delta > 0) return `Standings points moved up by ${points} after recent results.`;
  return `Standings points dipped by ${points} after recent results.`;
};

const thresholdImpact = (
  change: ProjectionTeamDeltaChange,
  threshold: number,
  weight: number,
  base = 0
) => base + (threshold > 0 ? absoluteDelta(change) / threshold : absoluteDelta(change)) * weight;

const meaningfulChanges = (
  teamDelta: ProjectionTeamDelta,
  options: Required<
    Pick<
      ProjectionExplanationOptions,
      | "goldOddsThreshold"
      | "rankThreshold"
      | "projectedPointsThreshold"
      | "standingsPointsThreshold"
    >
  >
) => {
  const changes = teamDelta.changes.filter((change) => {
    const delta = finiteDelta(change);
    if (delta === undefined || delta === 0) return false;

    switch (change.field) {
      case "rank":
        return absoluteDelta(change) >= options.rankThreshold;
      case "goldOdds":
        return absoluteDelta(change) >= options.goldOddsThreshold;
      case "projectedPoints":
        return absoluteDelta(change) >= options.projectedPointsThreshold;
      case "standingsPoints":
        return absoluteDelta(change) >= options.standingsPointsThreshold;
      default:
        return false;
    }
  });

  return changes;
};

export const buildProjectionExplanations = (
  input: ProjectionExplanationInput,
  options: ProjectionExplanationOptions = {}
): string[] => {
  const teamDelta = findTeamDelta(input);
  if (!teamDelta || teamDelta.status === "unchanged") return [];

  const maxItems = Math.max(0, Math.floor(options.maxItems ?? DEFAULT_MAX_ITEMS));
  if (maxItems === 0) return [];

  const thresholds = {
    goldOddsThreshold: options.goldOddsThreshold ?? DEFAULT_GOLD_ODDS_THRESHOLD,
    rankThreshold: options.rankThreshold ?? DEFAULT_RANK_THRESHOLD,
    projectedPointsThreshold: options.projectedPointsThreshold ?? DEFAULT_POINTS_THRESHOLD,
    standingsPointsThreshold: options.standingsPointsThreshold ?? DEFAULT_POINTS_THRESHOLD,
  };
  const changes = meaningfulChanges(teamDelta, thresholds);
  if (!changes.length) return [];

  const rankChange = changes.find((change) => change.field === "rank");
  const rankDelta = rankChange ? finiteDelta(rankChange) : undefined;
  const rankMovedTowardCutoff = typeof rankDelta === "number" && rankDelta > 0;

  const candidates: ExplanationCandidate[] = [];
  changes.forEach((change, order) => {
    const delta = finiteDelta(change);
    if (delta === undefined) return;

    if (change.field === "rank") {
      candidates.push({
        text: rankText(delta, change.reason),
        impact: thresholdImpact(change, thresholds.rankThreshold, 24, 12),
        order,
      });
    }

    if (change.field === "goldOdds") {
      candidates.push({
        text: goldOddsText(delta, rankMovedTowardCutoff),
        impact: thresholdImpact(change, thresholds.goldOddsThreshold, 22, 10),
        order,
      });
    }

    if (change.field === "projectedPoints") {
      candidates.push({
        text: projectedPointsText(delta),
        impact: thresholdImpact(change, thresholds.projectedPointsThreshold, 18, 8),
        order,
      });
    }

    if (change.field === "standingsPoints") {
      candidates.push({
        text: standingsPointsText(delta),
        impact: thresholdImpact(change, thresholds.standingsPointsThreshold, 18, 7),
        order,
      });
    }
  });

  return candidates
    .sort((a, b) => b.impact - a.impact || a.order - b.order || a.text.localeCompare(b.text))
    .slice(0, maxItems)
    .map((candidate) => candidate.text);
};

export const explainProjectionDelta = buildProjectionExplanations;
