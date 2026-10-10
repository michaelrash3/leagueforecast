import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Finding } from "../../lib/leagueFindings";
import { buildPredictionEngine } from "../../lib/predictionEngine";
import { calculateTeams } from "../../lib/sim";
import { DEFAULT_SETTINGS, type GameLog, type Matchup, type TeamBase } from "../../lib/types";
import { ForecastWhy } from "./ForecastWhy";

/*
 * Why a matchup's odds are what they are (2.8), as a card shows it: the strongest reason for each
 * side, the margin as its parts, every factor on request, what could change it, and the four
 * numbers easily taken for one another, each said apart. Placeholder teams.
 */

const final = (away: number, home: number): GameLog => ({
  awayRuns: String(away),
  homeRuns: String(home),
  awayHits: "6",
  homeHits: "5",
  awayK: "4",
  homeK: "5",
  innings: "6",
  isFinal: true,
});

const teams: TeamBase[] = [
  { id: "A", name: "Aces" },
  { id: "B", name: "Bears" },
  { id: "C", name: "Comets" },
];
const matchups: Matchup[] = [
  { id: "g1", date: "5/2", away: "A", home: "B" },
  { id: "g2", date: "5/9", away: "B", home: "C" },
  { id: "g3", date: "5/16", away: "C", home: "A" },
  { id: "g4", date: "5/23", away: "A", home: "B" },
];
const logs = { g1: final(8, 2), g2: final(5, 4), g3: final(3, 6) };

const predictionFor = (scores: Record<string, GameLog> = logs) => {
  const engine = buildPredictionEngine(
    calculateTeams(teams, matchups, scores, DEFAULT_SETTINGS),
    matchups,
    scores,
    DEFAULT_SETTINGS
  );
  const prediction = engine.predictions.find((one) => one.gameId === "g4");
  if (!prediction) throw new Error("No forecast");
  return prediction;
};

const nameOf = (id: string) => teams.find((team) => team.id === id)?.name ?? id;

