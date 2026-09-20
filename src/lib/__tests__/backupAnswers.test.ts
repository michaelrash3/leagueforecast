import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  coerceTeamRankingsBackup,
  readTeamRankingsBackup,
  writeTeamRankingsBackup,
} from "../teamRankingsBackup";
import {
  loadAgeUnknown,
  loadDeletedGames,
  loadDroppedClubs,
  loadKeptApart,
  loadNamedAges,
  loadTooYoungClubs,
  resetTeamRankingsStore,
  saveAgeUnknown,
  saveDeletedGames,
  saveDroppedClubs,
  saveKeptApart,
  saveNamedAges,
  saveTooYoungClubs,
} from "../teamRankingsStorage";
import { nameAge } from "../namedAges";
import { apartKey, keepApart } from "../keptApart";

const NOW = "2026-09-20T12:00:00.000Z";

/** An evening's work: ages named, clubs thrown out, rows deleted, pairs kept apart. */
const anEveningOfAnswers = () => {
  saveNamedAges(nameAge(new Map(), { teamId: "bKpjvY5AVqOV", level: 9, namedAt: NOW }));
  saveDroppedClubs(new Set(["fake1", "fake2"]));
  saveTooYoungClubs(new Set(["sixU"]));
  saveDeletedGames(new Set(["gc_a_1"]));
  saveKeptApart(keepApart(new Set<string>(), "A", "B"));
  saveAgeUnknown([{ teamId: "still", firstSeen: NOW, lastTried: NOW, tries: 2 }]);
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
