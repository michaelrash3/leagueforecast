import { screen } from "@testing-library/react";
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

    const clubs = screen.getByRole("heading", { name: /The clubs they belong to/ })
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
