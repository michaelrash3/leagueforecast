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
    return `${name} have clinched a Gold Bracket spot at #${seed} and are now playing for seeding.`;
  }
  if (team.goldStatus === "Eliminated") {
    return `${name} are mathematically eliminated from the Gold Bracket; their remaining games only affect other teams' paths.`;
  }

  const insideNow = seed <= cutoff;
  const insideProjected = projected <= cutoff;
  const swingLine = swings
    .slice(0, 2)
    .map((s) => `${s.teamIsAway ? "at" : "vs"} ${s.opponentName} (win → #${s.winSeed}, loss → #${s.lossSeed})`)
    .join(" and ");

  if (insideNow && insideProjected) {
    return `${name} sit at #${seed} with the model projecting #${projected} and ${goldPct}% Gold odds — inside the cut line on both fronts. The next two matter: ${swingLine}.`;
  }
  if (insideNow && !insideProjected) {
    return `${name} currently hold #${seed} but project to slip to #${projected} as the remaining schedule plays out (${goldPct}% Gold). ${swingLine ? "They need to protect the cushion in their next two: " + swingLine + "." : "Every remaining loss matters."}`;
  }
  if (!insideNow && insideProjected) {
    return `${name} sit at #${seed} now but project to climb to #${projected} (${goldPct}% Gold). The path is open if the next two break right: ${swingLine}.`;
  }
  if (goldPct >= 15) {
    return `${name} are at #${seed} and project to #${projected} — outside the cut line but at ${goldPct}% odds, still in the chase.${context.leaderName ? ` ${context.leaderName} lead the conference.` : ""}${swingLine ? ` Swings to watch: ${swingLine}.` : ""}`;
  }
  return `${name} (now #${seed}, projected #${projected}, ${goldPct}% Gold) need wins and chaser losses to break their way.${swingLine ? ` Swings: ${swingLine}.` : ""}`;
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
    | "rank-change"
    | "gold-shift"
    | "summary";
  text: string;
  impactScore?: number;
  why?: string[];
};

const recapImpactScore = (kind: RecapItem["kind"], text: string) => {
  switch (kind) {
    case "clinched":
    case "eliminated":
      return 95;
    case "crossed-cut-up":
    case "crossed-cut-down":
      return 85;
    case "biggest-mover":
    case "biggest-faller":
      return 72;
    case "rank-change":
      return text.includes("#") ? 58 : 45;
    case "gold-shift":
      return 55;
    case "summary":
    default:
      return 40;
  }
};

