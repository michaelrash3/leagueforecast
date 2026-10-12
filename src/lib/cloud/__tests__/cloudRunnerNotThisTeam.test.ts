import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GcGame, GcTeamResponse, GcTeamSchedule } from "../../gameChangerApi";
import type { FetchGcTeamsOptions } from "../../gameChangerClient";
import { createGcImporter } from "../../gameChangerImport";
import { refusalOf } from "../../notThisTeam";
import type { ScoutGame } from "../../teamRankings";
import {
  cloudPoolKeys,
  flushPoolWrites,
  initTeamRankingsStore,
  loadScoutGames,
  readCloudPoolValue,
  resetTeamRankingsStore,
  saveAgeGroups,
  saveNotThisTeam,
  saveScoutGames,
  saveScoutTeams,
} from "../../teamRankingsStorage";
import { commitChanges, type Change } from "../cloudEngine";
import { loadPoolFrom, memoryIo, runCloudPull, type CloudPullDeps } from "../cloudRunner";
import { memoryCloud, type MemoryCloud } from "./memoryCloud";

/*
 * "Not this team" on a server's pull (`runCloudPull`, which the nightly refresh and every pull in
 * the cloud run): the names the owner has said are not a club are read from the copy, so neither
 * the import of what GameChanger answers nor the tidy after it files such a name onto that club
 * again. Placeholder names throughout.
 */

// The importer as it is, watched for what the run hands it.
vi.mock("../../gameChangerImport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../gameChangerImport")>();
  return { ...actual, createGcImporter: vi.fn(actual.createGcImporter) };
});

const backing = new Map<string, string>();
beforeEach(() => {
  resetTeamRankingsStore();
  backing.clear();
  vi.mocked(createGcImporter).mockClear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => {
      backing.set(key, value);
    },
    removeItem: (key: string) => {
      backing.delete(key);
    },
  });
});
afterEach(() => {
  resetTeamRankingsStore();
  vi.unstubAllGlobals();
});

const CUBS = "gcCUBS000001";
const PULLERS = "gcPULLER0001";
const ACES = "gcACES000001";
/** The owner's word: the Pullers' "Cubs" is not the pulled Cubs. */
const REFUSED = refusalOf(PULLERS, "Cubs", CUBS);

const row = (
  id: string,
  date: string,
  hour: number,
  opponentName: string,
  teamScore: number,
  opponentScore: number
): GcGame => ({
  id,
  date,
  startTs: `${date}T${String(hour).padStart(2, "0")}:00:00.000Z`,
  opponentName,
  status: "completed",
  teamScore,
  opponentScore,
});
const schedule = (id: string, name: string, games: GcGame[]): GcTeamSchedule => ({
  profile: {
    id,
    name: `${name} 9U`,
    ageLevel: 9,
    season: { season: "fall", year: 2026 },
    state: "OH",
    city: "Cincinnati",
  },
  games,
  fetchedAt: "2026-09-29T07:20:00.000Z",
});
const schedules = new Map<string, GcTeamSchedule>([
  [ACES, schedule(ACES, "Aces", [row("a1", "2026-09-20", 15, "Bears", 5, 3)])],
  // The Pullers' 21 September row again, and a new one naming "Cubs" on a day the Cubs played.
  [
    PULLERS,
    schedule(PULLERS, "Pullers", [
      row("p1", "2026-09-21", 15, "Cubs", 2, 6),
      row("p2", "2026-09-27", 19, "Cubs", 2, 8),
    ]),
  ],
]);
const answering: CloudPullDeps["fetchTeams"] = async (
  ids: string[],
  options: FetchGcTeamsOptions
) => {
  const answers = new Map<string, GcTeamResponse>();
  ids.forEach((teamId, at) => {
    const found = schedules.get(teamId);
    const result: GcTeamResponse = found
      ? { ok: true, schedule: found }
      : { ok: false, reason: "not-found", message: "No such team." };
    answers.set(teamId, result);
    options.onProgress?.({ done: at + 1, total: ids.length, teamId, result, attempts: 1 });
  });
  return answers;
};

const ag9 = { id: "ag9", name: "9U 2027", seasonIds: [], ageLevel: 9, year: 2027 };
const pulledClub = (id: string, name: string, gcId: string) => ({
  id,
  name,
  state: "OH",
  gcTeams: [{ teamId: gcId, name, ageGroupId: "ag9", ageLevel: 9 }],
});
const stored = (
  id: string,
  teamAId: string,
  teamBId: string,
  date: string,
  schedule: string,
  scores: [number, number]
): ScoutGame => ({
  id: `gc_${schedule}_${id}`,
  teamAId,
  teamBId,
  teamAScore: scores[0],
  teamBScore: scores[1],
  ageGroupId: "ag9",
  date,
  source: { kind: "gamechanger", teamId: schedule, gameId: id },
});

