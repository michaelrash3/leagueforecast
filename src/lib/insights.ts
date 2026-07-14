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
    return `${name} have clinched a Gold Bracket spot at #${seed}; now it's all about locking up the best possible seed.`;
  }
  if (team.goldStatus === "Eliminated") {
    return `${name} are mathematically eliminated from the Gold race, but they still get to play spoiler and reshape everyone else's path.`;
  }

  const insideNow = seed <= cutoff;
  const insideProjected = projected <= cutoff;
  const swingLine = swings
    .slice(0, 2)
    .map(
      (s) =>
        `${s.teamIsAway ? "at" : "vs"} ${s.opponentName} (win → #${s.winSeed}, loss → #${s.lossSeed})`
    )
    .join(" and ");

  if (insideNow && insideProjected) {
    return `${name} are holding firm at #${seed} with a projection of #${projected} and ${goldPct}% Gold odds — safely above the line for now. Next two pressure points: ${swingLine}.`;
  }
  if (insideNow && !insideProjected) {
    return `${name} currently own #${seed}, but the model sees a slide to #${projected} as the stretch run unfolds (${goldPct}% Gold). ${swingLine ? "They need to defend that cushion immediately: " + swingLine + "." : "Every remaining loss digs the hole deeper."}`;
  }
  if (!insideNow && insideProjected) {
    return `${name} are sitting at #${seed} today but are projected to rise to #${projected} (${goldPct}% Gold). They climb back into the picture if these next two break their way: ${swingLine}.`;
  }
  if (goldPct >= 15) {
    return `${name} are #${seed} now and project to #${projected} — still outside the line, but ${goldPct}% means they're alive and dangerous.${context.leaderName ? ` ${context.leaderName} currently set the pace up top.` : ""}${swingLine ? ` Swing games to circle: ${swingLine}.` : ""}`;
  }
  return `${name} are in survival mode (now #${seed}, projected #${projected}, ${goldPct}% Gold): they need wins plus help from around the league.${swingLine ? ` Must-watch swings: ${swingLine}.` : ""}`;
};