export const weeklyRecap = ({
  before,
  after,
  finalsSinceLast,
  cutoff,
}: RecapInput): RecapItem[] => {
  const items: RecapItem[] = [];
  const beforeById = new Map(before.map((b) => [b.id, b]));
  const afterById = new Map(after.map((a) => [a.id, a]));
  type ChangeAttribution = {
    ownResult?: { opponentName: string; didWin: boolean; pointsGained: number };
    competitorResults: { teamName: string; didLose: boolean; rank: number }[];
    tieBreakWith?: { teamName: string; fromRank: number; toRank: number };
  };
  const attributionById = new Map<string, ChangeAttribution>();
  const getAttribution = (id: string) => {
    const existing = attributionById.get(id);
    if (existing) return existing;
    const next: ChangeAttribution = { competitorResults: [] };
    attributionById.set(id, next);
    return next;
  };

  finalsSinceLast.forEach((f) => {
    const awayPoints = f.awayScore > f.homeScore ? 1 : 0;
    const homePoints = f.homeScore > f.awayScore ? 1 : 0;
    const winnerId = awayPoints > homePoints ? f.game.away : homePoints > awayPoints ? f.game.home : "";
    const loserId = awayPoints > homePoints ? f.game.home : homePoints > awayPoints ? f.game.away : "";

    if (winnerId) {
      const winnerAttr = getAttribution(winnerId);
      winnerAttr.ownResult = {
        opponentName: winnerId === f.game.away ? f.homeName : f.awayName,
        didWin: true,
        pointsGained: 1,
      };
      winnerAttr.competitorResults.push({
        teamName: winnerId === f.game.away ? f.homeName : f.awayName,
        didLose: true,
        rank: afterById.get(loserId)?.rank ?? -1,
      });
    }
    if (loserId) {
      const loserAttr = getAttribution(loserId);
      loserAttr.ownResult = {
        opponentName: loserId === f.game.away ? f.homeName : f.awayName,
        didWin: false,
        pointsGained: 0,
      };
      loserAttr.competitorResults.push({
        teamName: loserId === f.game.away ? f.homeName : f.awayName,
        didLose: false,
        rank: afterById.get(winnerId)?.rank ?? -1,
      });
    }
  });

  if (finalsSinceLast.length) {
    items.push({
      kind: "summary",
      text:
        finalsSinceLast.length === 1
          ? `1 game finalized: ${finalsSinceLast[0]?.awayName} ${finalsSinceLast[0]?.awayScore}, ${finalsSinceLast[0]?.homeName} ${finalsSinceLast[0]?.homeScore}.`
          : `${finalsSinceLast.length} games finalized: ${finalsSinceLast
              .map((f) => `${f.awayName} ${f.awayScore}–${f.homeName} ${f.homeScore}`)
              .join("; ")}.`,
    });

    const movedNames = new Set<string>();
    after.forEach((team) => {
      const prev = beforeById.get(team.id);
      if (!prev || prev.rank === team.rank) return;
      movedNames.add(displayName(team.name));
    });
    if (movedNames.size > 0) {
      const movedList = Array.from(movedNames).slice(0, 6).join(", ");
      items.push({
        kind: "summary",
        text: `Ripple effect: ${movedList} shifted after this finalized window.`,
        why: [
          "Finalized results changed standings order for multiple teams.",
          "Cut-line pressure and tie-break cascades can move teams not playing head-to-head.",
        ],
      });
    }
  }

  // Pass 1: clinch / elimination / cut-line crossings (highest signal first).
  after.forEach((team) => {
    const prev = beforeById.get(team.id);
    if (!prev) return;
    if (prev.goldStatus !== "Clinched" && team.goldStatus === "Clinched") {
      items.push({
        kind: "clinched",
        text: `${displayName(team.name)} clinched the Gold Bracket.`,
        why: ["Team status changed to Clinched.", "Remaining results now affect only seeding."],
      });
    }
    if (prev.goldStatus !== "Eliminated" && team.goldStatus === "Eliminated") {
      items.push({
        kind: "eliminated",
        text: `${displayName(team.name)} were eliminated from Gold Bracket contention.`,
        why: ["Team status changed to Eliminated.", "Gold path is no longer mathematically available."],
      });
    }
    if (prev.rank <= cutoff && team.rank > cutoff) {
      items.push({
        kind: "crossed-cut-down",
        text: `${displayName(team.name)} dropped below the Gold cut line (#${prev.rank} → #${team.rank}).`,
        why: ["Seed moved from inside to outside the cutoff.", "Cut-line movement can swing weekly priorities."],
      });
    }
    if (prev.rank > cutoff && team.rank <= cutoff) {
      items.push({
        kind: "crossed-cut-up",
        text: `${displayName(team.name)} moved above the Gold cut line (#${prev.rank} → #${team.rank}).`,
        why: ["Seed moved from outside to inside the cutoff.", "Team now controls its path more directly."],
      });
    }
  });

  // Pass 2: any rank change (excluded if already covered by a cut-line crossing).
  const rankChanges: { name: string; from: number; to: number; delta: number }[] = [];
  after.forEach((team) => {
    const prev = beforeById.get(team.id);
    if (!prev) return;
    const delta = prev.rank - team.rank;
    if (delta === 0) return;
    rankChanges.push({ name: team.name, from: prev.rank, to: team.rank, delta });
    const tiedSwap = after.find((other) => {
      if (other.id === team.id) return false;
      const otherPrev = beforeById.get(other.id);
      if (!otherPrev) return false;
      const crossed =
        (prev.rank < otherPrev.rank && team.rank > other.rank) ||
        (prev.rank > otherPrev.rank && team.rank < other.rank);
      return crossed && Math.round(other.goldPct) === Math.round(team.goldPct);
    });
    if (tiedSwap) {
      getAttribution(team.id).tieBreakWith = {
        teamName: displayName(tiedSwap.name),
        fromRank: prev.rank,
        toRank: team.rank,
      };
    }
  });
  rankChanges
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 4)
    .forEach((c) => {
      const verb = c.delta > 0 ? "climbed" : "slipped";
      const team = after.find((a) => a.name === c.name);
      const attr = team ? attributionById.get(team.id) : undefined;
      const why: string[] = [];
      if (attr?.ownResult) {
        const ownVerb = attr.ownResult.didWin ? "won" : "lost";
        why.push(`${displayName(c.name)} ${ownVerb} vs ${attr.ownResult.opponentName}, gained ${attr.ownResult.pointsGained} standings point${attr.ownResult.pointsGained === 1 ? "" : "s"}.`);
      }
      const competitor = attr?.competitorResults.find((x) => x.rank > 0 && x.teamName !== displayName(c.name));
      if (competitor) {
        const compVerb = competitor.didLose ? "loss dropped" : "win pushed";
        why.push(`${competitor.teamName} ${compVerb} them to #${competitor.rank}.`);
      }
      if (attr?.tieBreakWith) {
        why.push(`Tied on points with ${attr.tieBreakWith.teamName}; tie-break moved ${displayName(c.name)} from #${attr.tieBreakWith.fromRank} to #${attr.tieBreakWith.toRank}.`);
      }
      if (why.length === 0) {
        why.push(`Position changed by ${Math.abs(c.delta)} seed(s).`, "Shift came from finalized results in this update window.");
      }
      items.push({
        kind: "rank-change",
        text: `${displayName(c.name)} ${verb} from #${c.from} to #${c.to}.`,
        why,
      });
    });

  // Pass 3: gold-odds shifts ≥ 5%.
  const goldShifts: { name: string; delta: number; pct: number }[] = [];
  after.forEach((team) => {
    const prev = beforeById.get(team.id);
    if (!prev) return;
    const delta = Math.round(team.goldPct - prev.goldPct);
    if (Math.abs(delta) >= 5) {
      goldShifts.push({ name: team.name, delta, pct: Math.round(team.goldPct) });
    }
  });
  goldShifts
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 4)
    .forEach((s) => {
      const direction = s.delta > 0 ? "climbed" : "dropped";
      items.push({
        kind: "gold-shift",
        text: `${displayName(s.name)} Gold odds ${direction} ${s.delta > 0 ? "+" : ""}${s.delta}% (now ${s.pct}%).`,
        why: ["Simulation odds moved by at least 5 percentage points.", "This reflects both own result and competitor outcomes."],
      });
    });

  // Pass 4: explicit biggest-mover / faller summary lines (so the impact bar
  // always has at least one "headline" item when ranks shuffled).
  let topMover: { name: string; delta: number } | null = null;
  let topFaller: { name: string; delta: number } | null = null;
  rankChanges.forEach((c) => {
    if (!topMover || c.delta > topMover.delta) topMover = { name: c.name, delta: c.delta };
    if (!topFaller || c.delta < topFaller.delta) topFaller = { name: c.name, delta: c.delta };
  });
  if (topMover && (topMover as { delta: number }).delta >= 3) {
      items.push({
        kind: "biggest-mover",
        text: `Biggest mover: ${displayName((topMover as { name: string }).name)} (+${(topMover as { delta: number }).delta} seeds).`,
        why: ["Largest positive seed movement in this update window."],
      });
  }
  if (topFaller && (topFaller as { delta: number }).delta <= -3) {
      items.push({
        kind: "biggest-faller",
        text: `Biggest faller: ${displayName((topFaller as { name: string }).name)} (${(topFaller as { delta: number }).delta} seeds).`,
        why: ["Largest negative seed movement in this update window."],
      });
  }

  // Dedupe by text and cap.
  return Array.from(new Map(items.map((item) => [item.text, item])).values())
    .map((item) => ({ ...item, impactScore: recapImpactScore(item.kind, item.text) }))
    .sort((a, b) => (b.impactScore ?? 0) - (a.impactScore ?? 0))
    .slice(0, 12);
};

export const recapToStoryBrief = (
  seasonLabel: string,
  items: RecapItem[],
  generatedAt = new Date()
) => {
  const dateLabel = formatGameDate(`${generatedAt.getMonth() + 1}/${generatedAt.getDate()}`);
  const top = [...items].sort((a, b) => (b.impactScore ?? 0) - (a.impactScore ?? 0)).slice(0, 3);
  return [
    `${seasonLabel} League Story — ${dateLabel}`,
    ...top.map((item, i) => `${i + 1}) ${item.text}`),
  ].join("\n");
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
