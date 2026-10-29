import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { GcGame, GcTeamResponse } from "../../lib/gameChangerApi";
import type { GcOrgTeamsFetch } from "../../lib/gcOrgClient";
import { EmptyState } from "./EmptyState";
import { StartFromGcOrg, type GcOrgStartDeps } from "./StartFromGcOrg";

/*
 * Starting a League Standings season from a GameChanger organization's own schedule, through the
 * app's GameChanger proxy (the owner's ask of 26 October 2026). Placeholder names throughout.
 */

const ORG_ID = "SgtwZI3tbazX";

/** The organization's list: two divisions this fall, one last spring. */
const LISTING = [
  { id: "AAAAAAAAAAA1", name: "Placeholder Aces", age_group: "9U", season: "Fall 2026" },
  { id: "BBBBBBBBBBB1", name: "Placeholder Bears", age_group: "9U", season: "Fall 2026" },
  { id: "CCCCCCCCCCC1", name: "Placeholder Cubs", age_group: "9U", season: "Fall 2026" },
  { id: "DDDDDDDDDDD1", name: "Placeholder Ducks", age_group: "10U", season: "Fall 2026" },
  { id: "EEEEEEEEEEE1", name: "Placeholder Elks", age_group: "9U", season: "Spring 2026" },
];

let serial = 0;
const game = (
  opponentName: string,
  date: string,
  homeAway: "home" | "away",
  runs?: [number, number]
): GcGame => ({
  id: `e${(serial += 1)}`,
  opponentName,
  date,
  startTs: `${date}T18:00:00Z`,
  homeAway,
  ...(runs ? { teamScore: runs[0], opponentScore: runs[1] } : {}),
  status: runs ? "completed" : "scheduled",
});

const SCHEDULES: Record<string, GcGame[]> = {
  AAAAAAAAAAA1: [
    game("Placeholder Bears", "2026-09-12", "home", [5, 3]),
    game("Placeholder Cubs", "2026-09-19", "away"),
  ],
  BBBBBBBBBBB1: [game("Placeholder Aces", "2026-09-12", "away", [3, 5])],
  CCCCCCCCCCC1: [game("Placeholder Aces", "2026-09-19", "home")],
};

const teamOf = (id: string): GcTeamResponse => ({
  ok: true,
  schedule: {
    profile: { id, name: LISTING.find((one) => one.id === id)?.name ?? id, ageLevel: 9 },
    games: SCHEDULES[id] ?? [],
    fetchedAt: "2026-10-26T12:00:00Z",
  },
});

const deps = (
  listing: GcOrgTeamsFetch = { ok: true, raw: JSON.stringify(LISTING) },
  pull: (id: string) => GcTeamResponse | undefined = teamOf
) => {
  const asked = { orgs: [] as string[], pulls: [] as string[][] };
  const given: GcOrgStartDeps = {
    findTeams: (orgId) => {
      asked.orgs.push(orgId);
      return Promise.resolve(listing);
    },
    pullTeams: (ids) => {
      asked.pulls.push([...ids]);
      return Promise.resolve(
        new Map(
          ids.flatMap((id) => {
            const result = pull(id);
            return result ? [[id, result] as const] : [];
          })
        )
      );
    },
    clubLinks: () => Promise.resolve(new Map([["AAAAAAAAAAA1", "S-ACES"]])),
  };
  return { given, asked };
};

const open = (given: GcOrgStartDeps) => {
  const onCreate = vi.fn();
  render(
    <StartFromGcOrg
      live={false}
      innings={6}
      onCreate={onCreate}
      onClose={() => undefined}
      deps={given}
    />
  );
  return onCreate;
};

const findTeams = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
  await user.type(screen.getByLabelText(/GameChanger organization ID or link/), text);
  await user.click(screen.getByRole("button", { name: "Find its teams" }));
};

