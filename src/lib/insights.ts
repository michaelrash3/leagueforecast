import { formatGameDate } from "./date";
import { displayName, recordText } from "./format";
import type { GoldStatus, Matchup, Team } from "./types";

export type InsightTeam = Team & {
  rank: number;
  projectedRank: number;
  goldPct: number;
  goldStatus: GoldStatus;
};

export type SwingFact = {
  opponentName: string;
  teamIsAway: boolean;
  winSeed: number;
  lossSeed: number;
};

/**
 * Deterministic one-paragraph narrative for a team's path. No LLM,
 * built only from known model values so the wording is testable.
 */
export const pathSummary = (
  team: InsightTeam,
  cutoff: number,
  swings: SwingFact[],
  context: { totalTeams: number; leaderName: string }
): string => {
  const name = displayName(team.name);
  const seed = team.rank;
  const projected = team.projectedRank;
  const goldPct = Math.round(team.goldPct);

  if (team.goldStatus === "Clinched") {
    return `${name} has clinched a Gold Bracket spot at #${seed} and is now competing for seeding.`;
  }
  if (team.goldStatus === "Eliminated") {
    return `${name} is mathematically eliminated from the Gold Bracket; remaining games only affect other teams' paths.`;
  }

  const insideNow = seed <= cutoff;
  const insideProjected = projected <= cutoff;
  const swingLine = swings
    .slice(0, 2)
    .map(
      (s) =>
        `${s.teamIsAway ? "at" : "vs"} ${s.opponentName} swings between #${s.winSeed} (win) and #${s.lossSeed} (loss)`
    )
    .join(", ");

  if (insideNow && insideProjected) {
    return `${name} sits at #${seed} with the model projecting #${projected} and ${goldPct}% Gold odds — inside the cut line on both fronts. Next two matter: ${swingLine}.`;
  }
  if (insideNow && !insideProjected) {
    return `${name} currently holds #${seed} but projects to slip to #${projected} as the remaining schedule plays out (${goldPct}% Gold). ${swingLine ? "Hold the cushion in the next two: " + swingLine + "." : "Every remaining loss matters."}`;
  }
  if (!insideNow && insideProjected) {
    return `${name} sits at #${seed} now but the model projects ${name} to climb to #${projected} (${goldPct}% Gold). The path is open if the next two break right: ${swingLine}.`;
  }
  if (goldPct >= 15) {
    return `${name} is at #${seed}, projected #${projected} — outside the cut line but with ${goldPct}% odds, the team is in the chase. ${context.leaderName ? `${context.leaderName} leads the conference.` : ""} Swings to watch: ${swingLine}.`;
  }
  return `${name} (#${seed} now, projected #${projected}, ${goldPct}% Gold) needs wins and chaser losses to break their way. ${swingLine ? "Swings: " + swingLine + "." : ""}`;
};

export type RecapInput = {
  before: { id: string; rank: number; goldPct: number; goldStatus: GoldStatus }[];
  after: { id: string; rank: number; goldPct: number; goldStatus: GoldStatus; name: string }[];
  finalsSinceLast: { game: Matchup; awayScore: number; homeScore: number; awayName: string; homeName: string }[];
  cutoff: number;
};

export type RecapItem = {
  kind:
    | "clinched"
    | "eliminated"
    | "biggest-mover"
    | "biggest-faller"
    | "crossed-cut-up"
    | "crossed-cut-down"
    | "summary";
  text: string;
};

export const weeklyRecap = ({
  before,
  after,
  finalsSinceLast,
  cutoff,
}: RecapInput): RecapItem[] => {
  const items: RecapItem[] = [];
  const beforeById = new Map(before.map((b) => [b.id, b]));

  if (finalsSinceLast.length) {
    items.push({
      kind: "summary",
      text:
        finalsSinceLast.length === 1
          ? `1 game finalized: ${finalsSinceLast[0]?.awayName} ${finalsSinceLast[0]?.awayScore}, ${finalsSinceLast[0]?.homeName} ${finalsSinceLast[0]?.homeScore}.`
          : `${finalsSinceLast.length} games finalized since the last update.`,
    });
  }

  let topMover: { name: string; delta: number } | null = null;
  let topFaller: { name: string; delta: number } | null = null;

  after.forEach((team) => {
    const prev = beforeById.get(team.id);
    if (!prev) return;
    const delta = prev.rank - team.rank; // positive = moved up
    if (!topMover || delta > topMover.delta) topMover = { name: team.name, delta };
    if (!topFaller || delta < topFaller.delta) topFaller = { name: team.name, delta };

    if (prev.goldStatus !== "Clinched" && team.goldStatus === "Clinched") {
      items.push({ kind: "clinched", text: `${displayName(team.name)} clinched the Gold Bracket.` });
    }
    if (prev.goldStatus !== "Eliminated" && team.goldStatus === "Eliminated") {
      items.push({
        kind: "eliminated",
        text: `${displayName(team.name)} was eliminated from Gold Bracket contention.`,
      });
    }
    if (prev.rank <= cutoff && team.rank > cutoff) {
      items.push({
        kind: "crossed-cut-down",
        text: `${displayName(team.name)} dropped below the Gold cut line (#${prev.rank} → #${team.rank}).`,
      });
    }
    if (prev.rank > cutoff && team.rank <= cutoff) {
      items.push({
        kind: "crossed-cut-up",
        text: `${displayName(team.name)} moved above the Gold cut line (#${prev.rank} → #${team.rank}).`,
      });
    }
  });

  if (topMover && (topMover as { delta: number }).delta >= 2) {
    items.push({
      kind: "biggest-mover",
      text: `Biggest mover: ${displayName((topMover as { name: string }).name)} (+${(topMover as { delta: number }).delta} seeds).`,
    });
  }
  if (topFaller && (topFaller as { delta: number }).delta <= -2) {
    items.push({
      kind: "biggest-faller",
      text: `Biggest faller: ${displayName((topFaller as { name: string }).name)} (${(topFaller as { delta: number }).delta} seeds).`,
    });
  }

  return items;
};

export const recapToMarkdown = (
  seasonLabel: string,
  items: RecapItem[],
  generatedAt = new Date()
) => {
  const dateLabel = formatGameDate(`${generatedAt.getMonth() + 1}/${generatedAt.getDate()}`);
  const head = `# ${seasonLabel} Recap — ${dateLabel}\n`;
  if (!items.length) return `${head}\nNo standings movement since the last update.`;
  return `${head}\n${items.map((item) => `- ${item.text}`).join("\n")}`;
};

export const summarizeStandings = (
  seasonLabel: string,
  rows: { rank: number; name: string; w: number; l: number; t: number; goldPct: number }[],
  cutoff: number,
  generatedAt = new Date()
) => {
  const dateLabel = formatGameDate(`${generatedAt.getMonth() + 1}/${generatedAt.getDate()}`);
  const lines = rows.map((row) => {
    const insideMark = row.rank <= cutoff ? "★" : " ";
    return `${insideMark} #${row.rank} ${displayName(row.name)} — ${recordText(row)} (${Math.round(
      row.goldPct
    )}% Gold)`;
  });
  return `${seasonLabel} Standings — ${dateLabel}\nTop ${cutoff} make the Gold Bracket.\n\n${lines.join("\n")}`;
};
