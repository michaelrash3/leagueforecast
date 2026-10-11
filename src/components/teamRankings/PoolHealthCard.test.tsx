import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ageGroup,
  game,
  renderTeamRankings,
  seasonDate,
  team,
} from "../../test/teamRankingsHarness";
import type { ScoutGame, ScoutTeam } from "../../lib/teamRankings";
import {
  loadAutoRemoved,
  loadDeletedGames,
  loadDroppedClubs,
  loadRealClubs,
  loadScoutGames,
  saveRealClubs,
} from "../../lib/teamRankingsStorage";
import type { AutoRemoval } from "../../lib/autoRemoved";
import { beginPull, endPull } from "../../lib/pullSession";

const openSetup = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("tab", { name: "Setup" }));
};

const look = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: /check the pool/i }));
};

/**
 * One club's schedule names the opponent; the other posted the same game against a stand-in with
 * the mirrored score. That is the shape the settling pass exists for, and the shape a real pool
 * had eleven thousand of, unsettled.
 */
const withStandIn = () => {
  const teams: ScoutTeam[] = [
    team("S-HOME", "Home Club", { state: "KY" }),
    team("S-AWAY", "Away Club", { state: "KY" }),
    team("S-TBD", "TBD- 3:00 PM", { placeholder: true }),
  ];
  const games: ScoutGame[] = [
    game("named", "ag_10u_2027", "S-HOME", "S-AWAY", 6, 2, {
      date: seasonDate(2027),
      source: { kind: "gamechanger", teamId: "gcHOME", gameId: "n1" },
    }),
    game("slot", "ag_10u_2027", "S-AWAY", "S-TBD", 2, 6, {
      date: seasonDate(2027),
      source: { kind: "gamechanger", teamId: "gcAWAY", gameId: "s1" },
    }),
  ];
  return { ageGroups: [ageGroup(10, 2027)], teams, games };
};

describe("seeing what the pool is made of", () => {
  it("says nothing until it is asked", async () => {
    const user = userEvent.setup();
    renderTeamRankings(withStandIn());
    await openSetup(user);

    // Walking every game is not something opening Setup should pay for.
    expect(screen.getByRole("button", { name: /check the pool/i })).toBeInTheDocument();
    expect(screen.queryByText(/stand-ins/i)).toBeNull();
  });

  it("counts the clubs apart from the stand-ins", async () => {
    const user = userEvent.setup();
    renderTeamRankings(withStandIn());
    await openSetup(user);
    await look(user);

    expect(await screen.findByText(/results against a stand-in/i)).toBeInTheDocument();
    expect(screen.getByText("Stand-ins")).toBeInTheDocument();
  });

  it("says how many could be settled right now", async () => {
    const user = userEvent.setup();
    renderTeamRankings(withStandIn());
    await openSetup(user);
    await look(user);

    // The other side's schedule names the club and the scores mirror.
    expect(await screen.findByRole("button", { name: /settle 1 of them/i })).toBeInTheDocument();
  });

  it("settles them when asked, and says what it did", async () => {
    const user = userEvent.setup();
    renderTeamRankings(withStandIn());
    await openSetup(user);
    await look(user);
    await user.click(await screen.findByRole("button", { name: /settle 1 of them/i }));

    // Nothing left to settle, and the stand-in is gone from the roster.
    expect(await screen.findByText(/nothing is waiting/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /settle/i })).toBeNull();
  });

  it("is honest when nothing can be settled from what is here", async () => {
    const user = userEvent.setup();
    const alone = withStandIn();
    renderTeamRankings({
      ...alone,
      // Drop the other side's row, so nothing names the stand-in.
      games: alone.games.filter((g) => g.id === "slot"),
    });
    await openSetup(user);
    await look(user);

    expect(await screen.findByText(/nobody has pulled the other side/i)).toBeInTheDocument();
  });

  it("holds the settle while a pull is running, since both write the whole pool", async () => {
    const user = userEvent.setup();
    renderTeamRankings(withStandIn());
    await openSetup(user);
    await look(user);
    const settle = await screen.findByRole("button", { name: /settle 1 of them/i });
    let session: ReturnType<typeof beginPull> = null;
    act(() => {
      session = beginPull(new Date().toISOString());
    });
    const running = session;
    try {
      expect(running).not.toBeNull();
      expect(settle).toBeDisabled();
      expect(screen.getByText(/A pull is running, so this waits/)).toBeInTheDocument();
    } finally {
      // Ended whatever happened, so no test after this one finds a pull running.
      if (running) act(() => endPull(running));
    }
    expect(settle).toBeEnabled();
  });

  it("says whether the pool is in the shape the tidy left it", async () => {
    const user = userEvent.setup();
    renderTeamRankings(withStandIn());
    await openSetup(user);
    await look(user);

    // The harness stamps the pool as tidied, so this is the tidied branch; the other is covered in
    // the poolHealth tests, where the stamp can be set to something else.
    expect(await screen.findByText("Tidied")).toBeInTheDocument();
  });
});

