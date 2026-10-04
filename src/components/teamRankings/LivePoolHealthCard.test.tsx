import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditSaid, LiveEdits } from "../../hooks/useLiveEdits";
import { apartKey } from "../../lib/keptApart";
import { MAX_COMMAND_STEPS, type PoolCommand } from "../../lib/live/commands";
import type { AnswerOf, PoolQuery, QueryKind, QueryOf } from "../../lib/live/queries";
import { LivePoolHealthCard } from "./LivePoolHealthCard";

/*
 * Pool health on the live page (`LivePoolHealthCard`): drawn from what the server's pool shows,
 * each button sent as the edit the device's own card makes, and the pool asked again once an edit
 * has changed it. The edit function here is a stand-in that records what it was asked and sent.
 * Placeholder names throughout.
 */

const TODAY = "2027-04-15";

const game = (id: string, teamAId: string, teamBId: string, score: [number, number]) => ({
  id,
  date: "2027-05-01",
  teamAId,
  teamBId,
  teamAScore: score[0],
  teamBScore: score[1],
  year: 2027,
  filers: [teamAId],
});

const OPENED: AnswerOf<"health.summary"> = {
  kind: "health.summary",
  summary: {
    holdings: [{ year: 2027, pages: 2, teams: 4, games: 12, emptied: false }],
    datedAhead: [game("g-ahead-1", "S-1", "S-2", [3, 2]), game("g-ahead-2", "S-1", "S-3", [5, 4])],
    implausible: [
      { game: { ...game("g-rout", "S-4", "S-2", [40, 0]), date: "2027-03-01" }, margin: 40 },
    ],
    suspected: [
      {
        teamId: "S-1",
        name: "Placeholder S-1",
        ahead: 2,
        implausible: 0,
        played: 2,
        gcTeamIds: ["gc-1"],
        gameIds: ["g-ahead-1", "g-ahead-2"],
      },
    ],
    clubs: {
      "S-1": { name: "Placeholder S-1", gcId: "gc-1" },
      "S-2": { name: "Placeholder S-2" },
      "S-3": { name: "Placeholder S-3" },
      "S-4": { name: "Placeholder S-4", gcId: "gc-4" },
    },
  },
  answers: { ageRight: [], realClubs: [], keptApart: [] },
};

const LOOKED: AnswerOf<"health.inspect"> = {
  kind: "health.inspect",
  health: {
    games: 12,
    played: 10,
    teams: 6,
    clubs: 4,
    nameOnly: 2,
    placeholders: 1,
    standInGames: 3,
    standInPlayed: 3,
    undated: 0,
    futureDated: 2,
    tidied: false,
  },
  settleable: 3,
  lists: {
    toPull: [1, 2, 3, 4, 5].map((at) => ({
      teamId: `N-${at}`,
      name: `Placeholder N-${at}`,
      games: 2,
      played: 2,
      states: ["OH"],
      levels: [12],
      years: [2027],
      namedBy: ["Placeholder S-2"],
    })),
    duplicates: [
      {
        fromTeamId: "D-1",
        fromTeamName: "Placeholder Ambush",
        fromSeason: "Fall 2026",
        toTeamId: "D-2",
        toTeamName: "Placeholder Ambush",
        toSeason: "Fall 2026",
        fromGcId: "gc-d1",
        toGcId: "gc-d2",
        evidence: ["staff", "no-schedule"],
        sameName: true,
        confidence: "strong",
        kind: "same-season",
      },
    ],
    twins: [
      {
        fromTeamId: "T-1",
        fromTeamName: "Placeholder Cubs",
        toTeamId: "T-2",
        toTeamName: "Placeholder Green",
        fromGcId: "gc-t1",
        toGcId: "gc-t2",
        shared: [
          {
            date: "2027-03-02",
            startTs: "2027-03-02T14:00:00.000Z",
            opponentName: "Placeholder S-2",
            ownScore: 4,
            opponentScore: 7,
          },
        ],
      },
    ],
    twice: [],
    wrongAge: [
      {
        teamId: "W-1",
        name: "Placeholder Larks",
        year: 2027,
        gcTeamIds: ["gc-w1"],
        filed: 9,
        suggested: 10,
        reason: "name",
        opponentsAtSuggested: 2,
        opponentsKnown: 2,
        weeks: 1,
      },
      {
        teamId: "W-2",
        name: "Placeholder Wrens",
        year: 2027,
        gcTeamIds: ["gc-w2"],
        filed: 11,
        suggested: 10,
        reason: "opponents",
        opponentsAtSuggested: 4,
        opponentsKnown: 4,
        weeks: 3,
      },
    ],
  },
  toPullCount: 51_298,
};