describe("a season from a GameChanger organization", () => {
  it("lists the organization's divisions, newest first, with its teams picked", async () => {
    const user = userEvent.setup();
    const { given, asked } = deps();
    open(given);
    await findTeams(user, `https://web.gc.com/organizations/${ORG_ID}/schedule`);

    expect(asked.orgs).toEqual([ORG_ID]);
    const divisions = await screen.findByRole("group", {
      name: "Which season and age is the league",
    });
    expect(
      within(divisions)
        .getAllByRole("radio")
        .map((radio) => radio.closest("label")?.textContent)
    ).toEqual(["Fall 2026 · 9U3 teams", "Fall 2026 · 10U1 team", "Spring 2026 · 9U1 team"]);
    expect(within(divisions).getAllByRole("radio")[0]).toBeChecked();
    const teams = screen.getByRole("group", { name: /The league's teams/ });
    expect(
      within(teams)
        .getAllByRole("checkbox")
        .map((box) => (box as HTMLInputElement).checked)
    ).toEqual([true, true, true]);
  });

  it("pulls their schedules, drafts the games between them, and makes the season", async () => {
    const user = userEvent.setup();
    const { given, asked } = deps();
    const onCreate = open(given);
    await findTeams(user, ORG_ID);
    await user.click(await screen.findByRole("button", { name: "Pull their schedules" }));

    expect(asked.pulls).toEqual([["AAAAAAAAAAA1", "BBBBBBBBBBB1", "CCCCCCCCCCC1"]]);
    expect(await screen.findByText(/^2 games between these teams/)).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getByText("Placeholder Bears at Placeholder Aces")).toBeInTheDocument();
    expect(within(table).getByText("3–5")).toBeInTheDocument();
    expect(within(table).getByText("Placeholder Aces at Placeholder Cubs")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Start the season: 3 teams, 2 games" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    const [season, page] = onCreate.mock.calls[0] ?? [];
    expect(page).toEqual({ id: "", name: "9U 2027", ageLevel: 9, year: 2027 });
    expect(season.teams).toEqual([
      expect.objectContaining({ name: "Placeholder Aces", scoutTeamId: "S-ACES" }),
      { id: expect.any(String), name: "Placeholder Bears" },
      { id: expect.any(String), name: "Placeholder Cubs" },
    ]);
    expect(season.matchups).toHaveLength(2);
    expect(
      Object.values(season.logs).filter((log) => (log as { isFinal: boolean }).isFinal)
    ).toHaveLength(1);
  });

  it("asks only for the teams it has not pulled already", async () => {
    const user = userEvent.setup();
    const { given, asked } = deps();
    open(given);
    await findTeams(user, ORG_ID);
    await user.click(await screen.findByRole("button", { name: "Pull their schedules" }));
    await screen.findByText(/^2 games between these teams/);

    const teams = screen.getByRole("group", { name: /The league's teams/ });
    await user.click(within(teams).getByRole("checkbox", { name: /Placeholder Cubs/ }));
    expect(screen.queryByRole("table")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Pull their schedules" }));
    expect(await screen.findByText(/^1 game between these teams/)).toBeInTheDocument();
    expect(asked.pulls).toHaveLength(1);
  });

  it("draws no review for teams changed while their schedules were being pulled", async () => {
    // Codex on #460: a pull that ends after the picking changed drew the old picking's games.
    const user = userEvent.setup();
    const { given, asked } = deps();
    let finish = () => undefined as void;
    const pullTeams = given.pullTeams;
    given.pullTeams = (ids) =>
      new Promise((resolve) => {
        finish = () => void pullTeams(ids).then(resolve);
      });
    open(given);
    await findTeams(user, ORG_ID);
    await user.click(await screen.findByRole("button", { name: "Pull their schedules" }));
    const teams = screen.getByRole("group", { name: /The league's teams/ });
    await user.click(within(teams).getByRole("checkbox", { name: /Placeholder Cubs/ }));
    finish();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Pull their schedules" })).toBeEnabled()
    );
    expect(screen.queryByRole("table")).toBeNull();
    // What came back is kept: the new picking's review needs nothing more of GameChanger.
    await user.click(screen.getByRole("button", { name: "Pull their schedules" }));
    expect(await screen.findByText(/^1 game between these teams/)).toBeInTheDocument();
    expect(asked.pulls).toHaveLength(1);
  });

  it("drafts a division from its own teams' schedules, not every division pulled", async () => {
    // Codex on #460: the same names in another season's division made this one's opponents unknown.
    const user = userEvent.setup();
    const both = [
      { id: "FALLACES0001", name: "Placeholder Aces", age_group: "9U", season: "Fall 2026" },
      { id: "FALLBEARS001", name: "Placeholder Bears", age_group: "9U", season: "Fall 2026" },
      { id: "SPRGACES0001", name: "Placeholder Aces", age_group: "9U", season: "Spring 2026" },
      { id: "SPRGBEARS001", name: "Placeholder Bears", age_group: "9U", season: "Spring 2026" },
    ];
    const games: Record<string, GcGame[]> = {
      FALLACES0001: [game("Placeholder Bears", "2026-09-12", "home", [5, 3])],
      FALLBEARS001: [game("Placeholder Aces", "2026-09-12", "away", [3, 5])],
      SPRGACES0001: [game("Placeholder Bears", "2026-04-12", "home", [1, 2])],
      SPRGBEARS001: [game("Placeholder Aces", "2026-04-12", "away", [2, 1])],
    };
    const { given, asked } = deps({ ok: true, raw: JSON.stringify(both) }, (id) => ({
      ok: true,
      schedule: {
        profile: { id, name: both.find((one) => one.id === id)?.name ?? id, ageLevel: 9 },
        games: games[id] ?? [],
        fetchedAt: "2026-10-26T12:00:00Z",
      },
    }));
    open(given);
    await findTeams(user, ORG_ID);
    const pull = () => user.click(screen.getByRole("button", { name: "Pull their schedules" }));
    await pull();
    expect(await screen.findByText(/^1 game between these teams/)).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /Spring 2026/ }));
    await pull();
    expect(await screen.findByText(/^1 game between these teams/)).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /Fall 2026/ }));
    await pull();

    expect(await screen.findByText(/^1 game between these teams/)).toBeInTheDocument();
    expect(asked.pulls).toHaveLength(2);
  });

  it("leaves out a team GameChanger would not give, and says why", async () => {
    const user = userEvent.setup();
    const { given } = deps(undefined, (id) =>
      id === "CCCCCCCCCCC1"
        ? {
            ok: false,
            reason: "not-found",
            message: "GameChanger has no public profile for this team id.",
          }
        : teamOf(id)
    );
    open(given);
    await findTeams(user, ORG_ID);
    await user.click(await screen.findByRole("button", { name: "Pull their schedules" }));

    expect(
      await screen.findByText("1 team could not be pulled, and is left out.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Placeholder Cubs: GameChanger has no public profile for this team id.")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Start the season: 2 teams, 1 game" })
    ).toBeInTheDocument();
  });

  it("says what a pull asks of GameChanger, and holds back more teams than a league has", async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 65 }, (_, at) => ({
      id: `T${String(at).padStart(11, "0")}`,
      name: `Placeholder ${at}`,
    }));
    const { given, asked } = deps({ ok: true, raw: JSON.stringify(many) });
    open(given);
    await findTeams(user, ORG_ID);

    // No season or age given: every team the organization has had is one group, and none is ticked.
    const teams = await screen.findByRole("group", { name: /The league's teams \(0 picked\)/ });
    expect(screen.getByRole("button", { name: "Pull their schedules" })).toBeDisabled();
    for (const at of [0, 1, 2]) {
      await user.click(within(teams).getByRole("checkbox", { name: `Placeholder ${at}` }));
    }
    expect(
      screen.getByText("1 request to GameChanger through this app's proxy.")
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Untick all" }));
    expect(screen.getByRole("group", { name: /\(0 picked\)/ })).toBeInTheDocument();
    expect(asked.pulls).toEqual([]);
  });

  it("says when GameChanger has no such organization, or answers in a shape it cannot read", async () => {
    const user = userEvent.setup();
    const missing = deps({
      ok: false,
      reason: "not-found",
      message: "GameChanger has no public organization for this id.",
    });
    open(missing.given);
    await findTeams(user, ORG_ID);
    expect(
      await screen.findByText("GameChanger lists no public organization with that ID.")
    ).toBeInTheDocument();
  });

  it("names what came back when it holds no list of teams", async () => {
    const user = userEvent.setup();
    open(deps({ ok: true, raw: JSON.stringify({ organization: {} }) }).given);
    await findTeams(user, ORG_ID);
    expect(
      await screen.findByText("GameChanger answered in a shape this app cannot read yet.")
    ).toBeInTheDocument();
    expect(screen.getByText(/It held: organization\./)).toBeInTheDocument();
  });

  it("is offered on the empty season's screen", async () => {
    const user = userEvent.setup();
    render(
      <EmptyState
        importCSV={() => undefined}
        saveTeamList={() => undefined}
        downloadRoundRobinCSV={() => undefined}
        seasonBuilderText=""
        setSeasonBuilderText={() => undefined}
        teams={[]}
        loadDemoSeason={() => undefined}
        openTour={() => undefined}
        startFromGcOrg={(close) => (
          <button type="button" onClick={close}>
            The organization start
          </button>
        )}
      />
    );
    await user.click(screen.getByRole("button", { name: "From an organization" }));
    await user.click(screen.getByRole("button", { name: "The organization start" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "The organization start" })).toBeNull()
    );
  });
});