describe("the clubs worth pulling next", () => {
  const stubDownload = () => {
    const created: Blob[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      created.push(blob as Blob);
      return "blob:stub";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    return created;
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A club named on a pulled schedule whose own schedule nobody has. */
  const withUnpulled = () => {
    const base = withStandIn();
    return {
      ...base,
      teams: [...base.teams, team("S-HEARD", "Heard Of Only", { nameOnly: true })],
      games: [
        ...base.games,
        game("heard", "ag_10u_2027", "S-HOME", "S-HEARD", 5, 1, { date: seasonDate(2027) }),
      ],
    };
  };

  it("says how many there are and why only pulling them helps", async () => {
    const user = userEvent.setup();
    renderTeamRankings(withUnpulled());
    await openSetup(user);
    await look(user);

    expect(await screen.findByText(/clubs worth pulling next/i)).toBeInTheDocument();
    expect(screen.getByText(/only pulling them can/i)).toBeInTheDocument();
  });

  it("names the ones holding up the most", async () => {
    const user = userEvent.setup();
    renderTeamRankings(withUnpulled());
    await openSetup(user);
    await look(user);

    expect(await screen.findByText("Heard Of Only")).toBeInTheDocument();
  });

  it("hands the list over as a file", async () => {
    const user = userEvent.setup();
    const created = stubDownload();
    renderTeamRankings(withUnpulled());
    await openSetup(user);
    await look(user);

    await user.click(await screen.findByRole("button", { name: /download the list/i }));
    expect(created).toHaveLength(1);
  });

  it("stays quiet when every club has been pulled", async () => {
    const user = userEvent.setup();
    renderTeamRankings(withStandIn());
    await openSetup(user);
    await look(user);

    // The stand-in in this pool is a TBD, which names nobody and cannot be looked up.
    expect(await screen.findByText("Tidied")).toBeInTheDocument();
    expect(screen.queryByText(/clubs worth pulling next/i)).toBeNull();
  });
});

describe("the stand-in fixtures, as a file", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("searches the stand-in rows and hands them over", async () => {
    const user = userEvent.setup();
    const created: Blob[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      created.push(blob as Blob);
      return "blob:stub";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    // Two pulled clubs and one start time, with a TBD where one schedule should name the other.
    const pulled = (id: string, name: string): ScoutTeam =>
      team(id, name, {
        state: "KY",
        gcTeams: [{ teamId: `gc${id}`, ageGroupId: "ag_10u_2027", name }],
      });
    const at = { date: seasonDate(2027), startTs: `${seasonDate(2027)}T22:00:00.000Z` };
    renderTeamRankings({
      ageGroups: [ageGroup(10, 2027)],
      teams: [
        pulled("S-HOME", "Home Club"),
        pulled("S-AWAY", "Away Club"),
        team("S-TBD", "TBD- 3:00 PM", { placeholder: true }),
      ],
      games: [
        game("named", "ag_10u_2027", "S-HOME", "S-AWAY", 6, 2, at),
        game("slot", "ag_10u_2027", "S-AWAY", "S-TBD", 2, 6, at),
      ],
    });
    await openSetup(user);
    await look(user);

    await user.click(
      await screen.findByRole("button", { name: /download the stand-in fixtures/i })
    );
    // Asynchronous, so the page can paint while it searches: the file arrives once it is done.
    await screen.findByRole("button", { name: /download the stand-in fixtures/i });
    expect(created).toHaveLength(1);
    const text = await created[0]!.text();
    expect(text).toContain("Kind,Game ID,");
    // The TBD row is the one stand-in row, and the Away Club's named game at the same instant is
    // the other half of it.
    expect(text).toContain("same-club,slot,");
  });
});

/**
 * Games scored on a day that has not happened, and the clubs whose schedules filed them.
 *
 * The list leads with the club doing the most damage, and every club and every game drawn links
 * to the schedule to open to see it: a person deciding whether a club is an invention should not
 * have to go and find it first.
 */
describe("the impossible games, worst club first", () => {
  const ahead = "2027-07-30";
  const filedAs = (gcId: string, id: string) => ({
    source: { kind: "gamechanger" as const, teamId: gcId, gameId: id },
  });
  const club = (id: string, name: string, gcId: string): ScoutTeam =>
    team(id, name, {
      state: "FL",
      gcTeams: [{ teamId: gcId, name, ageGroupId: "ag_10u_2027", ageLevel: 10 }],
    });
  const pool = (extraClubs = 0) => {
    const teams: ScoutTeam[] = [
      club("S-INV", "Invented Nine", "gcINVENT0001"),
      club("S-REAL", "Real Club", "gcREAL000001"),
      club("S-ODD", "Wrong Dates", "gcWRONG00001"),
      ...Array.from({ length: extraClubs }, (_, at) =>
        club(`S-X${at}`, `Extra ${at}`, `gcEXTRA${String(at).padStart(5, "0")}`)
      ),
    ];
    const games: ScoutGame[] = [
      // Stored first, so the order on screen has to come from somewhere other than storage.
      game("odd1", "ag_10u_2027", "S-ODD", "S-REAL", 5, 4, {
        date: ahead,
        ...filedAs("gcWRONG00001", "odd1"),
      }),
      // The inventor lists the real club three times; the real club filed none of them.
      ...[1, 2, 3].map((n) =>
        game(`inv${n}`, "ag_10u_2027", "S-INV", "S-REAL", 11, 0, {
          date: ahead,
          ...filedAs("gcINVENT0001", `inv${n}`),
        })
      ),
      game("fine", "ag_10u_2027", "S-REAL", "S-ODD", 3, 2, {
        date: seasonDate(2027),
        ...filedAs("gcREAL000001", "fine"),
      }),
      ...Array.from({ length: extraClubs }, (_, at) =>
        game(`x${at}`, "ag_10u_2027", `S-X${at}`, "S-REAL", 9, 1, {
          date: ahead,
          ...filedAs(`gcEXTRA${String(at).padStart(5, "0")}`, `x${at}`),
        })
      ),
    ];
    return { ageGroups: [ageGroup(10, 2027)], teams, games };
  };

  it("lists the club that filed the most first, and not the club they were filed against", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    await openSetup(user);

    const clubs = screen.getByRole("heading", { name: /Clubs that may not be real/ })
      .nextElementSibling?.nextElementSibling as HTMLElement;
    const names = [...clubs.querySelectorAll("li > span.font-bold")].map((one) => one.textContent);
    expect(names).toEqual(["Invented Nine", "Wrong Dates"]);
  });

  it("links every club and every game drawn to the schedule that filed it", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    await openSetup(user);

    const links = screen.getAllByRole("link", { name: /schedule/i });
    // The first game drawn is the worst club's, though another club's is stored first.
    expect(links[0]).toHaveAttribute("href", "https://web.gc.com/teams/gcINVENT0001");
    expect(
      screen.getAllByRole("link", { name: "schedule" }).map((one) => one.getAttribute("href"))
    ).toEqual(["https://web.gc.com/teams/gcINVENT0001", "https://web.gc.com/teams/gcWRONG00001"]);
    expect(screen.getAllByRole("link", { name: "Invented Nine’s schedule" })).toHaveLength(3);
    expect(screen.getAllByRole("link", { name: "Wrong Dates’s schedule" })).toHaveLength(1);
  });

  it("takes a club said to be real off the list, for good", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    await openSetup(user);

    const listed = () => {
      const clubs = screen.getByRole("heading", { name: /Clubs that may not be real/ })
        .nextElementSibling?.nextElementSibling as HTMLElement;
      return [...clubs.querySelectorAll("li > span.font-bold")].map((one) => one.textContent);
    };
    const row = screen.getByText("Invented Nine").closest("li") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "It’s real" }));
    expect(listed()).toEqual(["Wrong Dates"]);
    // Remembered by its GameChanger id, as a club thrown out is, so a pull does not put it back.
    expect([...loadRealClubs()]).toEqual(["gcINVENT0001"]);
    expect(screen.getByText(/1 club you said is real is kept off this list\./)).toBeInTheDocument();
  });

  it("reads the answers as stored when it looks, so one given in another tab is kept", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    await openSetup(user);
    expect(screen.queryByText(/kept off this list/)).toBeNull();
    // Said in another tab, while this one was open.
    saveRealClubs(new Set(["gcINVENT0001"]));
    await look(user);
    expect(
      await screen.findByText(/1 club you said is real is kept off this list\./)
    ).toBeInTheDocument();
  });

  /*
   * An answer given by mistake, on a club that is plainly made up, was otherwise for good: nothing
   * on the page took it back.
   */
  it("puts a club said to be real back on the list when the answer is taken back", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    await openSetup(user);

    const row = screen.getByText("Invented Nine").closest("li") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "It’s real" }));
    await user.click(screen.getByRole("button", { name: "Show them" }));
    const said = screen.getByRole("list", { name: "Clubs you said are real" });
    expect(said).toHaveTextContent("Invented Nine");
    await user.click(within(said).getByRole("button", { name: "Put it back" }));

    expect([...loadRealClubs()]).toEqual([]);
    const listed = screen.getByRole("heading", { name: /Clubs that may not be real/ })
      .nextElementSibling?.nextElementSibling as HTMLElement;
    expect(
      [...listed.querySelectorAll("li > span.font-bold")].map((one) => one.textContent)
    ).toEqual(["Invented Nine", "Wrong Dates"]);
    expect(screen.queryByText(/kept off this list/)).toBeNull();
  });

  it("shows every club when asked, past the first twelve", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool(12));
    await openSetup(user);

    // Ties go by name, so "Extra 9" is past the first twelve.
    expect(screen.queryByText("Extra 9")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Show all 14/ }));
    expect(screen.getByText("Extra 9")).toBeInTheDocument();
  });
});

