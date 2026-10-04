import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditSaid, LiveEdits } from "../../hooks/useLiveEdits";
import type { AgeUnknownTeam } from "../../lib/ageUnknown";
import type { PoolCommand } from "../../lib/live/commands";
import type { AnswerOf, PoolQuery, QueryKind, QueryOf } from "../../lib/live/queries";
import { LiveAgelessCard } from "./LiveAgelessCard";

/*
 * The teams waiting on an age on the live page (`LiveAgelessCard`): drawn from the server's list,
 * each answer sent as the edit the device's own card makes, the list asked for again after it, and
 * the ten in front of the person held there by sending them back. The edit function here is a
 * stand-in that records what it was asked and sent. Placeholder names throughout.
 */

const TODAY = "2027-04-15";

const waiting = (teamId: string, name: string): AgeUnknownTeam => ({
  teamId,
  name,
  firstSeen: "2027-04-01T00:00:00.000Z",
  lastTried: "2027-04-08T00:00:00.000Z",
  tries: 1,
  evidence: {
    games: 2,
    scored: 2,
    aheadOfToday: 0,
    shutoutBlowouts: 0,
    opponents: 2,
    namedAnAge: 0,
    tally: [],
    state: "OH",
  },
});

const BATCH = [waiting("gcA", "Placeholder Alpha"), waiting("gcB", "Placeholder Bravo")];

const QUEUE: AnswerOf<"ageless.queue"> = {
  kind: "ageless.queue",
  listed: 40,
  waiting: 37,
  batch: BATCH,
  groups: [
    {
      rule: {
        id: "void-name",
        label: "Named void or do not use",
        because: "whoever made the team named it so nobody would use it",
      },
      count: 3,
      examples: ["Placeholder VOID 1", "Placeholder VOID 2", "Placeholder VOID 3"],
    },
    {
      rule: { id: "tee-ball", label: "Tee ball and younger", because: "below the youngest level" },
      count: 2,
      examples: ["Placeholder Tee 1", "Placeholder Tee 2"],
    },
  ],
};

type Answers = { [K in QueryKind]?: AnswerOf<K> | null };

/** The edit function as the card reaches it: what it was asked and sent. */
const editFunction = (
  answers: Answers,
  { locked = null, makes = true }: { locked?: string | null; makes?: boolean } = {}
) => {
  const asked: PoolQuery[] = [];
  const sent: Array<{ command: PoolCommand; said: EditSaid }> = [];
  const edits: LiveEdits = {
    locked,
    pending: [],
    edit: async (command, said) => {
      sent.push({ command, said });
      return makes;
    },
    ask: async <K extends QueryKind>(query: QueryOf<K>) => {
      asked.push(query);
      const answer = answers[query.kind];
      return (answer ? structuredClone(answer) : null) as AnswerOf<K> | null;
    },
    warm: () => undefined,
    say: () => undefined,
  };
  return { edits, asked, sent };
};

const confirmed: string[] = [];
let confirming = true;
const confirm = async ({ title }: { title: string }) => {
  confirmed.push(title);
  return confirming;
};

const show = (call: ReturnType<typeof editFunction>) =>
  render(<LiveAgelessCard edits={call.edits} confirm={confirm} today={TODAY} />);

const kinds = (asked: PoolQuery[]) => asked.map((query) => query.kind);

afterEach(() => {
  confirmed.length = 0;
  confirming = true;
  vi.restoreAllMocks();
});

