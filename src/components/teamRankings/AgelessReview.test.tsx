import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AgelessReviewCard } from "./AgelessReviewCard";
import type { AgeUnknownList } from "../../lib/ageUnknown";
import type { AgelessEvidence } from "../../lib/agelessEvidence";

const NOW = new Date("2026-09-20T12:00:00.000Z");
const daysBefore = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const evidence = (extra: Partial<AgelessEvidence> = {}): AgelessEvidence => ({
  games: 4,
  scored: 4,
  aheadOfToday: 0,
  shutoutBlowouts: 0,
  opponents: 4,
  namedAnAge: 0,
  tally: [],
  ...extra,
});

const team = (id: string, name: string, extra: Partial<AgeUnknownList[number]> = {}) => ({
  teamId: id,
  name,
  firstSeen: daysBefore(20),
  lastTried: daysBefore(10),
  tries: 1,
  evidence: evidence(),
  ...extra,
});

const twelve = (): AgeUnknownList =>
  Array.from({ length: 12 }, (_, i) => team(`ID${i}`, `Club ${i}`));

const show = (
  list: AgeUnknownList,
  over: Partial<Parameters<typeof AgelessReviewCard>[0]> = {}
) => {
  const onNameAge = vi.fn();
  const onThrowOut = vi.fn().mockResolvedValue(true);
  render(
    <AgelessReviewCard
      ageless={list}
      named={new Map()}
      dropped={new Set()}
      onNameAge={onNameAge}
      onThrowOut={onThrowOut}
      now={NOW}
      {...over}
    />
  );
  return { onNameAge, onThrowOut };
};

const rows = () => screen.getAllByRole("listitem");

describe("the review card for teams waiting on an age", () => {
  it("shows ten at a time, with the id and the whole name", () => {
    show(twelve());
    expect(rows()).toHaveLength(10);
    expect(screen.getByText(/Showing 10 of 12/)).toBeInTheDocument();

    const first = within(rows()[0]!);
    // The id has to be copyable and the name must not be cut short: the point is looking it up.
    expect(first.getByText("ID0")).toBeInTheDocument();
    expect(first.getByText("Club 0")).toBeInTheDocument();
    expect(first.getByRole("link", { name: /Open on GameChanger/ })).toHaveAttribute(
      "href",
      "https://web.gc.com/teams/ID0"
    );
  });

  it("says why each one could not be aged", () => {
    show([team("ID0", "Club 0", { evidence: evidence({ tally: [[9, 2]], namedAnAge: 2 }) })]);
    expect(screen.getByText(/2 of its opponents say 9U — it needs 3/)).toBeInTheDocument();
  });

  it("offers every age it ranks and nothing else", async () => {
    show([team("ID0", "Club 0")]);
    const picker = screen.getByRole("combobox", { name: /Age for Club 0/ });
    const offered = within(picker)
      .getAllByRole("option")
      .map((one) => one.textContent);
    expect(offered).toEqual(["Choose…", ...Array.from({ length: 11 }, (_, i) => `${i + 8}U`)]);
  });

  it("hands the named age back with the id and the name", async () => {
    const user = userEvent.setup();
    const { onNameAge } = show([team("ID0", "Club 0")]);
    await user.selectOptions(screen.getByRole("combobox", { name: /Age for Club 0/ }), "9");
    expect(onNameAge).toHaveBeenCalledWith("ID0", "Club 0", 9);
  });

  it("asks before throwing one out", async () => {
    const user = userEvent.setup();
    const { onThrowOut } = show([team("ID0", "Club 0")]);
    await user.click(screen.getByRole("button", { name: /Not a real team/ }));
    expect(onThrowOut).toHaveBeenCalledWith("ID0", "Club 0");
  });

  it("puts the ones that look invented at the top", () => {
    show([
      team("honest", "An Honest Club"),
      team("fake", "Test team", {
        evidence: evidence({ aheadOfToday: 4, shutoutBlowouts: 4, playerCount: 2 }),
      }),
    ]);
    expect(within(rows()[0]!).getByText("Test team")).toBeInTheDocument();
    expect(
      within(rows()[0]!).getByText(/4 scored on a day that has not happened/)
    ).toBeInTheDocument();
  });

  /*
   * The signal is an ordering and nothing more — an empty schedule is a club somebody made this
   * morning as often as it is a fiction — so the row must not be dressed as a verdict.
   */
  it("does not colour a row by how invented it looks", () => {
    show([
      team("fake", "Test team", {
        evidence: evidence({ aheadOfToday: 4, shutoutBlowouts: 4, playerCount: 2 }),
      }),
    ]);
    expect(rows()[0]!.innerHTML).not.toMatch(/text-red|bg-red|text-emerald|bg-emerald/);
  });

  it("says nothing at all when nobody is waiting", () => {
    const { container } = render(
      <AgelessReviewCard
        ageless={[]}
        named={new Map()}
        dropped={new Set()}
        onNameAge={vi.fn()}
        onThrowOut={vi.fn()}
        now={NOW}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