describe("games won by more than thirty runs", () => {
  const filedAs = (id: string) => ({
    source: { kind: "gamechanger" as const, teamId: "gcBIG0000001", gameId: id },
  });
  const pool = () => ({
    ageGroups: [ageGroup(10, 2027)],
    teams: [
      team("S-BIG", "Big Scores", {
        state: "OH",
        gcTeams: [{ teamId: "gcBIG0000001", name: "Big Scores", ageGroupId: "ag_10u_2027" }],
      }),
      team("S-VIC", "Victims", { state: "OH" }),
      team("S-OTH", "Others", { state: "OH" }),
    ],
    games: [
      game("typo", "ag_10u_2027", "S-BIG", "S-VIC", 9999, 0, {
        date: seasonDate(2027),
        ...filedAs("typo"),
      }),
      game("rout", "ag_10u_2027", "S-BIG", "S-OTH", 31, 0, {
        date: seasonDate(2027),
        ...filedAs("rout"),
      }),
      // Thirty exactly is a result, however lopsided.
      game("line", "ag_10u_2027", "S-OTH", "S-VIC", 30, 0, { date: seasonDate(2027) }),
      game("close", "ag_10u_2027", "S-VIC", "S-OTH", 5, 4, { date: seasonDate(2027) }),
    ],
  });

  const section = () =>
    screen.getByRole("heading", { name: "Won by more than 30 runs" }).parentElement as HTMLElement;
  const rows = () => within(section()).getAllByRole("listitem");

  /** A club's record off the board, which reads only what counts. */
  const recordOf = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
    await user.click(screen.getByRole("tab", { name: "Rankings" }));
    const more = screen.queryByRole("button", { name: /show all \d+ teams/i });
    if (more) await user.click(more);
    const row = within(screen.getByRole("table")).getByRole("button", { name }).closest("tr");
    const cells = within(row as HTMLElement)
      .getAllByRole("cell")
      .map((cell) => cell.textContent?.trim());
    await openSetup(user);
    return cells[2];
  };

  it("lists them widest first, leaves thirty alone, and counts none of them", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    await openSetup(user);

    expect(rows()).toHaveLength(2);
    expect(rows()[0]).toHaveTextContent("Big Scores 9999–0 Victims");
    expect(rows()[1]).toHaveTextContent("Big Scores 31–0 Others");
    expect(section()).toHaveTextContent("9,999 at the most");
    // The Victims' 9,999-run loss is not a result: they are 1-1, the 30-0 loss and the 5-4 win.
    expect(await recordOf(user, "Victims")).toBe("1-1");
  });

  it("puts the club that posted them at the top of the clubs that may not be real", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    await openSetup(user);

    const clubs = screen.getByRole("heading", { name: /Clubs that may not be real/ })
      .nextElementSibling?.nextElementSibling as HTMLElement;
    const listed = [...clubs.querySelectorAll("li")];
    expect(listed.map((one) => one.querySelector("span.font-bold")?.textContent)).toEqual([
      "Big Scores",
    ]);
    expect(listed[0]).toHaveTextContent("2 wins by more than 30");
  });

  it("counts one said to be real, and takes it off the list", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    await openSetup(user);

    await user.click(within(rows()[1]!).getByRole("button", { name: "It’s real" }));
    expect(rows()).toHaveLength(1);
    // The margin vouched for, so a later score read differently is suspect again.
    expect(loadScoutGames().find((one) => one.id === "rout")?.scoreConfirmed).toBe(31);
    // The 31-0 counts now, and the 9,999-0 still does not.
    expect(await recordOf(user, "Big Scores")).toBe("1-0");
  });

  it("deletes one, and remembers it so the next pull does not file it again", async () => {
    const user = userEvent.setup();
    const { requestConfirmation } = renderTeamRankings(pool());
    await openSetup(user);

    await user.click(within(rows()[0]!).getByRole("button", { name: "Delete" }));
    expect(requestConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/more than 30 runs/) })
    );
    expect(rows()).toHaveLength(1);
    expect(loadScoutGames().some((one) => one.id === "typo")).toBe(false);
    expect([...loadDeletedGames()].some((id) => id.endsWith("typo"))).toBe(true);
  });
});