describe("the teams waiting on an age, from the server's list", () => {
  it("draws the ten in front of the person and the rules' rows, asked on the device's day", async () => {
    const call = editFunction({ "ageless.queue": QUEUE });
    show(call);
    expect(await screen.findByText("Placeholder Alpha")).toBeTruthy();
    expect(screen.getByText("Placeholder Bravo")).toBeTruthy();
    expect(screen.getByText(/37 teams nobody could age/)).toBeTruthy();
    expect(screen.getByText(/Showing 2 of 37; 35 behind these/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear the 5 ticked" })).toBeTruthy();
    expect(call.asked).toEqual([{ kind: "ageless.queue", today: TODAY, pinned: [] }]);
  });

  it("asks nothing while edits are off, and says why rather than drawing nothing", async () => {
    const call = editFunction({ "ageless.queue": QUEUE }, { locked: "Placeholder: offline." });
    const { container } = show(call);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(call.asked).toEqual([]);
    expect(container.textContent).toBe("Placeholder: offline.");
  });

  it("draws nothing while the list is on its way", async () => {
    const call = editFunction({});
    const { container } = show(call);
    expect(container.textContent).toBe("");
  });

  it("says when the list could not be read, and asks again when told to", async () => {
    const answers: Answers = { "ageless.queue": null };
    const call = editFunction(answers);
    show(call);
    expect(await screen.findByText(/could not be read from the cloud/)).toBeTruthy();
    answers["ageless.queue"] = QUEUE;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Placeholder Alpha")).toBeTruthy();
  });

  it("downloads every team waiting from the server's own file", async () => {
    const created: Blob[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      created.push(blob as Blob);
      return "blob:stub";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const call = editFunction({
      "ageless.queue": QUEUE,
      "ageless.file": { kind: "ageless.file", csv: "Team,Answer\nPlaceholder Alpha," },
    });
    show(call);
    fireEvent.click(await screen.findByRole("button", { name: "Download the list" }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(call.asked[1]).toEqual({ kind: "ageless.file", today: TODAY });
    expect(await created[0]!.text()).toContain("Placeholder Alpha,");
  });
});

describe("the answers, sent as edits", () => {
  const rowOf = async (name: string) => {
    const row = (await screen.findByText(name)).closest("li");
    if (!row) throw new Error(`no row for ${name}`);
    return row;
  };

  it("leaves the age box choosing again when the age named was not kept", async () => {
    const call = editFunction({ "ageless.queue": QUEUE }, { makes: false });
    show(call);
    const row = await rowOf("Placeholder Alpha");
    const box = within(row).getByLabelText("Age for Placeholder Alpha");
    fireEvent.change(box, { target: { value: "10" } });
    await waitFor(() => expect(call.sent).toHaveLength(1));
    expect(box).toHaveProperty("value", "");
  });

  it("names an age, then asks again with the ten held in front of the person", async () => {
    const call = editFunction({ "ageless.queue": QUEUE });
    show(call);
    const row = await rowOf("Placeholder Alpha");
    fireEvent.change(within(row).getByLabelText("Age for Placeholder Alpha"), {
      target: { value: "10" },
    });
    await waitFor(() => expect(call.sent).toHaveLength(1));
    expect(call.sent[0]).toEqual({
      command: {
        kind: "namedAges",
        put: [{ teamId: "gcA", level: 10, name: "Placeholder Alpha", namedAt: expect.any(String) }],
        forget: [],
      },
      said: {
        done: "Placeholder Alpha is 10U. It will be filed on the next refresh.",
        undo: false,
      },
    });
    await waitFor(() => expect(call.asked).toHaveLength(2));
    expect(call.asked[1]).toEqual({ kind: "ageless.queue", today: TODAY, pinned: ["gcA", "gcB"] });
  });

  it("throws a team out and off the list as one edit, its Undo asking for the list again", async () => {
    const call = editFunction({ "ageless.queue": QUEUE });
    show(call);
    const row = await rowOf("Placeholder Bravo");
    fireEvent.click(within(row).getByRole("button", { name: "Not a real team" }));
    await waitFor(() => expect(call.sent).toHaveLength(1));
    expect(call.sent[0]?.command).toEqual({
      kind: "batch",
      commands: [
        { kind: "answers", list: "droppedClubs", add: ["gcB"], remove: [] },
        { kind: "ageless.forget", teamIds: ["gcB"] },
      ],
    });
    expect(call.sent[0]?.said).toEqual({
      done: "Placeholder Bravo thrown out.",
      undo: true,
      afterUndo: expect.any(Function),
    });
    await waitFor(() => expect(kinds(call.asked)).toEqual(["ageless.queue", "ageless.queue"]));
    call.sent[0]?.said.afterUndo?.();
    await waitFor(() => expect(call.asked).toHaveLength(3));
  });

  it("finds a team on the whole list once the typing stops, and takes an answer about it back", async () => {
    const named = waiting("gcN", "Placeholder November");
    const call = editFunction({
      "ageless.queue": QUEUE,
      "ageless.search": {
        kind: "ageless.search",
        total: 1,
        hits: [{ entry: named, aside: "named" }],
      },
    });
    show(call);
    fireEvent.change(await screen.findByPlaceholderText("Name or GameChanger id"), {
      target: { value: "nov" },
    });
    // Still typing, a beat later.
    await new Promise((resolve) => setTimeout(resolve, 50));
    fireEvent.change(screen.getByPlaceholderText("Name or GameChanger id"), {
      target: { value: "november" },
    });
    const row = await rowOf("Placeholder November");
    // Asked once, for what was typed when it stopped.
    expect(call.asked.filter((query) => query.kind === "ageless.search")).toEqual([
      { kind: "ageless.search", today: TODAY, query: "november" },
    ]);
    expect(row.textContent).toMatch(/You have already said what age this is/);
    fireEvent.click(within(row).getByRole("button", { name: "Undo that" }));
    await waitFor(() => expect(call.sent).toHaveLength(1));
    expect(call.sent[0]?.command).toEqual({
      kind: "batch",
      commands: [
        { kind: "answers", list: "droppedClubs", add: [], remove: ["gcN"] },
        { kind: "namedAges", put: [], forget: ["gcN"] },
      ],
    });
  });

  it("draws a search's answer only under the words it was asked for", async () => {
    const named = waiting("gcN", "Placeholder November");
    const call = editFunction({
      "ageless.queue": QUEUE,
      "ageless.search": {
        kind: "ageless.search",
        total: 1,
        hits: [{ entry: named, aside: "named" }],
      },
    });
    show(call);
    const box = await screen.findByPlaceholderText("Name or GameChanger id");
    fireEvent.change(box, { target: { value: "november" } });
    await rowOf("Placeholder November");
    // Other words typed: the last answer goes until theirs is in.
    fireEvent.change(box, { target: { value: "oscar" } });
    expect(screen.queryByText("Placeholder November")).toBeNull();
  });

  it("clears the rows of the rules ticked as one edit the server planned, once asked", async () => {
    const call = editFunction({
      "ageless.queue": QUEUE,
      "ageless.clearPlan": {
        kind: "ageless.clearPlan",
        teamIds: ["gcV1", "gcV2", "gcV3"],
        byRule: [{ label: "Named void or do not use", count: 3 }],
      },
    });
    show(call);
    // Tee ball unticked: only the void names are asked about.
    fireEvent.click(await screen.findByRole("checkbox", { name: /Tee ball and younger/ }));
    fireEvent.click(screen.getByRole("button", { name: "Clear the 3 ticked" }));
    await waitFor(() => expect(call.sent).toHaveLength(1));
    expect(call.asked[1]).toEqual({
      kind: "ageless.clearPlan",
      today: TODAY,
      rules: ["void-name"],
    });
    expect(confirmed).toEqual(["Clear 3 teams?"]);
    expect(call.sent[0]).toEqual({
      command: {
        kind: "batch",
        commands: [
          { kind: "answers", list: "droppedClubs", add: ["gcV1", "gcV2", "gcV3"], remove: [] },
          { kind: "ageless.forget", teamIds: ["gcV1", "gcV2", "gcV3"] },
        ],
      },
      said: { done: "3 teams cleared.", undo: true, afterUndo: expect.any(Function) },
    });
  });

  it("clears nothing when told no, or when the plan finds nothing to clear", async () => {
    const answers: Answers = {
      "ageless.queue": QUEUE,
      "ageless.clearPlan": { kind: "ageless.clearPlan", teamIds: ["gcV1"], byRule: [] },
    };
    const call = editFunction(answers);
    show(call);
    confirming = false;
    fireEvent.click(await screen.findByRole("button", { name: "Clear the 5 ticked" }));
    await waitFor(() => expect(confirmed).toHaveLength(1));
    answers["ageless.clearPlan"] = { kind: "ageless.clearPlan", teamIds: [], byRule: [] };
    confirming = true;
    fireEvent.click(screen.getByRole("button", { name: "Clear the 5 ticked" }));
    await waitFor(() =>
      expect(kinds(call.asked).filter((kind) => kind === "ageless.clearPlan")).toHaveLength(2)
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(confirmed).toHaveLength(1);
    expect(call.sent).toEqual([]);
  });
});
