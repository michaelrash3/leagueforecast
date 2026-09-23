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
  const onClearRows = vi.fn().mockResolvedValue(true);
  render(
    <AgelessReviewCard
      ageless={list}
      named={new Map()}
      dropped={new Set()}
      onNameAge={onNameAge}
      onThrowOut={onThrowOut}
      onUndo={onUndo}
      onClearRows={onClearRows}
      now={NOW}
      {...over}
    />
  );
  return { onNameAge, onThrowOut, onUndo, onClearRows };
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

  /* The sitting opens on the decisions worth making; the pages that look made up sink to the end. */
  it("puts the likeliest real teams at the top and the made-up-looking ones at the bottom", () => {
    show([
      team("fake", "Test team", {
        evidence: evidence({ aheadOfToday: 4, shutoutBlowouts: 4, playerCount: 2 }),
      }),
      team("honest", "An Honest Club"),
    ]);
    expect(within(rows()[0]!).getByText("An Honest Club")).toBeInTheDocument();
    expect(within(rows()[1]!).getByText("Test team")).toBeInTheDocument();
    // Still told why, wherever it sits.
    expect(
      within(rows()[1]!).getByText(/4 scored on a day that has not happened/)
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
     * be reached at all, whichever end the ordering starts from. So the card searches instead of
     * paging.
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

  it("will not offer an age for a team the import would refuse anyway", async () => {
    /*
     * The trap this closes. A thrown-out club is refused before its age is read, so naming one
     * revives the row, the pull comes back "deleted", and `updateAgeUnknown` drops the row for
     * any outcome that is not "no age" — the team and its undo leave the card for good. The way
     * back from a thrown-out club is the undo, and only the undo.
     */
    const user = userEvent.setup();
    show(twelve(), { dropped: forgetClubs(new Set(), ["ID4"]) });
    await user.type(screen.getByRole("searchbox", { name: /Find a team/ }), "Club 4");
    expect(screen.queryByRole("combobox", { name: /Age for/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Not a real team" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo that" })).toBeInTheDocument();
  });

  it("still offers an age for a team that was only left alone", async () => {
    // Nothing refuses that one — it simply stopped being asked about, and an age puts it back.
    const user = userEvent.setup();
    show([
      team("SPENT", "Club Spent", {
        tries: 99,
        firstSeen: daysBefore(400),
        lastTried: daysBefore(300),
      }),
    ]);
    await user.type(screen.getByRole("searchbox", { name: /Find a team/ }), "Spent");
    expect(screen.getByRole("combobox", { name: /Age for/ })).toBeInTheDocument();
    expect(screen.getByText(/Left alone/)).toBeInTheDocument();
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
        onClearRows={vi.fn()}
        now={NOW}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });
});

/**
 * The button that gets the list off this machine.
 *
 * Tested through the Blob rather than through a mocked module, because the two things that can go
 * wrong are both in what the file holds: the wrong population in it (the ten drawn, or the rows
 * already answered) and the wrong name on it.
 */
describe("downloading the whole list", () => {
  /** Captures the file the click hands to the browser, and gives back its text and its name. */
  const catchDownload = () => {
    const seen: { name: string; parts: BlobPart[] } = { name: "", parts: [] };
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:stub");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    /*
     * jsdom's Blob will not give its contents back synchronously, so the parts are taken as they
     * are handed to the constructor. That also happens to assert the thing worth asserting: that
     * the file is built in pieces rather than as one string.
     */
    const RealBlob = globalThis.Blob;
    vi.stubGlobal(
      "Blob",
      class extends RealBlob {
        constructor(parts: BlobPart[] = [], options?: BlobPropertyBag) {
          super(parts, options);
          seen.parts = parts;
        }
      }
    );
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      seen.name = this.download;
    });
    return {
      get name() {
        return seen.name;
      },
      get text() {
        return seen.parts.map((part) => String(part)).join("");
      },
    };
  };

  it("writes every waiting team, not the ten on screen", async () => {
    const user = userEvent.setup();
    const file = catchDownload();
    show(twelve());

    await user.click(screen.getByRole("button", { name: /download the list/i }));

    expect(file.name).toBe("gamechanger-waiting-on-an-age-2026-09-20.csv");
    // Eleven behind the ten drawn, and the header.
    expect(file.text.trim().split("\n")).toHaveLength(13);
    expect(file.text).toContain("Club 11");
    expect(file.text.startsWith("\ufeff")).toBe(true);
  });

  it("leaves out a team already answered or thrown out", async () => {
    const user = userEvent.setup();
    const file = catchDownload();
    show(twelve(), {
      named: new Map([["ID3", { teamId: "ID3", level: 10, namedAt: daysBefore(1) }]]),
      dropped: forgetClubs(new Set<string>(), ["ID4"]),
    });

    await user.click(screen.getByRole("button", { name: /download the list/i }));

    expect(file.text).not.toContain("Club 3");
    expect(file.text).not.toContain("Club 4");
    expect(file.text).toContain("Club 5");
  });
});