describe("the clubs removed for you", () => {
  /*
   * A club the nightly took off as plainly made up, beside a real one: on no other list, and
   * listed with why and when, to be put back or deleted for good, each with an Undo on its toast.
   */
  const demo = (gcTeamId: string): [string, AutoRemoval] => [
    gcTeamId,
    { gcTeamId, name: "Demo Club", on: "2026-10-11", signs: ["named"], word: "demo" },
  ];
  const pool = () => ({
    ageGroups: [ageGroup(10, 2027)],
    teams: [
      team("S-REAL", "Real Club", {
        gcTeams: [{ teamId: "gcREAL", name: "Real Club", ageGroupId: "ag_10u_2027", ageLevel: 10 }],
      }),
      team("S-DEMO", "Demo Club", {
        gcTeams: [{ teamId: "gcDEMO", name: "Demo Club", ageGroupId: "ag_10u_2027", ageLevel: 10 }],
      }),
    ],
    games: [
      // Scored on a day still to come, so the club would be on the list of those that may not be.
      game("ahead", "ag_10u_2027", "S-DEMO", "S-REAL", 9, 0, {
        date: "2099-05-01",
        source: { kind: "gamechanger", teamId: "gcDEMO", gameId: "d1" },
      }),
    ],
    autoRemoved: new Map([demo("gcDEMO")]),
  });

  it("lists a club taken off apart, and puts it back as real with an Undo", async () => {
    const user = userEvent.setup();
    const shown = renderTeamRankings(pool());
    await openSetup(user);
    const list = await screen.findByRole("list", { name: "Removed for you" });
    expect(within(list).getByText("Demo Club")).toBeInTheDocument();
    expect(within(list).getByText("2026-10-11: named 'demo'")).toBeInTheDocument();
    expect(screen.queryByText(/clubs that may not be real/i)).toBeNull();

    await user.click(within(list).getByRole("button", { name: "Put back" }));
    expect(loadAutoRemoved().size).toBe(0);
    expect([...loadRealClubs()]).toEqual(["gcDEMO"]);
    expect(screen.queryByRole("list", { name: "Removed for you" })).toBeNull();
    const [said, options] = shown.showToast.mock.calls[shown.showToast.mock.calls.length - 1] ?? [];
    expect(said).toBe("Demo Club is back on the boards, kept as real.");
    expect(options).toMatchObject({ tone: "undo", actionLabel: "Undo" });
    act(() => (options as { onAction: () => void }).onAction());
    expect([...loadAutoRemoved().keys()]).toEqual(["gcDEMO"]);
    expect([...loadRealClubs()]).toEqual([]);
    expect(await screen.findByRole("list", { name: "Removed for you" })).toBeInTheDocument();
  });

  it("deletes one for good as Delete club does, with an Undo", async () => {
    const user = userEvent.setup();
    const shown = renderTeamRankings(pool());
    await openSetup(user);
    const list = await screen.findByRole("list", { name: "Removed for you" });
    await user.click(within(list).getByRole("button", { name: "Delete for good" }));
    expect([...loadDroppedClubs()]).toEqual(["gcDEMO"]);
    expect(loadAutoRemoved().size).toBe(0);
    expect(loadScoutGames()).toEqual([]);
    const [said, options] = shown.showToast.mock.calls[shown.showToast.mock.calls.length - 1] ?? [];
    expect(said).toBe("Deleted Demo Club for good.");
    expect(options).toMatchObject({ tone: "undo", actionLabel: "Undo" });
    act(() => (options as { onAction: () => void }).onAction());
    expect([...loadAutoRemoved().keys()]).toEqual(["gcDEMO"]);
    expect([...loadDroppedClubs()]).toEqual([]);
    expect(loadScoutGames().map((one) => one.id)).toEqual(["ahead"]);
  });
});
