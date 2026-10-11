import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  coerceTeamRankingsBackup,
  readTeamRankingsBackup,
  readTeamRankingsFile,
  teamRankingsJson,
  writeTeamRankingsBackup,
} from "../teamRankingsBackup";
import {
  loadAgeRightClubs,
  loadAgeUnknown,
  loadAutoRemoved,
  loadDeletedGames,
  loadDroppedClubs,
  loadKeptApart,
  loadNamedAges,
  loadNotThisTeam,
  loadRealClubs,
  loadTooYoungClubs,
  isCloudPoolKey,
  cloudPoolKeys,
  isBoardInputKey,
  resetTeamRankingsStore,
  saveAgeRightClubs,
  saveAgeUnknown,
  saveAutoRemoved,
  saveDeletedGames,
  saveDroppedClubs,
  saveKeptApart,
  saveNamedAges,
  saveNotThisTeam,
  saveRealClubs,
  saveTooYoungClubs,
} from "../teamRankingsStorage";
import { nameAge } from "../namedAges";
import { apartKey, keepApart } from "../keptApart";
import { refusalOf } from "../notThisTeam";
import type { AutoRemoval } from "../autoRemoved";

const REFUSED = refusalOf("gcHAWKS00001", "Eagles", "gcEAGLES0001");
const MARK: AutoRemoval = {
  gcTeamId: "gcDEMO000001",
  name: "Demo Club",
  on: "2026-09-20",
  signs: ["named"],
  word: "demo",
};

const NOW = "2026-09-20T12:00:00.000Z";

/** An evening's work: ages named, clubs thrown out, rows deleted, pairs kept apart. */
const anEveningOfAnswers = () => {
  saveNamedAges(nameAge(new Map(), { teamId: "bKpjvY5AVqOV", level: 9, namedAt: NOW }));
  saveDroppedClubs(new Set(["fake1", "fake2"]));
  saveTooYoungClubs(new Set(["sixU"]));
  saveDeletedGames(new Set(["gc_a_1"]));
  saveKeptApart(keepApart(new Set<string>(), "A", "B"));
  saveAgeUnknown([{ teamId: "still", firstSeen: NOW, lastTried: NOW, tries: 2 }]);
  saveRealClubs(new Set(["vouched"]));
  saveAgeRightClubs(new Set(["playsUp"]));
  saveNotThisTeam(new Set([REFUSED]));
  saveAutoRemoved(new Map([[MARK.gcTeamId, MARK]]));
};

/** A store of its own, so this file's answers are not somebody else's. */
const backing = new Map<string, string>();
const freshBrowser = () => {
  resetTeamRankingsStore();
  backing.clear();
};

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

