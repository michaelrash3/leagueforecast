import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ScheduleImportPanel } from "./ScheduleImportPanel";
import type { ScoutGame, ScoutTeam } from "../lib/teamRankings";
import type { ToastTone } from "../hooks/useToast";

/**
 * The other half of a season arriving: a pasted schedule, reviewed row by row, then saved.
 *
 * Nothing wrote a test for it, and it is the one screen in the app that can quietly create teams.
 * Every name on a row that does not already resolve becomes a new club, so a near-duplicate
 * spelling splits one team's record in two and a placeholder collects games belonging to whoever
 * turns up. The panel flags both rather than correcting either, because two real teams can be one
 * character apart — and that judgement is exactly the part worth pinning.
 */
const setup = (over: Partial<Parameters<typeof ScheduleImportPanel>[0]> = {}) => {
  const onImport = vi.fn<(teams: ScoutTeam[], games: ScoutGame[]) => void>();
  const onClose = vi.fn();
  const showToast = vi.fn<(message: string, options?: { tone?: ToastTone }) => void>();

  render(
    <ScheduleImportPanel
      ageGroupId={over.ageGroupId ?? "ag1"}
      ageGroupName={over.ageGroupName ?? "10U 2027"}
      teams={over.teams ?? []}
      suggestedTeams={over.suggestedTeams ?? []}
      existingGames={over.existingGames ?? []}
      defaultSubjectTeam={over.defaultSubjectTeam ?? ""}
      onImport={over.onImport ?? onImport}
      onClose={over.onClose ?? onClose}
      showToast={over.showToast ?? showToast}
    />
  );

  return { onImport, onClose, showToast };
};

/** A schedule: the rows name only the opponent, so every score is from the subject's side. */
const SCHEDULE = `Date,Opponent,Us,Them
2026-08-22,Velocirabbits,6,5
2026-08-23,NV Stars,3,10`;

const paste = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
  await user.click(screen.getByLabelText("Games to import"));
  await user.paste(text);
  await user.click(screen.getByRole("button", { name: "Read games" }));
};

describe("reading what was pasted", () => {
  it("puts every row up for review rather than saving any of them", async () => {
    const user = userEvent.setup();
    const { onImport } = setup();

    await paste(user, SCHEDULE);

    expect(screen.getByRole("button", { name: /add 2 games/i })).toBeInTheDocument();
    // Nothing is written until somebody has looked at it.
    expect(onImport).not.toHaveBeenCalled();
  });

  it("says so when the text holds no games, and stays where it is", async () => {
    const user = userEvent.setup();
    const { showToast } = setup();

    await paste(user, "this is not a schedule");

    expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/no games could be read/i), {
      tone: "error",
    });
    expect(screen.getByLabelText("Games to import")).toBeInTheDocument();
  });

  it("asks for something to read before complaining about what it says", async () => {
    const user = userEvent.setup();
    const { showToast } = setup();

    await user.click(screen.getByRole("button", { name: "Read games" }));

    expect(showToast).toHaveBeenCalledWith("Paste your games first.", { tone: "error" });
  });
});

describe("whose schedule it is", () => {
  it("is asked for when the rows name only an opponent", async () => {
    const user = userEvent.setup();
    setup();

    await paste(user, SCHEDULE);

    expect(screen.getByText("Whose schedule is this?")).toBeInTheDocument();
  });

  it("will not save until it has been answered", async () => {
    const user = userEvent.setup();
    const { onImport, showToast } = setup();

    await paste(user, SCHEDULE);
    await user.click(screen.getByRole("button", { name: /add 2 games/i }));

    /*
     * Every score on these rows is written from the subject's side, so saving without one would
     * file two games against a team nobody named — and get the scores the wrong way round.
     */
    expect(showToast).toHaveBeenCalledWith("Enter which team's schedule this is.", {
      tone: "error",
    });
    expect(onImport).not.toHaveBeenCalled();
  });

  it("does not ask when the rows already name both sides", async () => {
    const user = userEvent.setup();
    setup();

    await paste(user, "Date,Team,Opponent,Score\n2026-08-22,Rays,Jays,6-5");

    expect(screen.queryByText("Whose schedule is this?")).toBeNull();
  });
});

