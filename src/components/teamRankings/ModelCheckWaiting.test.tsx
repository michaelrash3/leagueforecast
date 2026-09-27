import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ModelCheckCard } from "./ModelCheckCard";
import { checkTheModel, type ModelCheckAnswer } from "../../lib/scoutBacktest";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../../lib/teamRankings";

/*
 * The model check, answered later.
 *
 * It ran in the button's click handler and froze the tab for 18 s on the 18:40 pool; it now runs in
 * the rankings worker and answers when it is done. So the card has to say it is working, and an
 * answer that arrives after the page has moved to another age group is that group's answer, not
 * this one's.
 */
const groups: AgeGroup[] = [
  { id: "u9", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: [] },
  { id: "u10", name: "10U 2027", ageLevel: 10, year: 2027, seasonIds: [] },
];
const teams: ScoutTeam[] = Array.from({ length: 8 }, (_, index) => ({
  id: `S-${index}`,
  name: `Club ${index}`,
}));
const games: ScoutGame[] = [];
teams.forEach((a, i) =>
  teams.slice(i + 1).forEach((b) => {
    const day = new Date(Date.UTC(2026, 8, 1) + games.length * 86_400_000);
    games.push({
      id: `g${games.length}`,
      ageGroupId: "u9",
      teamAId: a.id,
      teamBId: b.id,
      teamAScore: 12 - i,
      teamBScore: 5,
      date: day.toISOString().slice(0, 10),
    });
  })
);
const answer = checkTheModel("u9", teams, games, groups);

/** A check the test answers by hand. */
const deferred = () => {
  let settle: (value: ModelCheckAnswer | null) => void = () => {};
  const check = () =>
    new Promise<ModelCheckAnswer | null>((resolve) => {
      settle = resolve;
    });
  return { check, settle: (value: ModelCheckAnswer | null) => settle(value) };
};
const card = (ageGroupId: string, check: () => Promise<ModelCheckAnswer | null>) => (
  <ModelCheckCard
    ageGroupId={ageGroupId}
    groupName={ageGroupId === "u9" ? "9U 2027" : "10U 2027"}
    teams={teams}
    games={games}
    ageGroups={groups}
    check={check}
  />
);

describe("the model check while it is worked out", () => {
  it("says it is working and cannot be pressed twice, then shows the answer", async () => {
    const user = userEvent.setup();
    const { check, settle } = deferred();
    render(card("u9", check));
    await user.click(screen.getByRole("button", { name: "Check the model" }));

    expect(screen.getByRole("button", { name: "Working it out…" })).toBeDisabled();
    expect(screen.queryByText(/games predicted/i)).toBeNull();

    await act(async () => settle(answer));
    expect(screen.getByText(/games predicted/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run it again" })).toBeEnabled();
  });

  it("does not show one age group's answer under another's name", async () => {
    const user = userEvent.setup();
    const { check, settle } = deferred();
    const view = render(card("u9", check));
    await user.click(screen.getByRole("button", { name: "Check the model" }));
    view.rerender(card("u10", check));

    await act(async () => settle(answer));
    expect(screen.queryByText(/games predicted/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Check the model" })).toBeEnabled();
    // Back on the page it was for, it is there.
    view.rerender(card("u9", check));
    expect(screen.getByText(/games predicted/i)).toBeInTheDocument();
  });

  it("names no best age gap when no held-back game was between two rated clubs", async () => {
    // Cross-age games held back, every one with a side the fit never saw: nothing to compare on.
    const unrated: ModelCheckAnswer = {
      ...answer,
      result: { ...answer.result, crossAgeSamples: 3 },
      gaps: [1, 1.5, 2, 2.5, 3].map((ageGapPrior) => ({
        ...answer.result,
        ageGapPrior,
        ratedError: null,
        ratedSamples: 0,
      })),
    };
    const user = userEvent.setup();
    render(card("u9", () => Promise.resolve(unrated)));
    await user.click(screen.getByRole("button", { name: "Check the model" }));

    expect(await screen.findByText(/cannot be compared here/i)).toBeInTheDocument();
    expect(screen.queryByText(/Held at 1 instead/i)).toBeNull();
  });

  it("says to run it again when the pool changed before it was done", async () => {
    const user = userEvent.setup();
    const { check, settle } = deferred();
    render(card("u9", check));
    await user.click(screen.getByRole("button", { name: "Check the model" }));

    await act(async () => settle(null));
    expect(screen.getByRole("status")).toHaveTextContent(/pool changed while this ran/i);
    expect(screen.queryByText(/games predicted/i)).toBeNull();
  });
});
