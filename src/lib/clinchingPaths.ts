import { displayName } from "./format";
import { eliminationNumberForGold, magicForGold } from "./magic";
import { standingsPoints } from "./sim";
import type { Matchup, Settings, SwingGame, TeamWithProjection } from "./types";

export type ClinchingPathNote = {
  teamId: string;
  teamName: string;
  seed: number;
  projectedSeed: number;
  goldPct: number;
  status: TeamWithProjection["goldStatus"];
  priority: number;
  notes: string[];
};

export type ClinchingPathInput = {
  team: TeamWithProjection;
  teams: TeamWithProjection[];
  remaining: Matchup[];
  cutoff: number;
  settings: Settings;
  swings: SwingGame[];
  exactLimit?: number;
};

const plural = (count: number, singular: string, pluralText = `${singular}s`) =>
  `${count} ${count === 1 ? singular : pluralText}`;

const remainingGamesFor = (teamId: string, remaining: Matchup[]) =>
  remaining.filter((game) => game.away === teamId || game.home === teamId);

const opponentFor = (teamId: string, game: Matchup, teamsById: Map<string, TeamWithProjection>) => {
  const opponentId = game.away === teamId ? game.home : game.away;
  return displayName(teamsById.get(opponentId)?.name ?? opponentId);
};

const firstCutLineHelp = (
  team: TeamWithProjection,
  teams: TeamWithProjection[],
  remaining: Matchup[],
  cutoff: number
) => {
  const teamsById = new Map(teams.map((item) => [item.id, item]));
  const rivals = teams
    .filter((other) => other.id !== team.id)
    .filter((other) => (other.rank ?? 99) <= cutoff)
    .filter((other) => Math.abs((other.rank ?? 99) - cutoff) <= 3)
    .sort((a, b) => (b.rank ?? 99) - (a.rank ?? 99));

  for (const rival of rivals) {
    const game = remaining.find(
      (item) =>
        (item.away === rival.id || item.home === rival.id) &&
        item.away !== team.id &&
        item.home !== team.id
    );
    if (!game) continue;
    const opponentName = opponentFor(rival.id, game, teamsById);
    return `${displayName(team.name)} get help if ${displayName(rival.name)} lose to ${opponentName}.`;
  }
  return "Needs help from teams above the line.";
};