/**
 * A copy saved by a phone: the pulled Cubs and Pullers of Ohio, and the Pullers' 21 September row
 * filed against a stand-in of "Cubs", which the tidy files onto the club (`refileStandIns`) unless
 * the owner has said it is not the club; with the refusals in `refused`.
 */
const seed = async (cloud: MemoryCloud, refused: ReadonlySet<string>) => {
  resetTeamRankingsStore();
  await initTeamRankingsStore(memoryIo());
  saveAgeGroups([ag9]);
  saveScoutTeams([
    pulledClub("S-CUBS", "Cubs", CUBS),
    pulledClub("S-PULL", "Pullers", PULLERS),
    { id: "S-CUBS2", name: "Cubs", nameOnly: true },
    { id: "S-DUKES", name: "Dukes", nameOnly: true },
    { id: "S-EAGLES", name: "Eagles", nameOnly: true },
  ]);
  saveScoutGames([
    stored("c1", "S-CUBS", "S-DUKES", "2026-09-20", CUBS, [4, 1]),
    stored("c2", "S-CUBS", "S-EAGLES", "2026-09-27", CUBS, [4, 1]),
    stored("p1", "S-PULL", "S-CUBS2", "2026-09-21", PULLERS, [2, 6]),
  ]);
  saveNotThisTeam(refused);
  await flushPoolWrites();
  const changes: Change[] = await Promise.all(
    cloudPoolKeys().map(async (key) => ({ key, value: await readCloudPoolValue(key), at: 1 }))
  );
  const saved = await commitChanges({
    store: cloud.store,
    base: null,
    changes,
    device: "phone",
    now: "2026-09-28T12:00:00.000Z",
  });
  if (!saved.ok) throw new Error("seed");
  resetTeamRankingsStore();
};

const deps = (cloud: MemoryCloud): CloudPullDeps => ({
  store: cloud.store,
  fetchTeams: answering,
  now: () => new Date("2026-09-29T13:00:00.000Z"),
  device: "cloud-pull",
});

/** Where each of the Pullers' rows stands once the run's copy is read back: its opponent. */
const pullersAgainst = async (cloud: MemoryCloud) => {
  resetTeamRankingsStore();
  await loadPoolFrom(cloud.store);
  const games = loadScoutGames();
  const against = (gameId: string) =>
    games.find((game) => game.source?.teamId === PULLERS && game.source.gameId === gameId)?.teamBId;
  return { p1: against("p1"), p2: against("p2") };
};

describe("a pull run on the cloud copy, with the owner's refusals", () => {
  it("files the stand-in's row onto the club in its tidy when nothing is refused", async () => {
    const cloud = memoryCloud();
    await seed(cloud, new Set());
    await runCloudPull(
      { kind: "list", entries: [{ teamId: ACES }], seasonYears: [2027] },
      deps(cloud)
    );
    expect((await pullersAgainst(cloud)).p1).toBe("S-CUBS");
  });

  it("leaves a row the owner took off the club off it, though its tidy runs over the whole pool", async () => {
    const cloud = memoryCloud();
    await seed(cloud, new Set([REFUSED]));
    await runCloudPull(
      { kind: "list", entries: [{ teamId: ACES }], seasonYears: [2027] },
      deps(cloud)
    );
    expect((await pullersAgainst(cloud)).p1).toBe("S-CUBS2");
  });

  it("hands its import the refusals, and files the namer's new row of the name onto no club refused", async () => {
    const cloud = memoryCloud();
    await seed(cloud, new Set([REFUSED]));
    const result = await runCloudPull(
      { kind: "list", entries: [{ teamId: PULLERS }], seasonYears: [2027], refresh: true },
      deps(cloud)
    );
    expect(result).toMatchObject({ end: "finished", filed: 1 });
    const [, options] = vi.mocked(createGcImporter).mock.calls[0] ?? [];
    expect(options?.notThisTeam).toEqual(new Set([REFUSED]));
    const filed = await pullersAgainst(cloud);
    expect(filed.p1).not.toBe("S-CUBS");
    expect(filed.p2).toBeDefined();
    expect(filed.p2).not.toBe("S-CUBS");
  });

  it("files the namer's new row of the name onto the club when nothing is refused", async () => {
    const cloud = memoryCloud();
    await seed(cloud, new Set());
    await runCloudPull(
      { kind: "list", entries: [{ teamId: PULLERS }], seasonYears: [2027], refresh: true },
      deps(cloud)
    );
    expect((await pullersAgainst(cloud)).p2).toBe("S-CUBS");
  });
});
