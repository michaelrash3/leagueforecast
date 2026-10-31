import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GcGame, GcTeamResponse, GcTeamSchedule } from "../../gameChangerApi";
import { TIDY_STEPS } from "../../gameChangerImport";
import { standInReport, standInShareLines, standInWhyLines } from "../../standInReport";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../../teamRankings";
import {
  cloudPoolKeys,
  flushPoolWrites,
  initTeamRankingsStore,
  loadAgeGroups,
  loadScoutGamesForYear,
  loadScoutTeams,
  readCloudPoolValue,
  resetTeamRankingsStore,
  saveScoutTeams,
} from "../../teamRankingsStorage";
import { commitChanges, type Change } from "../cloudEngine";
import { LEAGUE_PART } from "../cloudPlan";
import { memoryIo, runCloudPull, type CloudPullResult, type TidyCounts } from "../cloudRunner";
import { memoryUseOf } from "../memoryUse";
import {
  stageMemory,
  standInLines,
  storedStandInLines,
  sweptLines,
  tidyLines,
} from "../nightlyReport";
import { memoryCloud, type MemoryCloud } from "./memoryCloud";

/*
 * What the nightly says of its pull beyond its first line (`nightlyReport.ts`): what the tidy
 * changed, step by step, and what the sweep deleted, took off the boards and put back. Counts
 * only: the repository's Actions logs are public, so no club's name or id may reach a line, and the
 * made-up night below is held to that. Placeholder names throughout.
 */