/**
 * The rows a rule has settled, cleared in one pass.
 *
 * What it must get right is *which* rows. `agelessTriage` holds rules that only propose — a
 * closed league that names itself nothing, a horse mascot — beside the ones the user settled, and
 * a button that quietly took one of those along would apply a guess to thousands of teams at once.
 */
describe("clearing the rows a rule has settled", () => {
  const labelled = (id: string, name: string, ageLabel: string) =>
    team(id, name, { evidence: evidence({ ageLabel }) });

  const mixed = (): AgeUnknownList => [
    labelled("ADULT1", "Long Island Angels 44", "Over 18"),
    labelled("ADULT2", "MCC Wolves", "college"),
    labelled("SCHOOL1", "Flaming Bulldogs", "high_varsity"),
    labelled("TEEBALL", "MTAA TBall White", "Under 13"),
    team("REC1", "Fire Chiefs", { evidence: evidence({ ngb: ["little_league"] }) }),
    team("VOID1", "VOID - DO NOT USE"),
    team("PLAIN", "Some Club"),
    team("MUSTANG", "Fillmore Mustangs"),
  ];

  it("counts each rule's rows, ticked, and offers to clear them all", () => {
    show(mixed());
    expect(screen.getByRole("checkbox", { name: /2 GameChanger filed it as adult/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /1 Tee ball and younger/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /1 Named void/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /1 A Little League/ })).toBeChecked();
    expect(screen.getByRole("button", { name: "Clear the 6 ticked" })).toBeInTheDocument();
  });

  it("hands over those rows and no others", async () => {
    const user = userEvent.setup();
    const { onClearRows } = show(mixed());

    await user.click(screen.getByRole("button", { name: "Clear the 6 ticked" }));

    const handed = onClearRows.mock.calls[0]?.[0] as { row: { teamId: string } }[];
    expect(handed.map((one) => one.row.teamId).sort()).toEqual(
      ["ADULT1", "ADULT2", "SCHOOL1", "TEEBALL", "REC1", "VOID1"].sort()
    );
  });

  it("leaves a rule's rows where they are once it is unticked", async () => {
    const user = userEvent.setup();
    const { onClearRows } = show(mixed());

    await user.click(screen.getByRole("checkbox", { name: /A Little League/ }));
    await user.click(screen.getByRole("button", { name: "Clear the 5 ticked" }));

    const handed = onClearRows.mock.calls[0]?.[0] as { row: { teamId: string } }[];
    expect(handed.map((one) => one.row.teamId)).not.toContain("REC1");
  });

  it("offers nothing when no rule has settled anything", () => {
    show([team("PLAIN", "Some Club"), team("MUSTANG", "Fillmore Mustangs")]);
    expect(screen.queryByRole("button", { name: /ticked/ })).toBeNull();
    expect(screen.queryByText("Settled by rule")).toBeNull();
  });

  /*
   * A row the reader has already answered for is not the button's to clear: it is off the waiting
   * list, and sweeping it up would write a machine verdict over somebody's own decision.
   */
  it("leaves out a team already answered or thrown out", () => {
    show(mixed(), {
      named: new Map([["ADULT1", { teamId: "ADULT1", level: 10, namedAt: daysBefore(1) }]]),
      dropped: forgetClubs(new Set<string>(), ["ADULT2"]),
    });
    expect(screen.getByRole("button", { name: "Clear the 4 ticked" })).toBeInTheDocument();
  });
});