describe("saving the reviewed rows", () => {
  it("creates the teams the names need and files the games under this age group", async () => {
    const user = userEvent.setup();
    const { onImport } = setup({ defaultSubjectTeam: "Rays" });

    await paste(user, SCHEDULE);
    await user.click(screen.getByRole("button", { name: /add 2 games/i }));

    expect(onImport).toHaveBeenCalledTimes(1);
    const [teams, games] = onImport.mock.calls[0]!;
    expect(teams.map((entry) => entry.name).sort()).toEqual(["NV Stars", "Rays", "Velocirabbits"]);
    expect(games).toHaveLength(2);
    expect(games.every((game) => game.ageGroupId === "ag1")).toBe(true);
    // The subject's score is always the first of the pair: 6-5, then 3-10.
    expect(games.map((game) => [game.teamAScore, game.teamBScore])).toEqual([
      [6, 5],
      [3, 10],
    ]);
  });

  it("leaves a game with no score unplayed rather than filing it nil-nil", async () => {
    const user = userEvent.setup();
    const { onImport } = setup({ defaultSubjectTeam: "Rays" });

    await paste(user, "Date,Opponent,Us,Them\n2026-09-05,Bourbon Bandits,,");
    await user.click(screen.getByRole("button", { name: /add 1 game/i }));

    const [, games] = onImport.mock.calls[0]!;
    expect(games[0]?.teamAScore).toBeUndefined();
    expect(games[0]?.teamBScore).toBeUndefined();
  });

  it("refuses a half-typed score instead of guessing the other half", async () => {
    const user = userEvent.setup();
    const { onImport, showToast } = setup({ defaultSubjectTeam: "Rays" });

    await paste(user, SCHEDULE);
    const [firstOpponentScore] = screen.getAllByLabelText("Opponent score");
    await user.clear(firstOpponentScore!);
    await user.click(screen.getByRole("button", { name: /add 2 games/i }));

    expect(showToast).toHaveBeenCalledWith("Fix or uncheck the highlighted rows first.", {
      tone: "error",
    });
    expect(onImport).not.toHaveBeenCalled();
  });

  it("saves only the rows still ticked", async () => {
    const user = userEvent.setup();
    const { onImport } = setup({ defaultSubjectTeam: "Rays" });

    await paste(user, SCHEDULE);
    await user.click(screen.getByLabelText("Add Rays versus NV Stars"));
    await user.click(screen.getByRole("button", { name: /add 1 game/i }));

    const [, games] = onImport.mock.calls[0]!;
    expect(games).toHaveLength(1);
  });

  it("has nothing to do when every row has been unticked", async () => {
    const user = userEvent.setup();
    const { onImport, showToast } = setup({ defaultSubjectTeam: "Rays" });

    await paste(user, SCHEDULE);
    await user.click(screen.getByLabelText("Add Rays versus Velocirabbits"));
    await user.click(screen.getByLabelText("Add Rays versus NV Stars"));
    await user.click(screen.getByRole("button", { name: /add 0 games/i }));

    expect(showToast).toHaveBeenCalledWith("Nothing selected to add.", { tone: "error" });
    expect(onImport).not.toHaveBeenCalled();
  });
});

describe("a name worth a second look", () => {
  it("flags one that is nearly a team already here, without changing it", async () => {
    const user = userEvent.setup();
    const roster: ScoutTeam[] = [
      { id: "t1", name: "Rays" },
      { id: "t2", name: "Velocirabbits" },
    ];
    setup({ teams: roster, defaultSubjectTeam: "Rays" });

    await paste(user, "Date,Opponent,Us,Them\n2026-08-22,Velocirabbit,6,5");

    // Shown, never applied: a suggestion is a button because two real clubs can be one letter
    // apart, and merging them would put one record under the other's name.
    expect(screen.getByText(/velocirabbits/i)).toBeInTheDocument();
    const cell = screen.getByDisplayValue("Velocirabbit");
    expect(cell).toBeInTheDocument();
  });

  it("flags a placeholder, which would otherwise become a team that collects other teams' games", async () => {
    const user = userEvent.setup();
    setup({ defaultSubjectTeam: "Rays" });

    await paste(user, "Date,Opponent,Us,Them\n2026-08-22,TBD,6,5");

    expect(screen.getByText(/names nobody|placeholder/i)).toBeInTheDocument();
  });
});

describe("a game this age group already has", () => {
  it("is unticked and cannot be ticked back on", async () => {
    const user = userEvent.setup();
    const roster: ScoutTeam[] = [
      { id: "t1", name: "Rays" },
      { id: "t2", name: "Velocirabbits" },
    ];
    const already: ScoutGame[] = [
      {
        id: "existing",
        teamAId: "t1",
        teamBId: "t2",
        ageGroupId: "ag1",
        teamAScore: 6,
        teamBScore: 5,
        date: "2026-08-22",
      },
    ];
    setup({ teams: roster, existingGames: already, defaultSubjectTeam: "Rays" });

    await paste(user, "Date,Opponent,Us,Them\n2026-08-22,Velocirabbits,6,5");

    const box = screen.getByLabelText("Add Rays versus Velocirabbits");
    expect(box).not.toBeChecked();
    expect(box).toBeDisabled();
    expect(screen.getByText(/already in this age group/i)).toBeInTheDocument();
  });
});

describe("lines that could not be read", () => {
  it("names them rather than dropping them silently", async () => {
    const user = userEvent.setup();
    setup({ defaultSubjectTeam: "Rays" });

    await paste(user, "Date,Opponent,Us,Them\n2026-08-22,Velocirabbits,6,5\nnonsense line here");

    const note = screen.getByText(/could not be read/i);
    expect(within(note).getByText(/nonsense line here/i)).toBeInTheDocument();
  });
});