type Answers = { [K in QueryKind]?: AnswerOf<K> | null };

/**
 * The edit function as the card reaches it: what it was asked, sent and made to say. The answers
 * it keeps are in what the pool shows when next asked, as the server's are.
 */
const editFunction = (
  answers: Answers,
  {
    locked = null,
    makes = true,
    later,
    plans,
  }: {
    locked?: string | null;
    makes?: boolean;
    /** What every summary after the first waits on. */
    later?: Promise<void>;
    /** The server's plans in the order it makes them, in place of the one in `answers`. */
    plans?: AnswerOf<"ages.plan">[];
  } = {}
) => {
  const asked: PoolQuery[] = [];
  const sent: Array<{ command: PoolCommand; said: EditSaid }> = [];
  // How many questions had been asked as each edit was sent.
  const askedBySend: number[] = [];
  const told: string[] = [];
  const kept = {
    ageRight: new Set<string>(),
    realClubs: new Set<string>(),
    keptApart: new Set<string>(),
  };
  const edits: LiveEdits = {
    locked,
    pending: [],
    edit: async (command, said) => {
      sent.push({ command, said });
      askedBySend.push(asked.length);
      if (makes && command.kind === "answers" && command.list in kept) {
        const list = kept[command.list as keyof typeof kept];
        command.add.forEach((id) => list.add(id));
        command.remove.forEach((id) => list.delete(id));
      }
      return makes;
    },
    ask: async <K extends QueryKind>(query: QueryOf<K>) => {
      asked.push(query);
      if (plans && query.kind === "ages.plan") return (plans.shift() ?? null) as AnswerOf<K> | null;
      const answer = answers[query.kind];
      if (answer?.kind === "health.summary") {
        if (later && asked.filter((one) => one.kind === "health.summary").length > 1) await later;
        return {
          ...structuredClone(answer),
          answers: {
            ageRight: [...kept.ageRight],
            realClubs: [...kept.realClubs],
            keptApart: [...kept.keptApart],
          },
        } as AnswerOf<K>;
      }
      // Each answer read afresh, as one off the wire is.
      return (answer ? structuredClone(answer) : null) as AnswerOf<K> | null;
    },
    warm: () => undefined,
    say: (message) => {
      told.push(message);
    },
  };
  return { edits, asked, sent, askedBySend, told };
};

const confirmed: string[] = [];
let confirming = true;
const confirm = async ({ title }: { title: string }) => {
  confirmed.push(title);
  return confirming;
};

const show = (call: ReturnType<typeof editFunction>, onOpenTeam?: (teamId: string) => void) =>
  render(
    <LivePoolHealthCard
      edits={call.edits}
      confirm={confirm}
      today={TODAY}
      {...(onOpenTeam ? { onOpenTeam } : {})}
    />
  );

const kinds = (asked: PoolQuery[]) => asked.map((query) => query.kind);

afterEach(() => {
  confirmed.length = 0;
  confirming = true;
  vi.restoreAllMocks();
});