describe("what a backup carries besides the pool", () => {
  /*
   * None of this can be recomputed. The named ages are an evening with GameChanger open in another
   * tab; the thrown-out clubs are a judgement about each one. Restoring into a fresh browser used
   * to throw the lot away and then set about rediscovering the problems it had answered.
   */
  it("takes the answers out and puts them back", () => {
    anEveningOfAnswers();
    const backup = readTeamRankingsBackup();
    expect(backup.answers?.namedAges).toHaveLength(1);
    expect(backup.answers?.droppedClubs).toEqual(["fake1", "fake2"]);

    // A fresh browser: nothing but what the file carries.
    freshBrowser();
    expect(loadNamedAges().size).toBe(0);

    writeTeamRankingsBackup(backup);
    expect(loadNamedAges().get("bKpjvY5AVqOV")?.level).toBe(9);
    expect([...loadDroppedClubs()].sort()).toEqual(["fake1", "fake2"]);
    expect([...loadTooYoungClubs()]).toEqual(["sixU"]);
    expect([...loadDeletedGames()]).toEqual(["gc_a_1"]);
    expect([...loadKeptApart()]).toEqual([apartKey("A", "B")]);
    expect(loadAgeUnknown().map((one) => one.teamId)).toEqual(["still"]);
    expect([...loadRealClubs()]).toEqual(["vouched"]);
    expect([...loadAgeRightClubs()]).toEqual(["playsUp"]);
    expect([...loadNotThisTeam()]).toEqual([REFUSED]);
    expect([...loadAutoRemoved().values()]).toEqual([MARK]);
  });

  /*
   * A file written before the clubs said to be real were kept carries the rest of the block without
   * them. That silence leaves what is stored alone, as a file with no block at all does.
   */
  it("leaves the clubs said to be real alone when the file predates them", () => {
    anEveningOfAnswers();
    const backup = readTeamRankingsBackup();
    const { realClubs: _real, ...older } = backup.answers!;

    writeTeamRankingsBackup({ ...backup, answers: older });
    expect([...loadRealClubs()]).toEqual(["vouched"]);
    writeTeamRankingsBackup({ ...backup, answers: { ...older, realClubs: [] } });
    expect([...loadRealClubs()]).toEqual([]);
  });

  // The same for the clubs said to play at another age on purpose, kept after the real clubs.
  it("leaves the clubs said to play up alone when the file predates them", () => {
    anEveningOfAnswers();
    const backup = readTeamRankingsBackup();
    const { ageRightClubs: _right, ...older } = backup.answers!;

    writeTeamRankingsBackup({ ...backup, answers: older });
    expect([...loadAgeRightClubs()]).toEqual(["playsUp"]);
    writeTeamRankingsBackup({ ...backup, answers: { ...older, ageRightClubs: [] } });
    expect([...loadAgeRightClubs()]).toEqual([]);
  });

  // The names said not to be a club ("Not this team"), kept after the clubs said to play up.
  it("leaves the names said not to be a club alone when the file predates them", () => {
    anEveningOfAnswers();
    const backup = readTeamRankingsBackup();
    expect(backup.answers?.notThisTeam).toEqual([REFUSED]);
    const { notThisTeam: _refused, ...older } = backup.answers!;

    writeTeamRankingsBackup({ ...backup, answers: older });
    expect([...loadNotThisTeam()]).toEqual([REFUSED]);
    writeTeamRankingsBackup({ ...backup, answers: { ...older, notThisTeam: [] } });
    expect([...loadNotThisTeam()]).toEqual([]);
  });

  // The clubs taken off as plainly made up, kept after the names said not to be a club.
  it("leaves the clubs taken off alone when the file predates them, and writes them into it", () => {
    anEveningOfAnswers();
    const backup = readTeamRankingsBackup();
    expect(backup.answers?.autoRemoved).toEqual([MARK]);
    const { autoRemoved: _marks, ...older } = backup.answers!;

    writeTeamRankingsBackup({ ...backup, answers: older });
    expect([...loadAutoRemoved().values()]).toEqual([MARK]);
    writeTeamRankingsBackup({ ...backup, answers: { ...older, autoRemoved: [] } });
    expect(loadAutoRemoved().size).toBe(0);

    const withTeams = { ...backup, teams: [{ id: "S-A", name: "Placeholder" }] };
    const file = JSON.parse(teamRankingsJson(withTeams, NOW)) as unknown;
    expect(readTeamRankingsFile(file)?.answers?.autoRemoved).toEqual([MARK]);
  });

  /*
   * The marks are made on the cloud copy by the nightly and read off it by every device, and a
   * change to them changes what the boards leave out, so the boards are built again.
   */
  it("travels the clubs taken off with the cloud copy, as a board input", () => {
    saveAutoRemoved(new Map([[MARK.gcTeamId, MARK]]));
    expect(isCloudPoolKey("league_forecast_gc_auto_removed_v1")).toBe(true);
    expect(cloudPoolKeys()).toContain("league_forecast_gc_auto_removed_v1");
    expect(isBoardInputKey("league_forecast_gc_auto_removed_v1")).toBe(true);
  });

  it("writes the names said not to be a club into the file, and reads them back off it", () => {
    anEveningOfAnswers();
    // A file is written only for a pool with something in it.
    const backup = { ...readTeamRankingsBackup(), teams: [{ id: "S-A", name: "Placeholder" }] };
    const file = JSON.parse(teamRankingsJson(backup, NOW)) as unknown;
    expect(readTeamRankingsFile(file)?.answers?.notThisTeam).toEqual([REFUSED]);
  });

  /*
   * The cloud copy carries every pool key but the device-only ones, so a refusal made on the live
   * page, or on a device, reaches the nightly, which reads the copy.
   */
  it("travels with the cloud copy", () => {
    saveNotThisTeam(new Set([REFUSED]));
    expect(isCloudPoolKey("league_forecast_gc_not_this_team_v1")).toBe(true);
    expect(cloudPoolKeys()).toContain("league_forecast_gc_not_this_team_v1");
  });

  /*
   * "This file predates the block" and "this file has nothing to say about it" are the same bytes,
   * so silence has to mean leave it alone. Reading it as "throw them away" would make restoring an
   * old backup destroy work the file was never asked about.
   */
  it("leaves the answers alone when the file has none", () => {
    anEveningOfAnswers();
    const old = { ageGroups: [], teams: [], games: [] };

    writeTeamRankingsBackup(old);

    expect(loadNamedAges().get("bKpjvY5AVqOV")?.level).toBe(9);
    expect([...loadDroppedClubs()].sort()).toEqual(["fake1", "fake2"]);
  });

  /*
   * A file is untrusted on the way in as well as on the way out. A named level the app does not
   * rank would be an answer that files nowhere — the team would come off the waiting list and
   * land on no page — so a restore has to refuse it rather than write it through.
   */
  it("refuses a named level the app does not rank, even from a file", () => {
    writeTeamRankingsBackup({
      ageGroups: [],
      teams: [],
      games: [],
      answers: {
        namedAges: [
          { teamId: "good", level: 9, namedAt: NOW },
          { teamId: "toddler", level: 6, namedAt: NOW },
          { teamId: "grown", level: 21, namedAt: NOW },
        ],
        droppedClubs: [],
        tooYoungClubs: [],
        deletedGames: [],
        keptApart: [],
        ageUnknown: [],
      },
    });

    expect([...loadNamedAges().keys()]).toEqual(["good"]);
  });

  it("reads an answers block off a parsed file, and shrugs off a broken one", () => {
    const parsed = coerceTeamRankingsBackup({
      ageGroups: [],
      teams: [],
      games: [],
      answers: {
        namedAges: [
          { teamId: "A", level: 9, namedAt: NOW },
          // Not a level this app ranks, so not an answer.
          { teamId: "B", level: 6, namedAt: NOW },
        ],
        droppedClubs: ["x", 7, ""],
        tooYoungClubs: "nope",
        deletedGames: ["g1"],
        keptApart: [],
        ageUnknown: "nope",
      },
    });
    expect(parsed?.answers?.namedAges.map((one) => one.teamId)).toEqual(["A"]);
    expect(parsed?.answers?.droppedClubs).toEqual(["x"]);
    expect(parsed?.answers?.tooYoungClubs).toEqual([]);
    expect(parsed?.answers?.ageUnknown).toEqual([]);

    expect(
      coerceTeamRankingsBackup({ ageGroups: [], teams: [], games: [] })?.answers
    ).toBeUndefined();
  });
});