describe("ForecastWhy", () => {
  it("leads with the strongest reason for each side and the margin as its parts", () => {
    const prediction = predictionFor();
    render(
      <ForecastWhy
        prediction={prediction}
        nameOf={nameOf}
        record={{ winnerAccuracy: 2 / 3, sampleSize: 3 }}
      />
    );
    const reasons = screen.getAllByRole("listitem").slice(0, 2);
    expect(reasons[0]).toHaveTextContent(/^For Aces: Results \(\d+\.\d runs\)\. Average margin/);
    expect(reasons[1]).toHaveTextContent(/^For Bears: /);
    expect(
      screen.getByText(/^Projected margin: Aces by \d+\.\d runs, from results \+\d+\.\d/)
    ).toBeInTheDocument();
  });

  it("keeps win chance, the range, confidence, Gold % and the record so far apart", () => {
    const prediction = predictionFor();
    render(
      <ForecastWhy
        prediction={prediction}
        nameOf={nameOf}
        record={{ winnerAccuracy: 2 / 3, sampleSize: 3 }}
      />
    );
    const terms = screen.getAllByRole("term").map((term) => term.textContent?.trim());
    expect(terms).toEqual(["Win chance:", "Range:", "Confidence:", "Gold %:", "Accuracy so far:"]);
    expect(
      screen.getByRole("heading", { name: "Five numbers that are not the same" })
    ).toBeVisible();
    const meaning = (term: string) =>
      screen.getByText(term, { selector: "dt" }).nextElementSibling?.textContent ?? "";
    expect(meaning("Win chance:")).toMatch(
      new RegExp(
        `^${Math.round(prediction.winProbability.teamA * 100)}% for Aces, how often the model expects`
      )
    );
    // Aces by 3.5, expected 6.4 to 2.9: 9 runs either side of the margin, 6.5 either side of each
    // score, in whole runs.
    expect(meaning("Range:")).toBe(
      "Bears by 6 to Aces by 13, where eight games in ten like this one end, with Aces scoring 0–13 and Bears 0–9. It is how far one game strays from its forecast, measured on about 97,000 youth games: the same width however sure the model is, and not a second chance of winning."
    );
    expect(meaning("Confidence:")).toContain(
      `${prediction.confidence.tier} (${prediction.confidence.score} of 100)`
    );
    expect(meaning("Confidence:")).toContain("It is not a second chance of winning.");
    expect(meaning("Gold %:")).toContain("not of winning this game");
    expect(meaning("Accuracy so far:")).toBe(
      "of 3 finished games, each called from the games before it, the favorite won 2 (67%). A record of past games, not a promise about this one."
    );
  });

  it("shows every factor, in the margin and beside it, on request", async () => {
    const user = userEvent.setup();
    render(<ForecastWhy prediction={predictionFor()} nameOf={nameOf} />);
    const toggle = screen.getByRole("button", { name: "Every factor" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("heading", { name: "In the margin" })).toBeNull();
    await user.click(toggle);
    expect(screen.getByRole("button", { name: "Fewer factors" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    const margin = screen.getByRole("heading", { name: "In the margin" }).parentElement;
    const beside = screen.getByRole("heading", { name: "Beside it" }).parentElement;
    if (!margin || !beside) throw new Error("No factor lists");
    expect(within(margin).getByText(/^Home field:/)).toBeInTheDocument();
    expect(within(beside).getByText(/^Recent form/)).toBeInTheDocument();
    expect(within(beside).getByText(/^Games behind each rating:/)).toBeInTheDocument();
  });

  it("says what could change it, and when nothing stands out", () => {
    // Each side has played twice: one more result could move it a long way.
    const { unmount } = render(<ForecastWhy prediction={predictionFor()} nameOf={nameOf} />);
    expect(
      screen.getByText(
        "Aces has 2 games the rating can use, so one more result could move this a long way."
      )
    ).toBeInTheDocument();
    expect(screen.getByText("Accuracy so far:").nextElementSibling).toHaveTextContent(
      "none yet: no finished game to look back on."
    );
    unmount();
  });

  it("says when nothing stands out, and when the chance was held at its ceiling", () => {
    const prediction = predictionFor();
    const explanation = prediction.explanation;
    if (!explanation) throw new Error("No explanation");
    // The same forecast with each side's rating resting on five games, and its chance held.
    const settled = {
      ...prediction,
      explanation: {
        ...explanation,
        teamA: { ...explanation.teamA, fittedGames: 5 },
        teamB: { ...explanation.teamB, fittedGames: 5 },
        probabilityCapped: true,
      },
    };
    render(<ForecastWhy prediction={settled} nameOf={nameOf} />);
    expect(
      screen.getByText(
        "Nothing stands out: both sides have played enough, and recently enough, to go on."
      )
    ).toBeInTheDocument();
    expect(screen.getByText("Win chance:").nextElementSibling).toHaveTextContent(
      /Held at 92%: no game at this level is a sure thing\.$/
    );
  });

  it("reads a link guessed from a name off the season's findings", () => {
    const prediction = predictionFor();
    const explanation = prediction.explanation;
    if (!explanation) throw new Error("No explanation");
    // The Bears' rating rests on tournament results too, from a club linked by its name.
    const linked = {
      ...prediction,
      explanation: { ...explanation, teamB: { ...explanation.teamB, fittedGames: 6 } },
    };
    const guessed: Finding = {
      code: "link-ambiguous",
      severity: "info",
      summary: "1 team whose name more than one club in Team Rankings carries",
      detail: "",
      suggestion: "",
      targets: [{ kind: "team", id: "B", label: "Bears" }],
      affectsForecast: false,
      fingerprint: "link-ambiguous|B:x",
    };
    render(<ForecastWhy prediction={linked} nameOf={nameOf} findings={[guessed]} />);
    expect(
      screen.getByText(
        "Bears's Team Rankings results come from a club picked by name, and more than one club carries it: they may be another club's."
      )
    ).toBeInTheDocument();
  });

  it("says it cannot explain a forecast it had nothing to go on for", () => {
    const blank = predictionFor({});
    expect(blank.explanation).toBeUndefined();
    render(<ForecastWhy prediction={blank} nameOf={nameOf} />);
    expect(screen.getByText(/The model needs finished games before it can say why/)).toBeVisible();
  });
});