const backing = new Map<string, string>();
beforeEach(() => {
  resetTeamRankingsStore();
  backing.clear();
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

/** A tidy that changed nothing, in one pass; `steps` says what it did change. */
const tidied = (steps: Partial<TidyCounts> = {}): TidyCounts => ({
  ...(Object.fromEntries(TIDY_STEPS.map((step) => [step, 0])) as Record<
    (typeof TIDY_STEPS)[number],
    number
  >),
  idle: 0,
  passes: 1,
  ...steps,
});

describe("the nightly's lines on its tidy", () => {
  it("says each step that changed something, a line apiece, under its passes", () => {
    const lines = tidyLines(tidied({ named: 12, joined: 3, idle: 2, passes: 3 }));
    expect(lines[0]).toBe("  The tidy, in 3 passes:");
    expect(lines.slice(1)).toHaveLength(3);
    for (const [line, count] of lines.slice(1).map((line, at) => [line, [12, 3, 2][at]])) {
      expect(line).toMatch(new RegExp(`^ {4}${count} `));
    }
  });

  it("says in a line that it changed nothing, and nothing where no tidy ran", () => {
    expect(tidyLines(tidied())).toEqual(["  The tidy, in 1 pass, changed nothing."]);
    expect(tidyLines(undefined)).toEqual([]);
  });

  // A step the tidy has and the log has no words for would go unsaid every night.
  it.each([...TIDY_STEPS, "idle" as const])(
    "says the step %s when it changed something",
    (step) => {
      const lines = tidyLines(tidied({ [step]: 7 }));
      expect(lines).toHaveLength(2);
      expect(lines[1]).toMatch(/^ {4}7 /);
    }
  );
});

describe("the nightly's lines on its sweep", () => {
  const night = (
    more: Partial<CloudPullResult>
  ): Pick<CloudPullResult, "end" | "deleted" | "marks"> => ({
    end: "finished",
    ...more,
  });

  it("says the 40-run deletions as before, and the marks beside them, a deleted club once", () => {
    expect(
      sweptLines(night({ deleted: { clubs: 2, games: 81 }, marks: { marked: 3, lifted: 1 } }))
    ).toEqual([
      "  Deleted for a game won or lost by 40 or more: 2 clubs, and 81 games that went with them.",
      "  Clubs removed for you, as plainly made up: 3 GameChanger teams taken off the boards, and 1 put back.",
    ]);
    expect(sweptLines(night({ marks: { marked: 1, lifted: 0 } }))).toEqual([
      "  Clubs removed for you, as plainly made up: 1 GameChanger team taken off the boards, and 0 put back.",
    ]);
  });

  it("says what a held save would have done, and nothing where the sweep did nothing", () => {
    expect(
      sweptLines(
        night({
          end: "held",
          deleted: { clubs: 40, games: 1_646 },
          marks: { marked: 0, lifted: 2 },
        })
      )
    ).toEqual([
      "  Would have deleted for a game won or lost by 40 or more: 40 clubs, and 1646 games that went with them.",
      "  Clubs removed for you, as plainly made up: 0 GameChanger teams would have been taken off the boards, and 2 put back.",
    ]);
    expect(sweptLines(night({}))).toEqual([]);
  });
});

describe("the nightly's lines on the stand-ins", () => {
  const groups = [{ id: "ag_10u_2027", name: "10U 2027", year: 2027 }] as AgeGroup[];
  const teams: ScoutTeam[] = [
    { id: "S-A", name: "Aces" },
    { id: "S-B", name: "Bears" },
    { id: "N-Z", name: "Zebras", nameOnly: true },
    { id: "P-1", name: "TBD 3:00 PM", placeholder: true },
  ];
  const played = (id: string, a: string, b: string) =>
    ({
      id,
      ageGroupId: "ag_10u_2027",
      teamAId: a,
      teamBId: b,
      teamAScore: 5,
      teamBScore: 3,
    }) as ScoutGame;
  // With its lists of the clubs holding the most games, which name them.
  const report = standInReport(
    teams,
    [played("g1", "S-A", "S-B"), played("g2", "S-A", "N-Z"), played("g3", "S-B", "P-1")],
    groups,
    2027
  );

  it("says the squad year's share and buckets in the model sweep's own words, naming none", () => {
    expect(report.top.map((club) => club.name)).toEqual(["Zebras"]);
    const lines = standInLines(report);
    expect(lines[0]).toBe(
      "  Stand-ins of squad year 2027, a club known only by name or a bracket slot on a side:"
    );
    expect(lines.slice(1)).toEqual(
      [...standInShareLines(report), ...standInWhyLines(report)].map((line) => `  ${line}`)
    );
    expect(lines[1]).toBe("    The year's games: 3; with a stand-in on a side: 2 (66.7%).");
    expect(lines[2]).toBe("    Played: 3; with a stand-in: 2 (66.7%).");
    const log = lines.join("\n");
    for (const team of teams) expect(log).not.toContain(team.name);
  });
});

describe("the nightly's memory after each step", () => {
  it("says, as each stage of the pull begins, what the one before it left the memory at", () => {
    const lines: string[] = [];
    let rss = 1_000_000_000;
    const memory = stageMemory(
      () => memoryUseOf((rss += 500_000_000), (rss + 100_000_000) / 1024),
      (line) => lines.push(line)
    );
    for (const stage of ["loading", "fetching", "fetching", "filing", "saving"] as const) {
      memory.stage(stage);
    }
    memory.done();
    expect(lines).toEqual([
      "  Memory after loading the copy: 1500.0 MB (at most 1600.0 MB).",
      "  Memory after asking GameChanger: 2000.0 MB (at most 2100.0 MB).",
      "  Memory after filing, tidying and sweeping: 2500.0 MB (at most 2600.0 MB).",
      "  Memory after saving: 3000.0 MB (at most 3100.0 MB).",
    ]);
    // The steps after the pull, by name, and nothing more once it is done.
    memory.after("publishing the views");
    memory.done();
    expect(lines.slice(4)).toEqual([
      "  Memory after publishing the views: 3500.0 MB (at most 3600.0 MB).",
    ]);
  });
});

/* ---------------------------------------------------------------- a made-up night, end to end */

const game = (id: string, opponentName: string, teamScore: number, opponentScore: number) =>
  ({
    id,
    date: "2026-09-20",
    startTs: "2026-09-20T15:00:00.000Z",
    opponentName,
    status: "completed",
    teamScore,
    opponentScore,
  }) satisfies GcGame;
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
const ACES = "gcACES000001";
const BEARS = "gcBEARS00001";
const ROUTER = "gcROUTER0001";
const SCHEDULES = new Map<string, GcTeamSchedule>([
  [ACES, schedule(ACES, "Aces", [game("a1", "Bears", 5, 3)])],
  [BEARS, schedule(BEARS, "Bears", [game("b1", "Aces", 3, 5)])],
  // Two wins by 40 its own schedule reports: marked, and kept, as League is not read.
  [
    ROUTER,
    schedule(ROUTER, "Router", [
      game("r1", "Hawks", 40, 0),
      { ...game("r2", "Wolves", 41, 0), date: "2026-09-21" },
    ]),
  ],
]);
/** Every name and id the night's pool holds, none of which may reach the log. */
const NAMED = ["Aces", "Bears", "Router", "Hawks", "Wolves", "Owls", ACES, BEARS, ROUTER, "N-OWLS"];

/** A copy saved by a phone, holding `teams`, with a League part no build reads as seasons. */
const seed = async (cloud: MemoryCloud) => {
  resetTeamRankingsStore();
  await initTeamRankingsStore(memoryIo());
  // A stand-in no game names, as a club deleted by hand leaves one: the tidy takes it out.
  saveScoutTeams([{ id: "N-OWLS", name: "Owls", nameOnly: true }]);
  await flushPoolWrites();
  const changes: Change[] = await Promise.all(
    cloudPoolKeys().map(async (key) => ({ key, value: await readCloudPoolValue(key), at: 1 }))
  );
  changes.push({ key: LEAGUE_PART, value: { seasons: ["the league's own"] }, at: 1 });
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

describe("a made-up night's lines", () => {
  it("say what it tidied and swept, in counts, and name no club", async () => {
    const cloud = memoryCloud();
    await seed(cloud);
    const result = await runCloudPull(
      {
        kind: "rota",
        walk: {
          teamIds: [ACES, BEARS, ROUTER],
          ageLevels: [9],
          markOn: null,
          workedAt: new Date("2026-09-29T12:00:00.000Z"),
        },
      },
      {
        store: cloud.store,
        fetchTeams: async (ids) =>
          new Map(
            ids.map((id): [string, GcTeamResponse] => {
              const found = SCHEDULES.get(id);
              return [
                id,
                found
                  ? { ok: true, schedule: found }
                  : { ok: false, reason: "not-found", message: "No such team." },
              ];
            })
          ),
        now: () => new Date("2026-09-29T13:00:00.000Z"),
        device: "nightly",
      }
    );
    expect(result).toMatchObject({ end: "finished", filed: 3 });
    const lines = [...tidyLines(result.tidy), ...sweptLines(result)];
    expect(lines).toContain("    1 opponent no game names any more, taken off the list.");
    expect(lines).toContain(
      "  Clubs removed for you, as plainly made up: 1 GameChanger team taken off the boards, and 0 put back."
    );
    // The squad year of the members' day, 2027 on 29 September 2026, read off the pool as saved:
    // the Router's two games against clubs nobody pulled, of the year's three.
    const standIns = storedStandInLines("2026-09-29");
    expect(standIns).toEqual(
      standInLines(
        standInReport(loadScoutTeams(), loadScoutGamesForYear(2027), loadAgeGroups(), 2027)
      )
    );
    expect(standIns[1]).toBe("    The year's games: 3; with a stand-in on a side: 2 (66.7%).");
    const log = [...lines, ...standIns].join("\n");
    for (const name of NAMED) expect(log).not.toContain(name);
  });
});
