import { describe, expect, it } from "vitest";
import {
  ackMessage,
  crawlImportSearch,
  handedFile,
  HANDOFF_CHANNEL,
  HANDOFF_LIMITS,
  loadedMessage,
  readHandoffMessage,
  readyMessage,
} from "../crawlHandoff";
import { parseRankingsRoute } from "../rankingsRoute";

/* The crawl's files handed to Import by the owner's userscript. Placeholder names throughout. */

const ORIGIN = "https://leagueforecast.vercel.app";
const page = { name: "this page" };
const self = { origin: ORIGIN, window: page };
const TEAMS = '"Team Name","Team ID"\r\n"Placeholder Owls","Ab3dE5gH7jK9"';
const ORGS =
  '"Organization Name","Organization ID","Team IDs"\r\n"Placeholder League","Pqy5Av4tHncy","Ab3dE5gH7jK9"';
const files = (extra: Record<string, unknown> = {}) => ({
  channel: HANDOFF_CHANNEL,
  v: 1,
  from: "miner",
  type: "files",
  id: "run_2026-10-25",
  createdAt: "2026-10-25T18:00:00.000Z",
  teams: { name: "GC_Teams_New.csv", text: TEAMS },
  orgs: { name: "GC_Organizations_New.csv", text: ORGS },
  ...extra,
});
const posted = (data: unknown, over: Partial<{ origin: string; source: unknown }> = {}) => ({
  origin: ORIGIN,
  source: page,
  data,
  ...over,
});

describe("a message posted to the page, read as the hand-off", () => {
  it("takes the miner's files from this page's own window and origin", () => {
    expect(readHandoffMessage(posted(files()), self)).toEqual({
      kind: "files",
      id: "run_2026-10-25",
      teams: { name: "GC_Teams_New.csv", text: TEAMS },
      orgs: { name: "GC_Organizations_New.csv", text: ORGS },
    });
    // One kind alone is a hand-off; a missing name takes the export's own.
    expect(
      readHandoffMessage(posted(files({ teams: undefined, orgs: { text: ORGS } })), self)
    ).toEqual({
      kind: "files",
      id: "run_2026-10-25",
      teams: null,
      orgs: { name: "GC_Organizations_New.csv", text: ORGS },
    });
    expect(readHandoffMessage(posted({ ...files(), type: "hello" }), self)).toEqual({
      kind: "hello",
    });
  });

  it("ignores, unanswered, anything not from the miner on this page", () => {
    for (const event of [
      posted(files(), { origin: "https://web.gc.com" }),
      posted(files(), { source: { name: "a frame" } }),
      posted(files(), { source: null }),
      posted({ ...files(), channel: "something else" }),
      posted({ ...files(), from: "app" }),
      posted({ ...files(), type: "loaded" }),
      posted("files"),
      posted(null),
    ])
      expect(readHandoffMessage(event, self)).toEqual({ kind: "ignore" });
  });

  it("refuses, and says why, files it cannot take", () => {
    const small = { teamsChars: 10, orgsChars: 10 };
    const refused = (
      data: unknown,
      limits: { teamsChars: number; orgsChars: number } = HANDOFF_LIMITS
    ) => readHandoffMessage(posted(data), self, limits);
    expect(refused(files({ v: 2 }))).toEqual({
      kind: "refuse",
      id: "run_2026-10-25",
      reason: "version",
    });
    expect(refused(files({ id: "not an id!" }))).toEqual({
      kind: "refuse",
      id: null,
      reason: "id",
    });
    expect(refused(files({ id: "x".repeat(65) }))).toMatchObject({ reason: "id" });
    expect(refused(files({ teams: null, orgs: undefined }))).toMatchObject({ reason: "no-files" });
    expect(refused(files({ teams: { text: "" } }))).toMatchObject({ reason: "empty" });
    expect(refused(files({ orgs: { text: 12 } }))).toMatchObject({ reason: "empty" });
    expect(refused(files(), small)).toMatchObject({ reason: "too-big" });
    expect(refused(files({ teams: { name: "x".repeat(256), text: TEAMS } }))).toMatchObject({
      reason: "name",
    });
  });
});

describe("what the page says back", () => {
  it("is on the hand-off's channel, from the app's side", () => {
    expect(readyMessage()).toEqual({
      channel: HANDOFF_CHANNEL,
      v: 1,
      from: "app",
      type: "ready",
      limits: { teamsChars: 268_435_456, orgsChars: 67_108_864 },
    });
    expect(ackMessage("run_1", true)).toEqual({
      channel: HANDOFF_CHANNEL,
      v: 1,
      from: "app",
      type: "ack",
      id: "run_1",
      accepted: true,
    });
    expect(ackMessage(null, false, "id")).toMatchObject({
      id: null,
      accepted: false,
      reason: "id",
    });
    expect(loadedMessage("run_1", "orgs")).toMatchObject({
      type: "loaded",
      id: "run_1",
      kind: "orgs",
    });
  });
});

describe("where the files go", () => {
  it("is a File like the one a file input hands over, the same bytes", async () => {
    const file = handedFile({ name: "GC_Teams_New.csv", text: "Équipe Québec,Ab3dE5gH7jK9" });
    expect(file.name).toBe("GC_Teams_New.csv");
    expect(file.size).toBe(new TextEncoder().encode("Équipe Québec,Ab3dE5gH7jK9").length);
    expect(await file.text()).toBe("Équipe Québec,Ab3dE5gH7jK9");
  });

  it("is Team Rankings' Import, keeping the page's age, year and half", () => {
    const search = crawlImportSearch("?view=league&age=10&year=2027&half=fall&share=1");
    expect(parseRankingsRoute(search)).toEqual({
      mode: "rankings",
      ageLevel: 10,
      year: 2027,
      segment: "fall",
      section: "import",
    });
    expect(new URLSearchParams(search).get("share")).toBe("1");
  });
});