describe("Pool health from the server's pool", () => {
  it("draws what the pool shows as it opens, asked on the device's day", async () => {
    const call = editFunction({ "health.summary": OPENED });
    show(call);
    expect(await screen.findByText("Scored on a day that has not happened")).toBeTruthy();
    expect(call.asked).toEqual([{ kind: "health.summary", today: TODAY }]);
    // Each row by the names the answer gives its clubs, with the schedule that filed it.
    expect(screen.getByText(/Placeholder S-1 3–2 Placeholder S-2/)).toBeTruthy();
    expect(screen.getByText(/Placeholder S-4 40–0 Placeholder S-2/)).toBeTruthy();
    expect(screen.getByText("Clubs that may not be real")).toBeTruthy();
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === "LI" && element.textContent === "2027 — 2 pages, 4 teams, 12 games"
      )
    ).toBeTruthy();
  });

  it("asks nothing while edits are off, and says why", async () => {
    const call = editFunction({ "health.summary": OPENED }, { locked: "Placeholder: offline." });
    show(call);
    expect(await screen.findByText("Placeholder: offline.")).toBeTruthy();
    expect(call.asked).toEqual([]);
  });

  it("says when what the pool shows could not be read, and asks again when told to", async () => {
    const answers: Answers = { "health.summary": null };
    const call = editFunction(answers);
    show(call);
    expect(await screen.findByText(/could not be read from the cloud/)).toBeTruthy();
    answers["health.summary"] = OPENED;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Scored on a day that has not happened")).toBeTruthy();
    expect(kinds(call.asked)).toEqual(["health.summary", "health.summary"]);
  });

  it("looks harder when asked, counting every club worth pulling though it is sent five", async () => {
    const call = editFunction({ "health.summary": OPENED, "health.inspect": LOOKED });
    show(call);
    fireEvent.click(await screen.findByRole("button", { name: "Check the pool" }));
    expect(await screen.findByText("Results against a stand-in")).toBeTruthy();
    expect(call.asked[1]).toEqual({ kind: "health.inspect", today: TODAY });
    expect(screen.getByText("51,298")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download the list (51,298)" })).toBeTruthy();
    expect(screen.getByText("Placeholder N-5")).toBeTruthy();
    // Nothing settles here: the nightly refresh tidies.
    expect(screen.getByText(/The nightly refresh settles them/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Settle/ })).toBeNull();
  });

  it("downloads every club worth pulling from the server's own file", async () => {
    const created: Blob[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      created.push(blob as Blob);
      return "blob:stub";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const call = editFunction({
      "health.summary": OPENED,
      "health.inspect": LOOKED,
      "health.toPull": { kind: "health.toPull", csv: "Club,Results\nPlaceholder N-1,2" },
    });
    show(call);
    fireEvent.click(await screen.findByRole("button", { name: "Check the pool" }));
    fireEvent.click(await screen.findByRole("button", { name: "Download the list (51,298)" }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(call.asked[2]).toEqual({ kind: "health.toPull" });
    expect(await created[0]!.text()).toContain("Placeholder N-1,2");
  });
});

describe("Pool health's buttons, sent as edits", () => {
  it("deletes the rows dated ahead once asked, then asks what the pool shows again", async () => {
    const call = editFunction({ "health.summary": OPENED });
    show(call);
    confirming = false;
    fireEvent.click(await screen.findByRole("button", { name: "Delete 2 games" }));
    await waitFor(() => expect(confirmed).toEqual(["Delete 2 games?"]));
    expect(call.sent).toEqual([]);
    confirming = true;
    fireEvent.click(screen.getByRole("button", { name: "Delete 2 games" }));
    await waitFor(() => expect(call.sent).toHaveLength(1));
    expect(call.sent[0]).toEqual({
      command: { kind: "games.drop", gameIds: ["g-ahead-1", "g-ahead-2"] },
      said: { done: "Deleted 2 games dated ahead.", undo: false },
    });
    await waitFor(() => expect(kinds(call.asked)).toEqual(["health.summary", "health.summary"]));
  });

  it("counts a rout vouched for, in the squad year it is stored under", async () => {
    const call = editFunction({ "health.summary": OPENED });
    show(call);
    const row = (await screen.findByText(/Placeholder S-4 40–0/)).closest("li");
    if (!row) throw new Error("no row");
    fireEvent.click(within(row).getByRole("button", { name: "It’s real" }));
    await waitFor(() => expect(call.sent).toHaveLength(1));
    expect(call.sent[0]).toEqual({
      command: { kind: "game.confirm", year: 2027, gameId: "g-rout" },
      said: { done: "Placeholder S-4 40–0 Placeholder S-2 counts now.", undo: false },
    });
  });

  it("deletes a club at once, as the device's card does", async () => {
    const call = editFunction({ "health.summary": OPENED });
    show(call);
    fireEvent.click(await screen.findByRole("button", { name: "Delete club" }));
    await waitFor(() => expect(call.sent).toHaveLength(1));
    expect(confirmed).toEqual([]);
    expect(call.sent[0]?.command).toEqual({ kind: "club.drop", teamId: "S-1" });
  });

  it("keeps a club off the list as real once the server has kept the answer, and puts it back", async () => {
    const call = editFunction({ "health.summary": OPENED });
    show(call);
    const club = (await screen.findByText("Placeholder S-1", { selector: "span" })).closest("li");
    if (!club) throw new Error("no club");
    fireEvent.click(within(club).getByRole("button", { name: "It’s real" }));
    expect(await screen.findByText(/1 club you said is real is kept off this list/)).toBeTruthy();
    expect(call.sent[0]?.command).toEqual({
      kind: "answers",
      list: "realClubs",
      add: ["gc-1"],
      remove: [],
    });
    // And what the pool shows is asked for again, with the answer in it.
    await waitFor(() => expect(kinds(call.asked)).toEqual(["health.summary", "health.summary"]));
    fireEvent.click(screen.getByRole("button", { name: "Show them" }));
    fireEvent.click(await screen.findByRole("button", { name: "Put it back" }));
    await waitFor(() => expect(call.sent).toHaveLength(2));
    expect(call.sent[1]?.command).toEqual({
      kind: "answers",
      list: "realClubs",
      add: [],
      remove: ["S-1", "gc-1"],
    });
  });

  it("shows an answer kept at once, before what the pool shows comes back", async () => {
    const call = editFunction(
      { "health.summary": OPENED },
      { later: new Promise(() => undefined) }
    );
    show(call);
    const club = (await screen.findByText("Placeholder S-1", { selector: "span" })).closest("li");
    if (!club) throw new Error("no club");
    fireEvent.click(within(club).getByRole("button", { name: "It’s real" }));
    expect(await screen.findByText(/1 club you said is real is kept off this list/)).toBeTruthy();
    expect(kinds(call.asked)).toEqual(["health.summary", "health.summary"]);
  });

  it("shows nothing as answered that the server did not keep", async () => {
    const call = editFunction({ "health.summary": OPENED }, { makes: false });
    show(call);
    const club = (await screen.findByText("Placeholder S-1", { selector: "span" })).closest("li");
    if (!club) throw new Error("no club");
    fireEvent.click(within(club).getByRole("button", { name: "It’s real" }));
    await waitFor(() => expect(call.sent).toHaveLength(1));
    await act(() => Promise.resolve());
    expect(screen.queryByText(/you said is real/)).toBeNull();
    expect(kinds(call.asked)).toEqual(["health.summary"]);
  });

  it("folds one of two twins into the one kept, once the fold's counts are confirmed", async () => {
    const call = editFunction({
      "health.summary": OPENED,
      "health.inspect": LOOKED,
      "merge.preview": { kind: "merge.preview", found: true, games: 6, dropped: 0 },
    });
    show(call);
    fireEvent.click(await screen.findByRole("button", { name: "Check the pool" }));
    fireEvent.click(await screen.findByRole("button", { name: "Keep Placeholder Green" }));
    await waitFor(() => expect(call.sent).toHaveLength(1));
    expect(call.asked[2]).toEqual({
      kind: "merge.preview",
      fromId: "T-1",
      intoId: "T-2",
      adopt: [],
    });
    expect(confirmed).toEqual(["Fold Placeholder Cubs into Placeholder Green?"]);
    expect(call.sent[0]?.command).toEqual({
      kind: "teams.merge",
      fromId: "T-1",
      intoId: "T-2",
      adopt: [],
    });
    // The pair is gone from the list: one of the two is.
    await waitFor(() => expect(screen.queryByText("One squad on GameChanger twice")).toBeNull());
  });

  it("folds nothing when the server no longer holds the two", async () => {
    const call = editFunction({
      "health.summary": OPENED,
      "health.inspect": LOOKED,
      "merge.preview": { kind: "merge.preview", found: false, games: 0, dropped: 0 },
    });
    show(call);
    fireEvent.click(await screen.findByRole("button", { name: "Check the pool" }));
    fireEvent.click(await screen.findByRole("button", { name: "Fold in" }));
    await waitFor(() => expect(call.told).toHaveLength(1));
    expect(call.told[0]).toMatch(/no longer in the cloud copy/);
    expect(call.sent).toEqual([]);
    expect(confirmed).toEqual([]);
  });

  it("keeps a pair apart for good, and stops offering it", async () => {
    const call = editFunction({ "health.summary": OPENED, "health.inspect": LOOKED });
    show(call);
    fireEvent.click(await screen.findByRole("button", { name: "Check the pool" }));
    const listed = (await screen.findByText("One club, listed twice")).closest("div");
    if (!listed) throw new Error("no list");
    fireEvent.click(within(listed).getByRole("button", { name: "Not the same" }));
    await waitFor(() => expect(screen.queryByText("One club, listed twice")).toBeNull());
    expect(call.sent[0]?.command).toEqual({
      kind: "answers",
      list: "keptApart",
      add: [apartKey("gc-d1", "gc-d2")],
      remove: [],
    });
  });

  it("files a club at the age its evidence points to, with an undo, and takes it off the list", async () => {
    const call = editFunction({ "health.summary": OPENED, "health.inspect": LOOKED });
    show(call);
    fireEvent.click(await screen.findByRole("button", { name: "Check the pool" }));
    const larks = (await screen.findByText("Placeholder Larks")).closest("li");
    if (!larks) throw new Error("no club");
    fireEvent.click(within(larks).getByRole("button", { name: "Set 10U" }));
    await waitFor(() => expect(screen.queryByText("Placeholder Larks")).toBeNull());
    expect(call.sent[0]).toEqual({
      command: {
        kind: "club.age",
        year: 2027,
        teamId: "W-1",
        level: 10,
        at: expect.any(String),
        pageId: expect.any(String),
      },
      said: { done: "Placeholder Larks is 10U now.", undo: true, afterUndo: expect.any(Function) },
    });
  });

  it("approves every suggested age as one edit the server planned, once asked", async () => {
    const planned: PoolCommand[] = [
      {
        kind: "club.age",
        year: 2027,
        teamId: "W-1",
        level: 10,
        at: "2027-04-15T12:00:00.000Z",
        pageId: "ag_plan-0",
      },
    ];
    const call = editFunction({
      "health.summary": OPENED,
      "health.inspect": LOOKED,
      "ages.plan": {
        kind: "ages.plan",
        commands: planned,
        changedTeamIds: ["W-1"],
        moved: 3,
        failed: 1,
      },
    });
    show(call);
    fireEvent.click(await screen.findByRole("button", { name: "Check the pool" }));
    fireEvent.click(await screen.findByRole("button", { name: "Approve all changes" }));
    await waitFor(() => expect(call.sent).toHaveLength(1));
    expect(confirmed).toEqual(["Approve age changes for 2 clubs?"]);
    expect(call.asked[2]).toEqual({
      kind: "ages.plan",
      clubs: [
        { teamId: "W-1", level: 10, year: 2027 },
        { teamId: "W-2", level: 10, year: 2027 },
      ],
      at: expect.any(String),
      base: expect.any(String),
    });
    expect(call.sent[0]).toEqual({
      command: { kind: "batch", commands: planned },
      said: {
        done: "1 club moved to its suggested age groups; 3 games refiled. 1 club could not be changed and remain in the review list.",
        undo: true,
        afterUndo: expect.any(Function),
      },
    });
    // The club that moved leaves the list; the one that could not stays.
    await waitFor(() => expect(screen.queryByText("Placeholder Larks")).toBeNull());
    expect(screen.getByText("Placeholder Wrens")).toBeTruthy();
  });

  it("approves more clubs than one edit carries as several, each planned once the last is made", async () => {
    const [larks] = LOOKED.lists.wrongAge;
    if (!larks) throw new Error("no club");
    const many = Array.from({ length: MAX_COMMAND_STEPS + 1 }, (_, at) => ({
      ...larks,
      teamId: `M-${at}`,
      name: `Placeholder M-${at}`,
      gcTeamIds: [`gc-m${at}`],
    }));
    const planned: PoolCommand = {
      kind: "club.age",
      year: 2027,
      teamId: "M-0",
      level: 10,
      at: "2027-04-15T12:00:00.000Z",
      pageId: "ag_plan-0",
    };
    const call = editFunction({
      "health.summary": OPENED,
      "health.inspect": { ...LOOKED, lists: { ...LOOKED.lists, wrongAge: many } },
      "ages.plan": {
        kind: "ages.plan",
        commands: [planned],
        changedTeamIds: ["M-0"],
        moved: 3,
        failed: 1,
      },
    });
    show(call);
    fireEvent.click(await screen.findByRole("button", { name: "Check the pool" }));
    fireEvent.click(await screen.findByRole("button", { name: "Approve all changes" }));
    await waitFor(() => expect(call.sent).toHaveLength(2));
    expect(confirmed).toEqual([`Approve age changes for ${MAX_COMMAND_STEPS + 1} clubs?`]);
    const plans = call.asked.flatMap((query) => (query.kind === "ages.plan" ? [query] : []));
    expect(plans.map((plan) => plan.clubs.length)).toEqual([MAX_COMMAND_STEPS, 1]);
    expect(plans[1]?.clubs).toEqual([{ teamId: `M-${MAX_COMMAND_STEPS}`, level: 10, year: 2027 }]);
    // The second part is planned on the pool the first edit left.
    expect(call.asked.indexOf(plans[1] as PoolQuery)).toBeGreaterThanOrEqual(
      call.askedBySend[0] ?? Infinity
    );
    // Each part says the clubs moved so far, and neither offers an Undo that would take back only
    // the last.
    expect(call.sent.map(({ said }) => said)).toEqual([
      {
        done: "1 club moved to its suggested age groups; 3 games refiled. 1 club could not be changed and remain in the review list.",
        undo: false,
      },
      {
        done: "2 clubs moved to their suggested age groups; 6 games refiled. 2 clubs could not be changed and remain in the review list.",
        undo: false,
      },
    ]);
  });

  it("says what a last part that moved no club could not change", async () => {
    const [larks] = LOOKED.lists.wrongAge;
    if (!larks) throw new Error("no club");
    const many = Array.from({ length: MAX_COMMAND_STEPS + 1 }, (_, at) => ({
      ...larks,
      teamId: `M-${at}`,
      name: `Placeholder M-${at}`,
      gcTeamIds: [`gc-m${at}`],
    }));
    const call = editFunction(
      {
        "health.summary": OPENED,
        "health.inspect": { ...LOOKED, lists: { ...LOOKED.lists, wrongAge: many } },
      },
      {
        plans: [
          {
            kind: "ages.plan",
            commands: [
              {
                kind: "club.age",
                year: 2027,
                teamId: "M-0",
                level: 10,
                at: "2027-04-15T12:00:00.000Z",
                pageId: "ag_plan-0",
              },
            ],
            changedTeamIds: ["M-0"],
            moved: 3,
            failed: 0,
          },
          { kind: "ages.plan", commands: [], changedTeamIds: [], moved: 0, failed: 1 },
        ],
      }
    );
    show(call);
    fireEvent.click(await screen.findByRole("button", { name: "Check the pool" }));
    fireEvent.click(await screen.findByRole("button", { name: "Approve all changes" }));
    await waitFor(() => expect(call.told).toHaveLength(1));
    expect(call.sent.map(({ said }) => said.done)).toEqual([
      "1 club moved to its suggested age groups; 3 games refiled.",
    ]);
    expect(call.told).toEqual(["1 club could not be changed and remain in the review list."]);
    // The club that moved leaves the list.
    await waitFor(() => expect(screen.queryByText("Placeholder M-0")).toBeNull());
  });

  it("says nothing more when the plan went unanswered or the edit was not made, the device having said why", async () => {
    const planned: PoolCommand = {
      kind: "club.age",
      year: 2027,
      teamId: "W-1",
      level: 10,
      at: "2027-04-15T12:00:00.000Z",
      pageId: "ag_plan-0",
    };
    const cases: Array<{ plan: AnswerOf<"ages.plan"> | null; makes: boolean; sent: number }> = [
      { plan: null, makes: true, sent: 0 },
      {
        plan: {
          kind: "ages.plan",
          commands: [planned],
          changedTeamIds: ["W-1"],
          moved: 3,
          failed: 0,
        },
        makes: false,
        sent: 1,
      },
    ];
    for (const { plan, makes, sent } of cases) {
      const call = editFunction(
        { "health.summary": OPENED, "health.inspect": LOOKED, "ages.plan": plan },
        { makes }
      );
      const { unmount } = show(call);
      fireEvent.click(await screen.findByRole("button", { name: "Check the pool" }));
      fireEvent.click(await screen.findByRole("button", { name: "Approve all changes" }));
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Approve all changes" })).toBeTruthy()
      );
      expect(call.sent).toHaveLength(sent);
      expect(call.told).toEqual([]);
      // Both clubs stay on the list.
      expect(screen.getByText("Placeholder Larks")).toBeTruthy();
      unmount();
    }
  });

  it("sends nothing when the server's plan moves no club, and says so", async () => {
    const call = editFunction({
      "health.summary": OPENED,
      "health.inspect": LOOKED,
      "ages.plan": { kind: "ages.plan", commands: [], changedTeamIds: [], moved: 0, failed: 2 },
    });
    show(call);
    fireEvent.click(await screen.findByRole("button", { name: "Check the pool" }));
    fireEvent.click(await screen.findByRole("button", { name: "Approve all changes" }));
    await waitFor(() => expect(call.told).toHaveLength(1));
    expect(call.told[0]).toBe(
      "No club could be changed. 2 clubs could not be changed and remain in the review list."
    );
    expect(call.sent).toEqual([]);
    expect(screen.getByText("Placeholder Larks")).toBeTruthy();
  });

  it("starts the lists again on a new look, drawing what the server then offers", async () => {
    const call = editFunction({ "health.summary": OPENED, "health.inspect": LOOKED });
    show(call);
    fireEvent.click(await screen.findByRole("button", { name: "Check the pool" }));
    const larks = (await screen.findByText("Placeholder Larks")).closest("li");
    if (!larks) throw new Error("no club");
    fireEvent.click(within(larks).getByRole("button", { name: "Set 10U" }));
    await waitFor(() => expect(screen.queryByText("Placeholder Larks")).toBeNull());
    // The server lists it again (its age taken back, say): the look is the server's word.
    fireEvent.click(screen.getByRole("button", { name: "Look again" }));
    expect(await screen.findByText("Placeholder Larks")).toBeTruthy();
  });

  it("opens a listed club's own panel", async () => {
    const opened: string[] = [];
    const call = editFunction({ "health.summary": OPENED, "health.inspect": LOOKED });
    show(call, (teamId) => opened.push(teamId));
    fireEvent.click(await screen.findByRole("button", { name: "Check the pool" }));
    fireEvent.click(await screen.findByRole("button", { name: "Placeholder Wrens" }));
    expect(opened).toEqual(["W-2"]);
  });

  it("holds every edit that changes the pool while edits are off", async () => {
    const call = editFunction({ "health.summary": OPENED });
    const shown = show(call);
    await screen.findByText("Scored on a day that has not happened");
    shown.rerender(
      <LivePoolHealthCard
        edits={{ ...call.edits, locked: "Placeholder: offline." }}
        confirm={confirm}
        today={TODAY}
      />
    );
    expect(screen.getByRole("button", { name: "Delete 2 games" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Delete club" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Check the pool" })).toHaveProperty("disabled", true);
    expect(kinds(call.asked)).toEqual(["health.summary"]);
  });
});