export const clinchingPathForTeam = ({
  team,
  teams,
  remaining,
  cutoff,
  settings,
  swings,
  exactLimit = 14,
}: ClinchingPathInput): ClinchingPathNote => {
  const teamName = displayName(team.name);
  const seed = team.rank ?? 99;
  const projectedSeed = team.projectedRank ?? 99;
  const goldPct = Math.round(team.goldPct);
  const teamRemaining = remainingGamesFor(team.id, remaining);
  const teamsById = new Map(teams.map((item) => [item.id, item]));
  const insideNow = seed <= cutoff;
  const insideProjected = projectedSeed <= cutoff;
  const bubbleDistance = Math.min(Math.abs(seed - cutoff), Math.abs(projectedSeed - cutoff));
  const notes: string[] = [];

  if (team.goldStatus === "Clinched") {
    notes.push("Gold spot clinched; remaining games are for seeding and tiebreak cushion.");
  } else if (team.goldStatus === "Eliminated") {
    notes.push("Eliminated from Gold Bracket contention; can only play spoiler.");
  } else if (remaining.length <= exactLimit) {
    const magic = magicForGold(team.id, teams, remaining, cutoff, settings);
    const elimination = eliminationNumberForGold(team.id, teams, remaining, cutoff, settings);

    if (magic.type === "clinched") {
      notes.push("Gold spot clinched; remaining games are for seeding and tiebreak cushion.");
    } else if (magic.type === "magic" && magic.ownWinsNeeded > 0) {
      if (magic.ownWinsNeeded >= teamRemaining.length) {
        notes.push("Controls a Gold spot by winning out.");
      } else {
        notes.push(`Clinches with ${plural(magic.ownWinsNeeded, "win")}.`);
      }
    } else if (insideNow && insideProjected) {
      notes.push("Controls the Gold spot if the current pace holds.");
    } else if (!insideNow) {
      notes.push(firstCutLineHelp(team, teams, remaining, cutoff));
    }

    if (elimination.type === "elimination" && elimination.opponentLossesNeeded > 0) {
      const nextOwnGame = teamRemaining[0];
      if (elimination.opponentLossesNeeded === 1 && nextOwnGame) {
        const opponentName = opponentFor(team.id, nextOwnGame, teamsById);
        notes.push(`Eliminated if ${opponentName} beat them next.`);
      } else {
        notes.push(
          `Eliminated with ${plural(elimination.opponentLossesNeeded, "loss", "losses")}.`
        );
      }
    }
  } else if (insideNow && insideProjected) {
    notes.push("Controls a Gold spot by protecting the current cut-line cushion.");
  } else if (!insideNow && insideProjected) {
    notes.push(
      "Projected path reaches Gold, but the team still needs the swing games to break their way."
    );
  } else if (!insideNow) {
    notes.push(firstCutLineHelp(team, teams, remaining, cutoff));
  } else {
    notes.push("Currently above the line, but the projected path is fragile.");
  }

  swings.slice(0, 2).forEach((swing) => {
    if (swing.winSeed <= cutoff && swing.lossSeed > cutoff) {
      notes.push(
        `${swing.teamIsAway ? "At" : "Vs"} ${swing.opponentName}: win projects inside Gold (#${swing.winSeed}); loss falls outside (#${swing.lossSeed}).`
      );
    } else if (swing.winSeed <= cutoff && swing.lossSeed <= cutoff && bubbleDistance <= 2) {
      notes.push(
        `${swing.teamIsAway ? "At" : "Vs"} ${swing.opponentName}: win protects the path (#${swing.winSeed}); loss still projects #${swing.lossSeed}.`
      );
    } else if (swing.winSeed > cutoff && !insideNow && bubbleDistance <= 3) {
      notes.push(
        `${swing.teamIsAway ? "At" : "Vs"} ${swing.opponentName}: win projects #${swing.winSeed}; extra help is still needed.`
      );
    }
  });

  if (notes.length === 0) {
    notes.push(
      teamRemaining.length === 0
        ? "No games left; Gold fate depends on other finalized results."
        : "Needs wins plus help from teams above the line."
    );
  }

  const uniqueNotes = [...new Set(notes)].slice(0, 3);
  const statusWeight = team.goldStatus === "Alive" || team.goldStatus === "In" ? 30 : 0;
  const cutLineWeight = Math.max(0, 16 - bubbleDistance * 4);
  const projectionWeight = insideNow !== insideProjected ? 15 : 0;
  const oddsWeight = Math.min(
    15,
    Math.abs(50 - goldPct) <= 35 ? 15 - Math.abs(50 - goldPct) / 4 : 0
  );

  return {
    teamId: team.id,
    teamName,
    seed,
    projectedSeed,
    goldPct,
    status: team.goldStatus,
    priority: statusWeight + cutLineWeight + projectionWeight + oddsWeight,
    notes: uniqueNotes,
  };
};

export const clinchingPathsForTeams = (
  teams: TeamWithProjection[],
  remaining: Matchup[],
  cutoff: number,
  settings: Settings,
  swingsForTeam: (teamId: string) => SwingGame[],
  options: { limit?: number; exactLimit?: number } = {}
): ClinchingPathNote[] => {
  const limit = options.limit ?? 8;
  const ordered = [...teams].sort((a, b) => {
    const aBubble = Math.min(Math.abs((a.rank ?? 99) - cutoff), Math.abs(a.projectedRank - cutoff));
    const bBubble = Math.min(Math.abs((b.rank ?? 99) - cutoff), Math.abs(b.projectedRank - cutoff));
    return aBubble - bBubble || Math.abs(50 - a.goldPct) - Math.abs(50 - b.goldPct);
  });

  return ordered
    .map((team) =>
      clinchingPathForTeam({
        team,
        teams,
        remaining,
        cutoff,
        settings,
        swings: swingsForTeam(team.id),
        exactLimit: options.exactLimit,
      })
    )
    .sort((a, b) => b.priority - a.priority || a.seed - b.seed)
    .slice(0, limit);
};

export const goldCutLineSnapshot = (
  teams: TeamWithProjection[],
  cutoff: number,
  settings: Settings
) => {
  const lastIn = teams.find((team) => (team.rank ?? 99) === cutoff);
  const firstOut = teams.find((team) => (team.rank ?? 99) === cutoff + 1);
  return {
    lastInName: lastIn ? displayName(lastIn.name) : "—",
    firstOutName: firstOut ? displayName(firstOut.name) : "—",
    pointsGap:
      lastIn && firstOut
        ? standingsPoints(lastIn, settings) - standingsPoints(firstOut, settings)
        : null,
  };
};