export type RecapInput = {
  before: { id: string; rank: number; goldPct: number; goldStatus: GoldStatus }[];
  after: { id: string; rank: number; goldPct: number; goldStatus: GoldStatus; name: string }[];
  finalsSinceLast: {
    game: Matchup;
    awayScore: number;
    homeScore: number;
    awayName: string;
    homeName: string;
  }[];
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
    | "dependency-chain"
    | "bubble-watch"
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
    case "bubble-watch":
      return 70;
    case "dependency-chain":
      return 66;
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
    ownResult?: { opponentName: string; didWin: boolean; wasUpset: boolean };
    competitorResults: { teamName: string; didLose: boolean; rank: number }[];
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
    const winnerId =
      awayPoints > homePoints ? f.game.away : homePoints > awayPoints ? f.game.home : "";
    const loserId =
      awayPoints > homePoints ? f.game.home : homePoints > awayPoints ? f.game.away : "";

    if (winnerId) {
      const winnerAttr = getAttribution(winnerId);
      winnerAttr.ownResult = {
        opponentName: winnerId === f.game.away ? f.homeName : f.awayName,
        didWin: true,
        wasUpset: (beforeById.get(winnerId)?.rank ?? 999) > (beforeById.get(loserId)?.rank ?? 999),
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
        wasUpset: (beforeById.get(winnerId)?.rank ?? 999) > (beforeById.get(loserId)?.rank ?? 999),
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
          : `${finalsSinceLast.length} games went final: ${finalsSinceLast
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
        kind: "dependency-chain",
        text: `Ripple effect: those results moved the standings for ${movedList}.`,
        why: [
          "Finalized results changed standings order for multiple teams.",
          "Cut-line pressure can move teams through opponent and competitor results, not just their own games.",
        ],
      });
    }
  }

  const bubbleTeams = after
    .filter((team) => team.rank >= Math.max(1, cutoff - 1) && team.rank <= cutoff + 2)
    .sort((a, b) => a.rank - b.rank);
  const finalGold = bubbleTeams.find((team) => team.rank === cutoff);
  const firstOut = bubbleTeams.find((team) => team.rank === cutoff + 1);
  if (bubbleTeams.length >= 2 && finalGold && firstOut) {
    items.push({
      kind: "bubble-watch",
      text: `Bubble watch: ${displayName(finalGold.name)} hold the final Gold slot at #${finalGold.rank} (${Math.round(finalGold.goldPct)}%), with ${displayName(firstOut.name)} first out at #${firstOut.rank} (${Math.round(firstOut.goldPct)}%).`,
      why: [
        "The teams nearest the cut line create the clearest league-wide stakes.",
        "Gold odds show how current standings and remaining dependencies are pulling on the bubble.",
      ],
    });
  }

  // Pass 1: clinch / elimination / cut-line crossings (highest signal first).
  after.forEach((team) => {
    const prev = beforeById.get(team.id);
    if (!prev) return;
    if (prev.goldStatus !== "Clinched" && team.goldStatus === "Clinched") {
      items.push({
        kind: "clinched",
        text: `${displayName(team.name)} clinched a Gold Bracket spot.`,
        why: ["Team status changed to Clinched.", "Remaining results now affect only seeding."],
      });
    }
    if (prev.goldStatus !== "Eliminated" && team.goldStatus === "Eliminated") {
      items.push({
        kind: "eliminated",
        text: `${displayName(team.name)} were knocked out of Gold Bracket contention.`,
        why: [
          "Team status changed to Eliminated.",
          "Gold path is no longer mathematically available.",
        ],
      });
    }
    if (prev.rank <= cutoff && team.rank > cutoff) {
      items.push({
        kind: "crossed-cut-down",
        text: `${displayName(team.name)} dropped below the Gold cut line (#${prev.rank} → #${team.rank}).`,
        why: [
          "Seed moved from inside to outside the cutoff.",
          "Cut-line movement can swing weekly priorities.",
        ],
      });
    }
    if (prev.rank > cutoff && team.rank <= cutoff) {
      items.push({
        kind: "crossed-cut-up",
        text: `${displayName(team.name)} moved above the Gold cut line (#${prev.rank} → #${team.rank}).`,
        why: [
          "Seed moved from outside to inside the cutoff.",
          "Team now controls its path more directly.",
        ],
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
  });
  rankChanges
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 4)
    .forEach((c) => {
      const verb = c.delta > 0 ? "climbed" : "slipped";
      const team = after.find((a) => a.name === c.name);
      const attr = team ? attributionById.get(team.id) : undefined;
      const reasons: string[] = [];
      if (attr?.ownResult) {
        if (attr.ownResult.didWin) {
          const upsetTag = attr.ownResult.wasUpset ? " in an upset" : "";
          reasons.push(`they took care of business vs ${attr.ownResult.opponentName}${upsetTag}`);
        } else {
          const upsetTag = attr.ownResult.wasUpset ? " in an upset" : "";
          reasons.push(`they lost to ${attr.ownResult.opponentName}${upsetTag}`);
        }
      }
      const competitor = attr?.competitorResults.find(
        (x) => x.rank > 0 && x.teamName !== displayName(c.name)
      );
      if (competitor) {
        if (competitor.didLose) {
          reasons.push(`${competitor.teamName} slipped to #${competitor.rank}`);
        } else {
          reasons.push(`${competitor.teamName} climbed to #${competitor.rank}`);
        }
      }
      const conciseReason =
        reasons.length > 0
          ? `${reasons.join("; ")}.`
          : "final scores across the board scrambled the order.";
      items.push({
        kind: "rank-change",
        text: `${displayName(c.name)} ${verb} from #${c.from} to #${c.to}. ${conciseReason}`,
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
        why: [
          "Simulation odds moved by at least 5 percentage points.",
          "This reflects both own result and competitor outcomes.",
        ],
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
    .slice(0, 16);
};

const storyContext = (item: RecapItem) => {
  const why = item.why?.filter(Boolean).slice(0, 2) ?? [];
  return why.length ? ` Context: ${why.join(" ")}` : "";
};

export const recapToStoryBrief = (
  seasonLabel: string,
  items: RecapItem[],
  generatedAt = new Date()
) => {
  const dateLabel = formatGameDate(`${generatedAt.getMonth() + 1}/${generatedAt.getDate()}`);
  const top = [...items].sort((a, b) => (b.impactScore ?? 0) - (a.impactScore ?? 0)).slice(0, 5);
  const [headline, ...beats] = top;

  if (!headline)
    return `${seasonLabel} League Story — ${dateLabel}\nNo standings-impact items yet.`;

  return [
    `${seasonLabel} League Story — ${dateLabel}`,
    `Headline: ${headline.text}${storyContext(headline)}`,
    beats.length ? "Story beats:" : "",
    ...beats.map((item) => `- ${item.text}${storyContext(item)}`),
  ]
    .filter(Boolean)
    .join("\n");
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
