import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AgelessReviewCard } from "./AgelessReviewCard";
import { forgetClubs } from "../../lib/deletedGames";
import type { AgeUnknownList } from "../../lib/ageUnknown";
import type { AgelessEvidence } from "../../lib/agelessEvidence";

const NOW = new Date("2026-09-20T12:00:00.000Z");
const daysBefore = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

/**
 * Four games and one opponent writing an age, too few to file by: a team a person can answer, so
 * on the queue. One with no opponent writing an age is set aside, and says so where that is meant.
 */
const evidence = (extra: Partial<AgelessEvidence> = {}): AgelessEvidence => ({
  games: 4,
  scored: 4,
  aheadOfToday: 0,
  shutoutBlowouts: 0,
  opponents: 4,
  namedAnAge: 1,
  tally: [[10, 1]],
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

  it("holds the ten in front of the person while they are answered, not sliding the next in", async () => {
    const user = userEvent.setup();
    const list = twelve();
    const card = (named: Map<string, { teamId: string; level: number; namedAt: string }>) => (
      <AgelessReviewCard
        ageless={list}
        named={named}
        dropped={new Set()}
        onNameAge={vi.fn()}
        onThrowOut={vi.fn()}
        onUndo={vi.fn()}
        onClearRows={vi.fn()}
        now={NOW}
      />
    );
    const { rerender } = render(card(new Map()));
    expect(rows()).toHaveLength(10);
    const first = rows()[0]!;
    const name = within(first).getAllByText(/^Club \d+$/)[0]!.textContent ?? "";
    const answered = list.find((one) => one.name === name)!;
    await user.selectOptions(within(first).getByLabelText(`Age for ${name}`), "10");
    // The page stores the answer, and the card is drawn again with it.
    rerender(
      card(
        new Map([
          [answered.teamId, { teamId: answered.teamId, level: 10, namedAt: NOW.toISOString() }],
        ])
      )
    );
    expect(rows()).toHaveLength(9);
  });

  it("says why each one could not be aged", () => {
    show([team("ID0", "Club 0", { evidence: evidence({ tally: [[9, 2]], namedAnAge: 2 }) })]);
    expect(
      screen.getByText(/2 of its opponents say 9U\. Two agreeing settle a team now/)
    ).toBeInTheDocument();
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

  /* The user's rule of 28 September 2026: a team without nine players is not on this list. */
  it("leaves a team with fewer than nine players off the list, and says why when it is found", async () => {
    const user = userEvent.setup();
    show([
      ...twelve(),
      team("ID-SHORT", "Riverdogs 10U", { evidence: evidence({ playerCount: 6 }) }),
    ]);
    expect(screen.getByText(/Showing 10 of 12/)).toBeInTheDocument();
    expect(screen.queryByText("Riverdogs 10U")).not.toBeInTheDocument();

    await user.type(screen.getByRole("searchbox", { name: /Find a team/ }), "Riverdogs");
    expect(screen.getByText("Riverdogs 10U")).toBeInTheDocument();
    expect(screen.getByText(/lists fewer than nine players on it/)).toBeInTheDocument();
  });

  /*
   * The owner's word of 18 October 2026: the ten are teams a person can answer. What used to be
   * sorted to the top, the names that say no team and the high school sides, is set aside, with
   * the rows nobody it plays ages and the empty schedules, and the card says how many went where.
   */
  it("shows only teams a person can answer, and says how many each rule set aside", () => {
    show([
      team("honest", "An Honest Club"),
      team("school", "Tigers High-school"),
      team("fake", "Test team", {
        evidence: evidence({ aheadOfToday: 4, shutoutBlowouts: 4, playerCount: 12 }),
      }),
      team("number", "Team 6"),
      team("unnamed1", "Alder Comets 1", { evidence: evidence({ namedAnAge: 0, tally: [] }) }),
      team("unnamed2", "Alder Comets 2", { evidence: evidence({ namedAnAge: 0, tally: [] }) }),
      team("empty", "Alder Comets 3", { evidence: evidence({ games: 0, scored: 0 }) }),
      team("short", "Alder Comets 4", { evidence: evidence({ playerCount: 5 }) }),
    ]);
    expect(rows()).toHaveLength(1);
    expect(within(rows()[0]!).getByText("An Honest Club")).toBeInTheDocument();
    expect(screen.getByText(/Showing 1 of 1\./)).toBeInTheDocument();
    expect(
      screen.getByText(
        "Set aside: 2 that play nobody who writes an age of 8U to 18U, 1 with no games yet, 1 with fewer " +
          "than nine players, 2 with a name that says it is no team, 1 high school side. Each " +
          "comes back here on its own once a later check finds that changed, and Find a team " +
          "still finds every one."
      )
    ).toBeInTheDocument();
    // The card says what the ten are, and none of the words the owner has ruled off the screen.
    expect(screen.getByText(/a person can\s+settle/)).toBeInTheDocument();
    // Too few of them, or ones that do not agree: the queue holds both, and the card says both.
    expect(screen.getByText(/are too few to file them by, or do not agree\./)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/closed|isolated|island/i);
  });

  it("finds a team it set aside, says why, and what the queue read it by", async () => {
    const user = userEvent.setup();
    show([
      ...twelve(),
      team("number", "Team 6"),
      team("fake", "Larkspire Nines", {
        evidence: evidence({ aheadOfToday: 4, shutoutBlowouts: 4, playerCount: 12 }),
      }),
      team("unnamed", "Fallowmere Reds", { evidence: evidence({ namedAnAge: 0, tally: [] }) }),
    ]);
    const box = screen.getByRole("searchbox", { name: /Find a team/ });
    await user.type(box, "Team 6");
    expect(screen.getByText(/the name says it is no team/)).toBeInTheDocument();
    expect(
      screen.getByText(
        "The name is only “Team”, with nothing more than a number, a letter or an age."
      )
    ).toBeInTheDocument();
    await user.clear(box);
    await user.type(box, "Larkspire");
    expect(screen.getByText(/its schedule reads as made up/)).toBeInTheDocument();
    expect(screen.getByText("You cannot score a game early.")).toBeInTheDocument();
    // An age can still be named for it: nothing refuses a page for being unlikely.
    expect(screen.getByRole("combobox", { name: /Age for Larkspire Nines/ })).toBeInTheDocument();
    await user.clear(box);
    await user.type(box, "Fallowmere");
    expect(
      screen.getByText(/nobody it plays writes an age of 8U to 18U in their name/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/Up (first|next)/)).toBeNull();
  });

  it("offers an age for a side set aside as probably a school's, and none where the import refuses it", async () => {
    const user = userEvent.setup();
    show([
      ...twelve(),
      team("plays", "Quillmoor Fall Ball", {
        evidence: evidence({
          namedAnAge: 0,
          tally: [],
          sampleOpponents: ["Lincoln HS Varsity", "Round Rock JV"],
        }),
      }),
      team("label", "Brindlewood Badgers", { evidence: evidence({ ageLabel: "high_varsity" }) }),
    ]);
    const box = screen.getByRole("searchbox", { name: /Find a team/ });
    await user.type(box, "Quillmoor");
    // An age named for it files and ranks it, so the note does not say it is left out of them.
    expect(
      screen.getByText(/It reads as a high school side, so it is kept off this queue\./)
    ).toBeInTheDocument();
    expect(screen.queryByText(/left out of the rankings/)).toBeNull();
    expect(screen.getByText("It plays varsity and JV sides.")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /Age for Quillmoor/ })).toBeInTheDocument();
    await user.clear(box);
    await user.type(box, "Brindlewood");
    expect(
      screen.getByText(
        /It reads as a high school squad, so it is left out of the rankings and off this queue\./
      )
    ).toBeInTheDocument();
    expect(screen.getByText("GameChanger files it as a school team.")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /Age for/ })).not.toBeInTheDocument();
  });

  /*
   * The import refuses a page by its name before it reads an age, and a named age does not vouch
   * for a club, so an age named for "Team 7" is thrown away at the next ask, the row with it.
   */
  it("offers no age for a page the import refuses by its name, and keeps the throw-out", async () => {
    const user = userEvent.setup();
    const { onThrowOut, onNameAge } = show([
      ...twelve(),
      team("seven", "Team 7"),
      team("practice", "Alder Comets Practice"),
      team("digits", "12345"),
    ]);
    const box = screen.getByRole("searchbox", { name: /Find a team/ });
    await user.type(box, "Team 7");
    expect(
      screen.getByText(
        "Kept off this queue: the name says it is no team, and its next check takes it off this " +
          "list unless the club has renamed it by then."
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /Age for Team 7/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Not a real team" }));
    expect(onThrowOut).toHaveBeenCalledWith("seven", "Team 7");
    await user.clear(box);
    await user.type(box, "Alder Comets Practice");
    expect(screen.queryByRole("combobox", { name: /Age for Alder Comets Practice/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Not a real team" })).toBeInTheDocument();
    // A name with no letters is set aside and still filed by the import: an age lands.
    await user.clear(box);
    await user.type(box, "12345");
    expect(
      screen.getByText(/If the club renames it, it comes back on its own/)
    ).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: /Age for 12345/ }), "10");
    expect(onNameAge).toHaveBeenCalledWith("digits", "12345", 10);
  });

  it("does not promise to file an age named for a page its name refuses", async () => {
    const user = userEvent.setup();
    show([...twelve(), team("seven", "Team 7")], {
      named: new Map([["seven", { teamId: "seven", level: 12, namedAt: NOW.toISOString() }]]),
    });
    await user.type(screen.getByRole("searchbox", { name: /Find a team/ }), "Team 7");
    expect(
      screen.getByText(
        "You named an age for it, but its name says it is no team, so the next refresh leaves it " +
          "out rather than filing it."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/It is filed on the next refresh/)).toBeNull();
    expect(screen.getByRole("button", { name: "Undo that" })).toBeInTheDocument();
  });

  it("does not promise to file an age named for a squad refused as a school's", async () => {
    const user = userEvent.setup();
    show([...twelve(), team("varsity", "Pimbleton HS Varsity")], {
      named: new Map([["varsity", { teamId: "varsity", level: 15, namedAt: NOW.toISOString() }]]),
    });
    await user.type(screen.getByRole("searchbox", { name: /Find a team/ }), "Pimbleton HS");
    expect(
      screen.getByText(
        "You named an age for it, but it reads as a high school squad, so the next refresh " +
          "leaves it out rather than filing it."
      )
    ).toBeInTheDocument();
  });

  it("does not offer the way back by an age for a page left alone that its name refuses", async () => {
    const user = userEvent.setup();
    show([
      ...twelve(),
      team("seven", "Team 7", { tries: 99, firstSeen: daysBefore(400), lastTried: daysBefore(30) }),
    ]);
    await user.type(screen.getByRole("searchbox", { name: /Find a team/ }), "Team 7");
    expect(
      screen.getByText(
        "Left alone: it had its asks and its weeks and nobody could ever age it, and its name " +
          "says it is no team, so no age named for it would be filed."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/puts it back in the queue/)).toBeNull();
    expect(screen.queryByRole("combobox", { name: /Age for Team 7/ })).toBeNull();
  });

  it("says under a school's name only what made it a school's", async () => {
    const user = userEvent.setup();
    show([
      ...twelve(),
      team("practice", "Pimbleton High School Practice"),
      team("ahead", "Quillfern HS", {
        evidence: evidence({ aheadOfToday: 4, shutoutBlowouts: 4, playerCount: 12 }),
      }),
    ]);
    const box = screen.getByRole("searchbox", { name: /Find a team/ });
    await user.type(box, "Pimbleton High");
    expect(
      screen.getByText(/It reads as a high school squad, so it is left out/)
    ).toBeInTheDocument();
    expect(screen.getByText("The name reads as a high school squad.")).toBeInTheDocument();
    expect(screen.queryByText(/test, practice or placeholder/)).toBeNull();
    await user.clear(box);
    await user.type(box, "Quillfern");
    expect(screen.getByText("The name reads as a high school squad.")).toBeInTheDocument();
    expect(screen.queryByText("You cannot score a game early.")).toBeNull();
  });

  it("says nothing was set aside when nothing was", () => {
    show(twelve());
    expect(screen.queryByText(/^Set aside:/)).toBeNull();
  });

  it("gives no place in the queue to a team a search finds off it", async () => {
    // A thrown-out "Test team" is on no queue, so "Up first" beside "You threw this one out" was
    // a place it does not have.
    const user = userEvent.setup();
    show(
      [
        ...twelve(),
        team("fake", "Test team", {
          evidence: evidence({ aheadOfToday: 4, shutoutBlowouts: 4, playerCount: 12 }),
        }),
      ],
      { dropped: forgetClubs(new Set(), ["fake"]) }
    );
    await user.type(screen.getByRole("searchbox", { name: /Find a team/ }), "Test team");
    expect(rows()).toHaveLength(1);
    expect(screen.getByText(/You threw this one out/)).toBeInTheDocument();
    expect(screen.queryByText(/Up (first|next)/)).toBeNull();
  });

  /*
   * The signal is an ordering and nothing more — an empty schedule is a club somebody made this
   * morning as often as it is a fiction — so the row must not be dressed as a verdict.
   */
  it("does not colour a row by how invented it looks", async () => {
    // Off the queue as made up, and found by search, which draws it as the queue would have.
    const user = userEvent.setup();
    show([
      team("fake", "Test team", {
        evidence: evidence({ aheadOfToday: 4, shutoutBlowouts: 4, playerCount: 12 }),
      }),
    ]);
    await user.type(screen.getByRole("searchbox", { name: /Find a team/ }), "Test team");
    expect(screen.getByText("Looks invented")).toBeInTheDocument();
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
    // Nobody it plays writes an age: set aside from the queue, and still the rule's to clear.
    team("REC1", "Fire Chiefs", {
      evidence: evidence({ ngb: ["little_league"], namedAnAge: 0, tally: [] }),
    }),
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
