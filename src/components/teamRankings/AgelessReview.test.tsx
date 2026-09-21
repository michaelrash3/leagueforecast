import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AgelessReviewCard } from "./AgelessReviewCard";
import { forgetClubs } from "../../lib/deletedGames";
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
  const onUndo = vi.fn();
  render(
    <AgelessReviewCard
      ageless={list}
      named={new Map()}
      dropped={new Set()}
      onNameAge={onNameAge}
      onThrowOut={onThrowOut}
      onUndo={onUndo}
      now={NOW}
      {...over}
    />
  );
  return { onNameAge, onThrowOut, onUndo };
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

  it("finds one team among many by name, and by id", async () => {
    /*
     * The wall the batch exists to avoid is also a wall for somebody hunting one club: with the
     * queue ten at a time and sorted by how invented a page looks, row fourteen thousand cannot
     * be reached at all. So the card searches instead of paging.
     */
    const user = userEvent.setup();
    show(twelve());
    const box = screen.getByRole("searchbox", { name: /Find a team/ });
    await user.type(box, "Club 7");
    expect(rows()).toHaveLength(1);
    expect(within(rows()[0]!).getByText("Club 7")).toBeInTheDocument();

    await user.clear(box);
    await user.type(box, "ID3");
    expect(rows()).toHaveLength(1);
    expect(within(rows()[0]!).getByText("ID3")).toBeInTheDocument();
  });

  it("finds a team the queue is hiding, and says what is holding it", async () => {
    /*
     * The case the search is really for. This team was thrown out, so it is on no queue and no
     * amount of scrolling would ever reach it — and "no such team" is the worst possible answer
     * to somebody who knows the club is in there.
     */
    const user = userEvent.setup();
    show(twelve(), { dropped: forgetClubs(new Set(), ["ID4"]) });
    await user.type(screen.getByRole("searchbox", { name: /Find a team/ }), "Club 4");
    expect(rows()).toHaveLength(1);
    expect(screen.getByText(/You threw this one out/)).toBeInTheDocument();
  });

  it("offers to take back an answer, which nothing else in the app does", async () => {
    const user = userEvent.setup();
    const { onUndo } = show(twelve(), { dropped: forgetClubs(new Set(), ["ID4"]) });
    await user.type(screen.getByRole("searchbox", { name: /Find a team/ }), "Club 4");
    await user.click(screen.getByRole("button", { name: "Undo that" }));
    expect(onUndo).toHaveBeenCalledWith("ID4", "Club 4");
  });

  it("does not offer an undo for a team that is simply on the queue", async () => {
    // There is nothing to take back: nobody has said anything about it yet.
    const user = userEvent.setup();
    show(twelve());
    await user.type(screen.getByRole("searchbox", { name: /Find a team/ }), "Club 4");
    expect(screen.queryByRole("button", { name: "Undo that" })).not.toBeInTheDocument();
  });

  it("says so plainly when nothing answers to what was typed", async () => {
    const user = userEvent.setup();
    show(twelve());
    await user.type(screen.getByRole("searchbox", { name: /Find a team/ }), "zzzz");
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByText(/No team on this list answers to that/)).toBeInTheDocument();
  });

  it("still offers the search when the queue itself is empty", async () => {
    /*
     * Which is exactly when somebody needs it: every row answered or left alone, so the queue is
     * empty and the teams are all still in there. The card used to render nothing at all.
     */
    const user = userEvent.setup();
    show(twelve(), {
      dropped: forgetClubs(
        new Set(),
        Array.from({ length: 12 }, (_, i) => `ID${i}`)
      ),
    });
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    await user.type(screen.getByRole("searchbox", { name: /Find a team/ }), "Club 9");
    expect(rows()).toHaveLength(1);
  });

  it("says nothing at all when nobody is waiting", () => {
    const { container } = render(
      <AgelessReviewCard
        ageless={[]}
        named={new Map()}
        dropped={new Set()}
        onNameAge={vi.fn()}
        onThrowOut={vi.fn()}
        onUndo={vi.fn()}
        now={NOW}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
