import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTidyHandler, packPool, type WorkerResponse } from "../../../workers/tidyProtocol";
import { memoryIo } from "../../cloud/cloudRunner";
import { agelessCsvParts } from "../../agelessCsv";
import { agelessSearch, agelessWaiting } from "../../agelessQueue";
import { agelessClearPlan, agelessSitting } from "../../agelessSitting";
import { agelessClearable } from "../../agelessTriage";
import type { AgeUnknownTeam } from "../../ageUnknown";
import { poolSignature, type GcImportState } from "../../gameChangerImport";
import { apartKey, keptApartList } from "../../keptApart";
import { poolHealthSummary } from "../../poolHealthSummary";
import { dueSummary } from "../../gameChangerSchedule";
import { TO_PULL_DRAWN } from "../../poolLists";
import { storedRota } from "../../storedRota";
import type { ModelCheckAnswer, ScoutBacktestResult } from "../../scoutBacktest";
import {
  mergeScoutTeams,
  renameScoutTeam,
  type AgeGroup,
  type ScoutGame,
  type ScoutTeam,
} from "../../teamRankings";
import {
  initTeamRankingsStore,
  loadKeptApart,
  loadScoutGames,
  loadTidyStamp,
  resetTeamRankingsStore,
  saveAgeGroups,
  saveAgeRightClubs,
  saveAgeUnknown,
  saveDroppedClubs,
  saveKeptApart,
  saveNamedAges,
  saveOrgMembership,
  saveRealClubs,
  saveRefreshCadence,
  saveRefreshLog,
  saveScoutGames,
  saveScoutTeams,
  saveTidyStamp,
  storedGamesByYear,
} from "../../teamRankingsStorage";
import { unpulledClubs, unpulledClubsCsv } from "../../unpulledClubs";
import { planClubAges } from "../agePlan";
import { asJson } from "../editHandle";
import {
  answerQuery,
  coerceQuery,
  foldCounts,
  type AnswerOf,
  type PoolQuery,
  type QueryKind,
} from "../queries";
import { coerceQueryAnswer } from "../queryAnswers";
import type { GameSeen } from "../views/gamesShape";
import { callableEncode } from "./callableEncode";

/*
 * The questions a member's device asks of the server's pool (`queries.ts`): each answered as the
 * page answers it from its own pool, and read exactly both ways. Placeholder names throughout.
 */

const GROUPS: AgeGroup[] = [
  { id: "ag_10u_2026", name: "10U 2026", ageLevel: 10, year: 2026, seasonIds: [] },
  { id: "ag_10u_2027", name: "10U 2027", ageLevel: 10, year: 2027, seasonIds: [] },
];
const TEAMS: ScoutTeam[] = [
  { id: "A", name: "Club A" },
  { id: "B", name: "Club B" },
  { id: "C", name: "Club C" },
];
const game = (id: string, ageGroupId: string, teamAId: string, teamBId: string): ScoutGame => ({
  id,
  ageGroupId,
  teamAId,
  teamBId,
  teamAScore: 3,
  teamBScore: 2,
});
// Club A's games in two years: two against B (one each way), one against C, and one against its
// own name, which no fold of A drops.
const GAMES: ScoutGame[] = [
  game("g1", "ag_10u_2026", "A", "B"),
  game("g2", "ag_10u_2027", "B", "A"),
  game("g3", "ag_10u_2027", "A", "C"),
  game("g4", "ag_10u_2027", "A", "A"),
  game("g5", "ag_10u_2027", "B", "C"),
];

beforeEach(async () => {
  resetTeamRankingsStore();
  await initTeamRankingsStore(memoryIo());
  saveAgeGroups(GROUPS);
  saveScoutTeams(TEAMS);
  saveScoutGames(GAMES);
});
afterEach(() => resetTeamRankingsStore());

describe("a fold's counts", () => {
  it("are the games naming the club folded away, and the ones between the two the page's fold drops", () => {
    for (const [from, into] of [
      ["A", "B"],
      ["B", "A"],
      ["A", "C"],
      ["C", "B"],
    ] as const) {
      const counts = foldCounts(from, into, loadScoutGames());
      const folded = mergeScoutTeams(from, into, TEAMS, loadScoutGames(), GROUPS);
      expect([from, into, counts.dropped]).toEqual([from, into, folded.droppedGames]);
      expect([from, into, counts.games]).toEqual([
        from,
        into,
        GAMES.filter((one) => one.teamAId === from || one.teamBId === from).length,
      ]);
    }
    expect(foldCounts("A", "B", GAMES)).toEqual({ games: 4, dropped: 2 });
  });
});

describe("a merge preview", () => {
  it("says what folding one club into another touches, as the page's own fold", () => {
    expect(answerQuery({ kind: "merge.preview", fromId: "A", intoId: "B", adopt: [] })).toEqual({
      kind: "merge.preview",
      found: true,
      games: 4,
      dropped: 2,
    });
  });

  it("finds a club League Standings made only where it is offered, as the command takes it", () => {
    const made: ScoutTeam = { id: "L1", name: "League Club" };
    expect(answerQuery({ kind: "merge.preview", fromId: "L1", intoId: "A", adopt: [] })).toEqual({
      kind: "merge.preview",
      found: false,
      games: 0,
      dropped: 0,
    });
    expect(
      answerQuery({ kind: "merge.preview", fromId: "L1", intoId: "A", adopt: [made] })
    ).toEqual({ kind: "merge.preview", found: true, games: 0, dropped: 0 });
    // A club folded into itself is nothing to fold.
    expect(answerQuery({ kind: "merge.preview", fromId: "A", intoId: "A", adopt: [] })).toEqual({
      kind: "merge.preview",
      found: false,
      games: 0,
      dropped: 0,
    });
  });
});

describe("a rename preview", () => {
  it("names the club already under the new name, and what folding into it touches, as the page's rename", () => {
    for (const name of ["Club B", "  club b ", "Club B 10U", "Club D", "   "]) {
      const page = renameScoutTeam("A", name, TEAMS, GAMES, GROUPS);
      const answer = answerQuery({ kind: "rename.preview", teamId: "A", name });
      expect([name, answer.kind === "rename.preview" ? answer.into?.id : "?"]).toEqual([
        name,
        page.mergedInto?.id,
      ]);
      expect([name, answer]).toMatchObject([
        name,
        { dropped: page.droppedGames, games: page.mergedInto ? 4 : 0 },
      ]);
    }
    expect(answerQuery({ kind: "rename.preview", teamId: "A", name: "Club D 10U" })).toEqual({
      kind: "rename.preview",
      name: "Club D",
      into: null,
      games: 0,
      dropped: 0,
    });
    // Its own name is no other club's.
    expect(answerQuery({ kind: "rename.preview", teamId: "A", name: "club a" })).toMatchObject({
      into: null,
    });
  });
});

describe("a question as the server reads one", () => {
  const MERGE: PoolQuery = {
    kind: "merge.preview",
    fromId: "A",
    intoId: "B",
    adopt: [{ id: "B", name: "Club B" }],
  };
  const RENAME: PoolQuery = { kind: "rename.preview", teamId: "A", name: "Club B" };

  it("is the question exactly as sent", () => {
    expect(coerceQuery(JSON.parse(JSON.stringify(MERGE)))).toEqual(MERGE);
    expect(coerceQuery(RENAME)).toEqual(RENAME);
    for (const query of [
      { kind: "year.archivePreview", year: 2026 },
      { kind: "year.deletePreview", year: 2026 },
      { kind: "year.list" },
    ] as const) {
      expect(coerceQuery(JSON.parse(JSON.stringify(query)))).toEqual(query);
    }
    for (const raw of [
      { kind: "year.archivePreview", year: 1999 },
      { kind: "year.deletePreview", year: "2026" },
      { kind: "year.archivePreview" },
      { kind: "year.list", year: 2026 },
    ])
      expect([raw, coerceQuery(raw)]).toEqual([raw, null]);
  });

  it("is refused when it carries more than any device sends, which the server would spend its time on", () => {
    const today = "2026-09-27";
    const clubs = (count: number) =>
      Array.from({ length: count }, (_, at) => ({ teamId: `gc${at}`, level: 9, year: 2027 }));
    const plan = (count: number) => ({
      kind: "ages.plan",
      clubs: clubs(count),
      at: "2026-09-27T12:00:00.000Z",
      base: "ag_new",
    });
    expect(coerceQuery(plan(500))).not.toBeNull();
    const pinned = (count: number) => ({
      kind: "ageless.queue",
      today,
      pinned: Array.from({ length: count }, (_, at) => `gc${at}`),
    });
    expect(coerceQuery(pinned(10))).not.toBeNull();
    expect(coerceQuery({ ...RENAME, name: "x".repeat(200) })).not.toBeNull();
    for (const raw of [
      plan(501),
      pinned(11),
      { ...RENAME, name: "x".repeat(201) },
      { kind: "ageless.search", today, query: "x".repeat(201) },
      { ...MERGE, adopt: ["A", "B", "C"].map((id) => ({ id, name: `Club ${id}` })) },
      { kind: "ageless.clearPlan", today, rules: Array.from({ length: 50 }, () => "rule") },
    ])
      expect([raw, coerceQuery(raw)]).toEqual([raw, null]);
  });

  it("is refused with a field it does not read, a field of the wrong kind, or a kind it does not know", () => {
    for (const raw of [
      { ...RENAME, extra: 1 },
      { ...MERGE, adopt: [{ id: "B", name: "Club B", state: 5 }] },
      { ...MERGE, adopt: "B" },
      { ...MERGE, fromId: "" },
      { ...RENAME, name: 7 },
      { kind: "health" },
      { kind: "constructor" },
      null,
      [RENAME],
      "rename.preview",
    ]) {
      expect(coerceQuery(raw)).toBeNull();
    }
  });
});

describe("a game a page's list shows, asked by its place", () => {
  const SEEN: GameSeen = { teamAId: "A", teamBId: "C", teamAScore: 3, teamBScore: 2 };
  const FIND: PoolQuery = {
    kind: "games.find",
    year: 2027,
    page: "ag_10u_2027",
    at: 1,
    game: SEEN,
  };

  it("is named by its id, in the page's list as the server's pool has it now", () => {
    expect(answerQuery(FIND)).toEqual({ kind: "games.find", gameId: "g3" });
    // The list moved: found where it is now.
    expect(answerQuery({ ...FIND, at: 0 })).toEqual({ kind: "games.find", gameId: "g3" });
    // Another year's page, or a score the list never showed: none.
    expect(answerQuery({ ...FIND, year: 2026 })).toEqual({ kind: "games.find", gameId: null });
    expect(answerQuery({ ...FIND, game: { ...SEEN, teamBScore: 9 } })).toEqual({
      kind: "games.find",
      gameId: null,
    });
  });

  it("is asked exactly, and refused inexactly", () => {
    expect(coerceQuery(JSON.parse(JSON.stringify(FIND)))).toEqual(FIND);
    expect(coerceQuery({ ...FIND, year: null })).toEqual({ ...FIND, year: null });
    const game = SEEN;
    for (const raw of [
      { ...FIND, extra: 1 },
      { ...FIND, year: 2027.5 },
      { ...FIND, year: "2027" },
      { ...FIND, page: "" },
      { ...FIND, at: -1 },
      { ...FIND, at: 1.5 },
      { ...FIND, game: { ...game, extra: 1 } },
      { ...FIND, game: { ...game, teamAId: "" } },
      { ...FIND, game: { ...game, teamAScore: "3" } },
      { ...FIND, game: { ...game, date: "" } },
      { ...FIND, game: { ...game, excluded: false } },
      { ...FIND, game: null },
    ]) {
      expect(coerceQuery(raw)).toBeNull();
    }
  });

  it("is read back as sent, and refused with an id that is not one", () => {
    const found = { kind: "games.find", gameId: "g3" };
    expect(coerceQueryAnswer(found, "games.find")).toEqual(found);
    expect(coerceQueryAnswer({ ...found, gameId: null }, "games.find")).toEqual({
      ...found,
      gameId: null,
    });
    for (const raw of [{ ...found, gameId: "" }, { ...found, gameId: 3 }, { kind: "games.find" }])
      expect(coerceQueryAnswer(raw, "games.find")).toBeNull();
  });
});

describe("games typed or pasted, checked before they are added by name", () => {
  const CHECK: PoolQuery = {
    kind: "games.check",
    page: "ag_10u_2027",
    games: [
      { id: "r1", teamA: "Club A", teamB: "Club C", teamAScore: 3, teamBScore: 2 },
      { id: "r2", teamA: "Club A", teamB: "Club Cee" },
      { id: "r3", teamA: "Club A", teamB: "League Foxez", teamAScore: 1, teamBScore: 0 },
    ],
  };
  /** A League Standings season on the page, its Foxes a club the roster does not hold. */
  const SEASON = {
    teams: [
      { id: "a", name: "Club A" },
      { id: "f", name: "League Foxes" },
    ],
    matchups: [{ id: "m", date: "2027-04-03", away: "a", home: "f" }],
    logs: {},
  };

  it("are checked against the year's clubs and the page's games, League Standings' among them", () => {
    saveAgeGroups(
      GROUPS.map((group) => (group.id === "ag_10u_2027" ? { ...group, seasonIds: ["s"] } : group))
    );
    const seasons = (id: string) => (id === "s" ? SEASON : { teams: [], matchups: [], logs: {} });
    const answer = answerQuery(CHECK, seasons);
    const checks = answer.kind === "games.check" ? answer.checks : null;
    // Club A beat Club C 3-2 on the page already (g3): logged; the others are not.
    expect(checks?.map(({ logged }) => logged)).toEqual([true, false, false]);
    // A near miss of a club is said: one of the roster's, and League Foxes, which the page knows
    // from League Standings and the roster does not hold.
    expect(checks?.[1]?.notes[1]).toEqual({ kind: "similar", to: "Club C" });
    expect(checks?.[2]?.notes[1]).toEqual({ kind: "similar", to: "League Foxes" });
    // Without the season the page claims, nobody is called League Foxes.
    expect(answerQuery(CHECK, () => ({ teams: [], matchups: [], logs: {} }))).toMatchObject({
      checks: [{}, {}, { notes: [expect.anything(), null] }],
    });
    // No page, or no seasons read: nothing to say.
    expect(answerQuery({ ...CHECK, page: "gone" }, seasons)).toEqual({
      kind: "games.check",
      checks: null,
    });
    expect(answerQuery(CHECK)).toEqual({ kind: "games.check", checks: null });
  });

  it("is asked exactly, and its answer read back exactly", () => {
    expect(coerceQuery(JSON.parse(JSON.stringify(CHECK)))).toEqual(CHECK);
    for (const raw of [
      { ...CHECK, page: "" },
      { ...CHECK, games: [] },
      { ...CHECK, games: [{ id: "r1", teamA: "Club A" }] },
      { ...CHECK, extra: 1 },
    ])
      expect(coerceQuery(raw)).toBeNull();
    const answer = { kind: "games.check", checks: [{ notes: [null, null], logged: true }] };
    expect(coerceQueryAnswer(answer, "games.check")).toEqual(answer);
    expect(coerceQueryAnswer({ kind: "games.check", checks: null }, "games.check")).toEqual({
      kind: "games.check",
      checks: null,
    });
    expect(
      coerceQueryAnswer(
        { kind: "games.check", checks: [{ notes: [], logged: true }] },
        "games.check"
      )
    ).toBeNull();
  });
});

describe("a what-if as the server reads it", () => {
  const WHAT_IF: PoolQuery = {
    kind: "scouting.whatIf",
    page: "ag_10u_2027",
    segment: "spring",
    forTeamId: "A",
    game: { id: "1", teamAId: "A", teamBId: "C", ageGroupId: "ag_10u_2027", date: "2027-04-20" },
    today: "2027-04-15",
  };
  const CURVE = {
    gameId: "1",
    forTeamId: "A",
    points: [
      { margin: -1, rank: 3, rating: -0.5 },
      { margin: 1, rank: 1, rating: 0.75 },
    ],
    winRecord: "3-1",
    lossRecord: "2-2",
    rankedCount: 3,
  };

  it("is asked exactly, and refused inexactly", () => {
    expect(coerceQuery(JSON.parse(JSON.stringify(WHAT_IF)))).toEqual(WHAT_IF);
    expect(coerceQuery({ ...WHAT_IF, segment: null })).toEqual({ ...WHAT_IF, segment: null });
    const { game } = WHAT_IF as { game: Record<string, unknown> };
    for (const raw of [
      { ...WHAT_IF, extra: 1 },
      { ...WHAT_IF, segment: "summer" },
      { ...WHAT_IF, segment: undefined },
      { ...WHAT_IF, page: "" },
      { ...WHAT_IF, forTeamId: "" },
      { ...WHAT_IF, today: "2027-02-30" },
      { ...WHAT_IF, game: { ...game, extra: 1 } },
      { ...WHAT_IF, game: { ...game, teamAScore: "3" } },
      { ...WHAT_IF, game: null },
    ]) {
      expect(coerceQuery(raw)).toBeNull();
    }
  });

  it("is read back as sent, and refused with any part of its curve spoiled", () => {
    const drawn = { kind: "scouting.whatIf", curve: CURVE };
    expect(coerceQueryAnswer(drawn, "scouting.whatIf")).toEqual(drawn);
    expect(coerceQueryAnswer({ kind: "scouting.whatIf", curve: null }, "scouting.whatIf")).toEqual({
      kind: "scouting.whatIf",
      curve: null,
    });
    for (const curve of [
      { ...CURVE, gameId: "" },
      { ...CURVE, rankedCount: 1.5 },
      { ...CURVE, winRecord: 3 },
      { ...CURVE, points: [{ margin: 1, rank: -1, rating: 0 }] },
      { ...CURVE, points: [{ margin: 1, rank: 1 }] },
      { ...CURVE, points: "none" },
    ])
      expect(coerceQueryAnswer({ kind: "scouting.whatIf", curve }, "scouting.whatIf")).toBeNull();
    expect(coerceQueryAnswer({ kind: "scouting.whatIf" }, "scouting.whatIf")).toBeNull();
  });
});

describe("a model check as the server and a device read it", () => {
  const RUN: ScoutBacktestResult = {
    sampleSize: 40,
    meanAbsoluteError: 3.2,
    baselineError: 4.1,
    winnerAccuracy: 0.7,
    crossAgeSamples: 2,
    crossAgeError: null,
    fittedAgeGapRuns: 1.9,
    ageGapPrior: 2,
    recencyKey: "flat",
    cap: 12,
    buckets: [
      {
        fromDays: 0,
        toDays: 14,
        label: "0-14 days later",
        sampleSize: 30,
        meanAbsoluteError: 3,
        baselineError: 4,
        winnerAccuracy: 0.7,
      },
      {
        fromDays: 120,
        toDays: Infinity,
        label: "120+ days later",
        sampleSize: 10,
        meanAbsoluteError: null,
        baselineError: null,
        winnerAccuracy: null,
      },
    ],
    span: {
      trainFrom: "2026-09-01",
      trainTo: "2027-03-01",
      testFrom: "2027-03-02",
      testTo: "2027-04-01",
    },
    trainSize: 90,
    unratedSides: 1,
    ratedError: 3.1,
    ratedSamples: 38,
    meanAbsolutePrediction: 2.5,
    trainComponents: 1,
    largestComponent: 12,
    splitSamples: 0,
    residuals: [],
  };
  const ANSWER: ModelCheckAnswer = {
    result: RUN,
    gaps: [RUN, { ...RUN, ageGapPrior: 1.5 }],
    caps: [{ ...RUN, cap: Infinity }, RUN],
    betterGap: null,
    betterCap: { value: Infinity, by: 0.05, standardError: 0.01, samples: 40 },
  };
  const sent = () =>
    JSON.parse(JSON.stringify({ kind: "model.check", answer: ANSWER })) as {
      answer: { result: Record<string, unknown>; betterCap: Record<string, unknown> };
    };

  it("is asked of a page, and of nothing else", () => {
    expect(coerceQuery({ kind: "model.check", page: "ag_12u_2027" })).toEqual({
      kind: "model.check",
      page: "ag_12u_2027",
    });
    for (const raw of [
      { kind: "model.check" },
      { kind: "model.check", page: "" },
      { kind: "model.check", page: 12 },
      { kind: "model.check", page: "ag_12u_2027", extra: 1 },
    ])
      expect(coerceQuery(raw)).toBeNull();
  });

  it("reads back as worked out, every number with no end its own again", () => {
    const wire = sent();
    // JSON has no Infinity: each is null as sent.
    expect(wire.answer.betterCap.value).toBeNull();
    expect(coerceQueryAnswer(wire, "model.check")).toEqual({ kind: "model.check", answer: ANSWER });
    expect(coerceQueryAnswer({ kind: "model.check", answer: null }, "model.check")).toEqual({
      kind: "model.check",
      answer: null,
    });
    const gapBetter = {
      ...ANSWER,
      betterGap: { value: 1.5, by: 0.1, standardError: 0.02, samples: 38 },
    };
    expect(
      coerceQueryAnswer(
        JSON.parse(JSON.stringify({ kind: "model.check", answer: gapBetter })),
        "model.check"
      )
    ).toEqual({ kind: "model.check", answer: gapBetter });
  });

  it("is refused with any part of it spoiled", () => {
    const spoiled = (spoil: (wire: ReturnType<typeof sent>) => void) => {
      const wire = sent();
      spoil(wire);
      return coerceQueryAnswer(wire, "model.check");
    };
    expect(spoiled((wire) => (wire.answer.result.sampleSize = 1.5))).toBeNull();
    expect(spoiled((wire) => (wire.answer.result.cap = "12"))).toBeNull();
    expect(spoiled((wire) => (wire.answer.result.buckets = [{ fromDays: 0 }]))).toBeNull();
    expect(spoiled((wire) => (wire.answer.result.span = { trainFrom: "x" }))).toBeNull();
    expect(spoiled((wire) => (wire.answer.betterCap.by = null))).toBeNull();
    expect(spoiled((wire) => delete (wire.answer as Record<string, unknown>).gaps)).toBeNull();
    expect(coerceQueryAnswer({ kind: "model.check" }, "model.check")).toBeNull();
  });
});

describe("the copy's refresh as the Import tab asks for it", () => {
  const AT = "2027-04-15T16:00:00.000Z";
  const STATUS = { kind: "import.status", at: AT } as const;

  it("is asked at a time, and at nothing else", () => {
    expect(coerceQuery(JSON.parse(JSON.stringify(STATUS)))).toEqual(STATUS);
    for (const raw of [
      { kind: "import.status" },
      { kind: "import.status", at: "" },
      { kind: "import.status", at: "soon" },
      // Times `Date.parse` takes that no device's clock writes, one of which threw on the server.
      { kind: "import.status", at: "1" },
      { kind: "import.status", at: "Oct 4" },
      { kind: "import.status", at: "-271821-04-20T00:00:00Z" },
      { kind: "import.status", at: "2027-04-15T16:00:00Z" },
      { kind: "import.status", at: "1999-12-31T23:59:59.000Z" },
      { ...STATUS, today: "2027-04-15" },
    ])
      expect(coerceQuery(raw)).toBeNull();
  });

  it("is what the nightly would pull, when each level was refreshed, and the organizations kept", () => {
    saveScoutTeams([
      {
        id: "A",
        name: "Club A",
        gcTeams: [{ teamId: "gcA", name: "Club A", ageGroupId: "ag_10u_2027" }],
      },
      ...TEAMS.slice(1),
    ]);
    saveRefreshCadence("daily");
    // A level's day, another's, and a key that is no level, which says nothing.
    saveRefreshLog({ "10": "2027-04-14", "9": "2027-04-15", catchUp: "2027-04-10" });
    saveOrgMembership({
      orgs: [
        { orgId: "o1", name: "Placeholder 10U Spring 2027", teamIds: ["gcA", "gcW1"] },
        { orgId: "o2", name: "Placeholder Travel", teamIds: ["gcA"] },
      ],
      savedAt: "2027-04-01T00:00:00.000Z",
    });
    saveAgeUnknown([
      {
        teamId: "gcW1",
        name: "Placeholder W1",
        firstSeen: "2027-04-01T00:00:00.000Z",
        lastTried: "2027-04-08T00:00:00.000Z",
        tries: 1,
      },
      // Under no organization the file named.
      {
        teamId: "gcW2",
        name: "Placeholder W2",
        firstSeen: "2027-04-01T00:00:00.000Z",
        lastTried: "2027-04-08T00:00:00.000Z",
        tries: 1,
      },
    ]);
    const answer = answerQuery(STATUS);
    expect(answer).toEqual({
      kind: "import.status",
      due: dueSummary(storedRota(new Date(AT))),
      refreshed: [
        { level: 9, day: "2027-04-15" },
        { level: 10, day: "2027-04-14" },
      ],
      orgs: { orgs: 2, teams: 2, aged: 2, waitingAged: 1 },
    });
    expect(answer).toMatchObject({ due: { cadence: "daily", teams: 1 } });
    expect(coerceQueryAnswer(JSON.parse(JSON.stringify(answer)), "import.status")).toEqual(answer);
  });

  it("is refused with any part of it spoiled", () => {
    const answer = answerQuery(STATUS) as AnswerOf<"import.status">;
    const spoiled = (spoil: (copy: Record<string, Record<string, unknown>>) => void) => {
      const copy = JSON.parse(JSON.stringify(answer)) as Record<string, Record<string, unknown>>;
      spoil(copy);
      return coerceQueryAnswer(copy, "import.status");
    };
    expect(spoiled(() => undefined)).toEqual(answer);
    expect(spoiled((copy) => (copy.due!.cadence = "weekly"))).toBeNull();
    expect(spoiled((copy) => (copy.due!.teams = -1))).toBeNull();
    expect(spoiled((copy) => (copy.refreshed = [{ level: 9 }] as never))).toBeNull();
    expect(spoiled((copy) => delete copy.orgs!.waitingAged)).toBeNull();
  });
});

describe("an answer as a device reads one", () => {
  it("is a year's preview and the list of years exactly, and nothing of another shape", () => {
    const archive = {
      kind: "year.archivePreview",
      preview: {
        tables: [{ name: "9U · Fall 2025", rows: 3 }],
        droppedGames: 8,
        droppedTeams: 6,
        archivedLeagueGames: 0,
        unranked: [{ name: "8U 2026", games: 2 }],
      },
    };
    const remove = {
      kind: "year.deletePreview",
      preview: {
        pages: ["9U 2026"],
        droppedGames: 8,
        droppedTeams: 6,
        unlinkedTeams: 1,
        tables: 0,
        leagueSeasons: 1,
      },
    };
    const years = {
      kind: "year.list",
      years: [{ year: 2026, pages: 3, games: 8, teams: 7, archives: 0 }],
    };
    expect(coerceQueryAnswer(archive, "year.archivePreview")).toEqual(archive);
    expect(coerceQueryAnswer(remove, "year.deletePreview")).toEqual(remove);
    expect(coerceQueryAnswer(years, "year.list")).toEqual(years);
    for (const [raw, kind] of [
      [{ ...archive, preview: { ...archive.preview, droppedGames: -1 } }, "year.archivePreview"],
      [
        { ...archive, preview: { ...archive.preview, tables: [{ name: 9 }] } },
        "year.archivePreview",
      ],
      [{ ...remove, preview: { ...remove.preview, pages: [9] } }, "year.deletePreview"],
      [{ ...years, years: [{ year: 2026, pages: 3, games: 8, teams: 7 }] }, "year.list"],
      [years, "year.archivePreview"],
    ] as const) {
      expect([raw, coerceQueryAnswer(raw, kind)]).toEqual([raw, null]);
    }
  });

  it("is the answer exactly, of the kind it asked", () => {
    const merged = { kind: "merge.preview", found: true, games: 4, dropped: 2 };
    expect(coerceQueryAnswer(merged, "merge.preview")).toEqual(merged);
    const renamed = {
      kind: "rename.preview",
      name: "Club B",
      into: { id: "B", name: "Club B" },
      games: 4,
      dropped: 2,
    };
    expect(coerceQueryAnswer(renamed, "rename.preview")).toEqual(renamed);
    expect(coerceQueryAnswer({ ...renamed, into: null }, "rename.preview")).toEqual({
      ...renamed,
      into: null,
    });
  });

  it("is refused when it answers another question, or is not an answer's shape", () => {
    const merged = { kind: "merge.preview", found: true, games: 4, dropped: 2 };
    for (const [raw, kind] of [
      [merged, "rename.preview"],
      [{ ...merged, found: "yes" }, "merge.preview"],
      [{ ...merged, games: -1 }, "merge.preview"],
      [{ ...merged, dropped: 5 }, "merge.preview"],
      [{ ...merged, games: 1.5 }, "merge.preview"],
      [
        { kind: "rename.preview", name: "X", into: { id: "" }, games: 0, dropped: 0 },
        "rename.preview",
      ],
      [{ kind: "rename.preview", into: null, games: 0, dropped: 0 }, "rename.preview"],
      [null, "merge.preview"],
    ] as const) {
      expect(coerceQueryAnswer(raw, kind)).toBeNull();
    }
  });
});

describe("what Pool health asks of the server's pool", () => {
  const TODAY = "2026-09-27";
  const PAGES: AgeGroup[] = [
    { id: "ag9", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: [] },
    { id: "ag10", name: "10U 2027", ageLevel: 10, year: 2027, seasonIds: [] },
  ];
  type Link = NonNullable<ScoutTeam["gcTeams"]>[number];
  const pulled = (id: string, name: string, link: Partial<Link> = {}): ScoutTeam => ({
    id,
    name,
    city: "Sampleton",
    state: "NJ",
    gcTeams: [{ teamId: `gc${id}`, name, ageGroupId: "ag9", ageLevel: 9, ...link }],
  });
  const at10 = { ageGroupId: "ag10", ageLevel: 10 };
  const fall = { season: "fall", seasonYear: 2026, staff: ["Ezra Sampleby", "Fable Sampleton"] };
  const CLUBS: ScoutTeam[] = [
    // One squad on GameChanger twice: both post the same games.
    pulled("GRN", "Placeholder Green"),
    pulled("CUBS", "Placeholder Cubs"),
    pulled("BULL", "Placeholder Bulldogs"),
    pulled("HAWK", "Placeholder Hawks"),
    // Known only from the Hawks' schedule, and six more from the Ambush's: more to pull than drawn.
    { id: "S-OWLS", name: "Placeholder Owls", nameOnly: true },
    ...[1, 2, 3, 4, 5, 6].map((at): ScoutTeam => ({
      id: `S-${at}`,
      name: `Placeholder ${at}`,
      nameOnly: true,
    })),
    // One roster listed twice in a season by the same coaches, one entry with no schedule.
    pulled("SHELL", "Placeholder Ambush 9U", fall),
    pulled("REAL", "Placeholder Ambush 9U", fall),
    // Filed at 9U under a name saying 10U, and playing 10U clubs.
    pulled("LARK", "Placeholder Larks 10U"),
    pulled("X10", "Placeholder X", at10),
    pulled("Y10", "Placeholder Y", at10),
  ];
  let serial = 0;
  /** A row of `clubId`'s own schedule, its score first. */
  const row = (
    clubId: string,
    against: string,
    date: string,
    clock: string,
    score: [number, number]
  ): ScoutGame => {
    serial += 1;
    return {
      id: `gc_gc${clubId}_${serial}`,
      teamAId: clubId,
      teamBId: against,
      teamAScore: score[0],
      teamBScore: score[1],
      ageGroupId: "ag9",
      date,
      startTs: `${date}T${clock}:00.000Z`,
      source: { kind: "gamechanger", teamId: `gc${clubId}`, gameId: String(serial) },
    };
  };
  const ROWS: ScoutGame[] = [
    row("GRN", "BULL", "2026-09-19", "14:00", [4, 7]),
    row("CUBS", "BULL", "2026-09-19", "14:00", [4, 7]),
    row("GRN", "HAWK", "2026-09-19", "17:00", [9, 1]),
    row("CUBS", "HAWK", "2026-09-19", "17:00", [9, 1]),
    row("HAWK", "S-OWLS", "2026-09-19", "19:00", [3, 2]),
    row("REAL", "BULL", "2026-09-13", "10:00", [5, 4]),
    ...[1, 2, 3, 4, 5, 6].map((at) => row("REAL", `S-${at}`, `2026-08-0${at}`, "10:00", [at, 0])),
    row("LARK", "X10", "2026-09-20", "10:00", [3, 5]),
    row("LARK", "Y10", "2026-09-20", "13:00", [2, 8]),
    // Scored on a day still to come, and won by forty.
    row("HAWK", "BULL", "2026-10-03", "10:00", [6, 5]),
    row("BULL", "HAWK", "2026-09-12", "10:00", [40, 0]),
  ];
  const POOL: GcImportState = { ageGroups: PAGES, teams: CLUBS, games: ROWS };

  // A store of this pool alone: saving it over the one above would keep that one's games.
  beforeEach(async () => {
    resetTeamRankingsStore();
    await initTeamRankingsStore(memoryIo());
    saveAgeGroups(PAGES);
    saveScoutTeams(CLUBS);
    saveScoutGames(ROWS);
  });

  /** `query`'s answer, as the kind it asked. */
  const asked = <K extends QueryKind>(query: Extract<PoolQuery, { kind: K }>): AnswerOf<K> => {
    const answer = answerQuery(query);
    if (answer.kind !== query.kind) throw new Error(`answered ${answer.kind}`);
    return answer as unknown as AnswerOf<K>;
  };

  /** What the tidy worker answers when the page asks it to look harder at the same pool. */
  const inspectedByWorker = () => {
    const posted: WorkerResponse[] = [];
    createTidyHandler((response) => posted.push(response))({
      kind: "inspect",
      id: 1,
      state: packPool(POOL),
      stamp: loadTidyStamp() ?? "",
      today: TODAY,
      apart: keptApartList(loadKeptApart()),
    });
    const answer = posted[0];
    if (answer?.kind !== "inspect") throw new Error("no inspection");
    const { health, settleable, lists } = answer;
    // Of the clubs worth pulling, the ones the card draws, and how many there are.
    return {
      health,
      settleable,
      lists: { ...lists, toPull: lists.toPull.slice(0, TO_PULL_DRAWN) },
      toPullCount: lists.toPull.length,
    };
  };

  it("opens on what the page's own card works out, with the answers its lists leave out", () => {
    saveRealClubs(new Set(["gcHAWK"]));
    saveAgeRightClubs(new Set(["gcLARK"]));
    saveKeptApart(new Set([apartKey("gcGRN", "gcCUBS")]));
    const answer = asked({ kind: "health.summary", today: TODAY });
    expect(answer).toEqual({
      kind: "health.summary",
      summary: poolHealthSummary(POOL, TODAY, storedGamesByYear()),
      answers: {
        ageRight: ["gcLARK"],
        realClubs: ["gcHAWK"],
        keptApart: [apartKey("gcGRN", "gcCUBS")],
      },
    });
    // The fixture is worth something: a row ahead, a rout, and the clubs they belong to.
    expect([answer.summary.datedAhead.length, answer.summary.implausible.length]).toEqual([1, 1]);
    expect(answer.summary.suspected.length).toBeGreaterThan(0);
  });

  it("reads back as the callable sends it, a page with no year and a score in halves among it", () => {
    // A page whose year is in no name, and a game typed by hand at a half-run score, ahead of today.
    const OLD: AgeGroup = { id: "ag_old", name: "Placeholder Old", ageLevel: 9, seasonIds: [] };
    saveAgeGroups([...PAGES, OLD]);
    saveScoutGames([
      ...ROWS,
      {
        id: "scout_half",
        teamAId: "BULL",
        teamBId: "HAWK",
        teamAScore: 2.5,
        teamBScore: 1,
        ageGroupId: "ag9",
        date: "2026-10-04",
      },
      { id: "scout_old", teamAId: "BULL", teamBId: "HAWK", ageGroupId: "ag_old" },
    ]);
    const answer = asked({ kind: "health.summary", today: TODAY });
    expect(answer.summary.holdings.some(({ year }) => year === undefined)).toBe(true);
    expect(answer.summary.datedAhead.map(({ id }) => id)).toContain("scout_half");
    // The page's year that is none goes as null unless the reply is written as JSON first.
    expect(coerceQueryAnswer(callableEncode(answer), "health.summary")).toBeNull();
    expect(coerceQueryAnswer(callableEncode(asJson(answer)), "health.summary")).toEqual(answer);
  });

  it("looks harder as the tidy worker does, against the copy's own tidy stamp", () => {
    saveTidyStamp(poolSignature(POOL));
    const answer = asked({ kind: "health.inspect", today: TODAY });
    expect(answer).toEqual({ kind: "health.inspect", ...inspectedByWorker() });
    expect(answer.health.tidied).toBe(true);
    // Every list holds something, so each is worth reading back below.
    expect(Object.entries(answer.lists).filter(([, list]) => list.length === 0)).toEqual([]);
    // More clubs to pull than the card draws, of which only those are sent.
    expect([answer.lists.toPull.length, answer.toPullCount]).toEqual([TO_PULL_DRAWN, 7]);
  });

  it("sends every club worth pulling as the card's file, when asked for it", () => {
    expect(asked({ kind: "health.toPull" })).toEqual({
      kind: "health.toPull",
      csv: unpulledClubsCsv(unpulledClubs(POOL)),
    });
    expect(asked({ kind: "health.toPull" }).csv.split("\n")).toHaveLength(1 + 7);
  });

  it("leaves a pair the answers keep apart off its lists, as the worker does", () => {
    saveKeptApart(new Set([apartKey("gcGRN", "gcCUBS")]));
    const answer = asked({ kind: "health.inspect", today: TODAY });
    expect(answer.lists.twins).toEqual([]);
    expect(answer).toEqual({ kind: "health.inspect", ...inspectedByWorker() });
  });

  it("plans the ages approved together as the page plans them, for one edit", () => {
    const clubs = [
      { teamId: "LARK", level: 10, year: 2027 },
      // A club with no GameChanger link cannot move, and is counted out.
      { teamId: "S-OWLS", level: 9, year: 2027 },
    ];
    const when = "2026-09-27T12:00:00.000Z";
    const answer = asked({ kind: "ages.plan", clubs, at: when, base: "ag_new" });
    expect(answer).toEqual({
      kind: "ages.plan",
      ...planClubAges({ teams: CLUBS, games: ROWS, ageGroups: PAGES }, clubs, when, "ag_new"),
    });
    expect(answer).toMatchObject({ changedTeamIds: ["LARK"], failed: 1 });
  });

  describe("asked", () => {
    it("is read back exactly", () => {
      for (const query of [
        { kind: "health.summary", today: TODAY },
        { kind: "health.inspect", today: "2028-02-29" },
        {
          kind: "ages.plan",
          clubs: [{ teamId: "LARK", level: 10, year: 2027 }],
          at: "2026-09-27T12:00:00.000Z",
          base: "ag_new",
        },
        { kind: "ages.plan", clubs: [], at: "2026-09-27T12:00:00.000Z", base: "ag_new" },
        { kind: "health.toPull" },
      ] as const) {
        expect(coerceQuery(JSON.parse(JSON.stringify(query)))).toEqual(query);
      }
    });

    it("is refused on a day the calendar lacks, a club asked oddly, or a field it does not read", () => {
      const plan = {
        kind: "ages.plan",
        clubs: [{ teamId: "LARK", level: 10, year: 2027 }],
        at: "2026-09-27T12:00:00.000Z",
        base: "ag_new",
      };
      for (const raw of [
        { kind: "health.summary" },
        { kind: "health.summary", today: "2026-9-27" },
        { kind: "health.summary", today: "2026-02-30" },
        { kind: "health.inspect", today: "2026-13-01" },
        { kind: "health.inspect", today: 20260927 },
        { kind: "health.inspect", today: TODAY, apart: [] },
        { kind: "health.toPull", today: TODAY },
        { ...plan, clubs: [{ teamId: "LARK", level: 10.5, year: 2027 }] },
        { ...plan, clubs: [{ teamId: "LARK", level: 10 }] },
        { ...plan, clubs: [{ teamId: "", level: 10, year: 2027 }] },
        { ...plan, clubs: [{ teamId: "LARK", level: 10, year: 2027, why: "name" }] },
        { ...plan, clubs: "LARK" },
        { ...plan, at: "soon" },
        { ...plan, base: "" },
        { ...plan, extra: true },
      ]) {
        expect([raw, coerceQuery(raw)]).toEqual([raw, null]);
      }
    });
  });

  describe("answered", () => {
    type Path = ReadonlyArray<string | number>;
    /** A copy of `value` as sent, with the field at `path` made `to`. */
    const changed = (value: unknown, path: Path, to: unknown): unknown => {
      const copy = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
      let at = copy;
      for (const key of path.slice(0, -1)) at = at[key] as Record<string, unknown>;
      at[path[path.length - 1]!] = to;
      return copy;
    };
    const sent = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

    it("is read back as sent, each kind, and a field a newer server adds is let be", () => {
      saveTidyStamp(poolSignature(POOL));
      const opened = asked({ kind: "health.summary", today: TODAY });
      expect(coerceQueryAnswer(sent(opened), "health.summary")).toEqual(opened);
      expect(coerceQueryAnswer({ ...opened, newer: 1 }, "health.summary")).toEqual({
        ...opened,
        newer: 1,
      });
      const inspected = asked({ kind: "health.inspect", today: TODAY });
      expect(coerceQueryAnswer(sent(inspected), "health.inspect")).toEqual(inspected);
      const plan = asked({
        kind: "ages.plan",
        clubs: [{ teamId: "LARK", level: 10, year: 2027 }],
        at: "2026-09-27T12:00:00.000Z",
        base: "ag_new",
      });
      expect(plan.commands).toHaveLength(1);
      expect(coerceQueryAnswer(sent(plan), "ages.plan")).toEqual(plan);
      const file = asked({ kind: "health.toPull" });
      expect(coerceQueryAnswer(sent(file), "health.toPull")).toEqual(file);
      // An answer to another question is none.
      expect(coerceQueryAnswer(sent(opened), "health.inspect")).toBeNull();
      expect(coerceQueryAnswer(sent(plan), "health.summary")).toBeNull();
    });

    it("is refused whole when any field it names is not of its kind", () => {
      saveTidyStamp(poolSignature(POOL));
      const opened = asked({ kind: "health.summary", today: TODAY });
      const inspected = asked({ kind: "health.inspect", today: TODAY });
      const plan = asked({
        kind: "ages.plan",
        clubs: [{ teamId: "LARK", level: 10, year: 2027 }],
        at: "2026-09-27T12:00:00.000Z",
        base: "ag_new",
      });
      const spoiled: Array<[QueryKind, unknown, Path, unknown]> = [
        ["health.summary", opened, ["summary"], null],
        ["health.summary", opened, ["summary", "datedAhead", 0, "year"], "2027"],
        ["health.summary", opened, ["summary", "datedAhead", 0, "filers"], ["HAWK", ""]],
        ["health.summary", opened, ["summary", "implausible", 0, "margin"], null],
        ["health.summary", opened, ["summary", "implausible", 0, "game", "teamAScore"], "40"],
        ["health.summary", opened, ["summary", "suspected", 0, "gameIds"], "all"],
        ["health.summary", opened, ["summary", "clubs", "HAWK", "name"], 5],
        ["health.summary", opened, ["summary", "holdings", 0, "emptied"], "no"],
        ["health.summary", opened, ["answers", "realClubs"], "gcHAWK"],
        ["health.inspect", inspected, ["health", "games"], -1],
        ["health.inspect", inspected, ["health", "tidied"], "yes"],
        ["health.inspect", inspected, ["settleable"], 1.5],
        ["health.inspect", inspected, ["toPullCount"], -1],
        ["health.inspect", inspected, ["lists", "toPull", 0, "levels"], ["9"]],
        ["health.inspect", inspected, ["lists", "duplicates", 0, "evidence", 0], "vibes"],
        ["health.inspect", inspected, ["lists", "duplicates", 0, "confidence"], "certain"],
        ["health.inspect", inspected, ["lists", "twins", 0, "shared", 0, "ownScore"], "4"],
        ["health.inspect", inspected, ["lists", "twins", 0, "fromRecord"], { win: 1 }],
        ["health.inspect", inspected, ["lists", "twice", 0, "games", 0, "startTs"], 0],
        ["health.inspect", inspected, ["lists", "wrongAge", 0, "reason"], "height"],
        ["health.inspect", inspected, ["lists", "wrongAge"], null],
        ["ages.plan", plan, ["commands", 0, "kind"], "club.ages"],
        ["ages.plan", plan, ["commands"], "all"],
        ["ages.plan", plan, ["changedTeamIds", 0], ""],
        ["ages.plan", plan, ["moved"], -1],
        ["ages.plan", plan, ["failed"], "1"],
        ["health.toPull", { kind: "health.toPull", csv: "x" }, ["csv"], 5],
      ];
      for (const [kind, answer, path, to] of spoiled) {
        expect([path, coerceQueryAnswer(changed(answer, path, to), kind)]).toEqual([path, null]);
      }
    });
  });
});

describe("what the card of teams waiting on an age asks of the server's pool", () => {
  const TODAY = "2026-09-27";
  const waiting = (teamId: string, name: string, games = 2): AgeUnknownTeam => ({
    teamId,
    name,
    firstSeen: "2026-09-01T00:00:00.000Z",
    lastTried: `2026-09-${String(10 + (teamId.length % 9)).padStart(2, "0")}T00:00:00.000Z`,
    tries: 1,
    evidence: {
      games,
      scored: games,
      aheadOfToday: 0,
      shutoutBlowouts: 0,
      opponents: games,
      namedAnAge: 0,
      tally: [],
      state: "OH",
    },
  });
  const LIST: AgeUnknownTeam[] = [
    waiting("gcVOID", "Placeholder VOID do not use"),
    // More than the search shows at once (`AGELESS_HITS`).
    ...Array.from({ length: 26 }, (_, at) => waiting(`gcQ${at}`, `Placeholder Q${at}`, at)),
    waiting("gcNAMED", "Placeholder Named"),
    waiting("gcDROPPED", "Placeholder Dropped"),
  ];
  const NAMED = new Map([
    ["gcNAMED", { teamId: "gcNAMED", level: 10, namedAt: "2026-09-20T00:00:00.000Z" }],
  ]);
  const DROPPED = new Set(["gcDROPPED"]);
  const now = new Date(TODAY);

  beforeEach(() => {
    saveAgeUnknown(LIST);
    saveNamedAges(NAMED);
    saveDroppedClubs(DROPPED);
  });

  const asked = <K extends QueryKind>(query: Extract<PoolQuery, { kind: K }>): AnswerOf<K> => {
    const answer = answerQuery(query);
    if (answer.kind !== query.kind) throw new Error(`answered ${answer.kind}`);
    return answer as unknown as AnswerOf<K>;
  };

  it("hands over the card at a sitting as the device's own card works it out, the rows as entries", () => {
    const sitting = agelessSitting(LIST, NAMED, DROPPED, now, []);
    const answer = asked({ kind: "ageless.queue", today: TODAY, pinned: [] });
    expect(answer).toEqual({
      kind: "ageless.queue",
      listed: 29,
      waiting: sitting.waiting,
      batch: sitting.batch.map((row) => row.entry),
      groups: sitting.groups,
    });
    // Worth something: a full ten from more waiting than that, and a rule's rows to clear.
    expect([answer.batch.length, answer.waiting]).toEqual([10, 27]);
    expect(answer.groups.map(({ rule, count }) => [rule.id, count])).toEqual([["void-name", 1]]);
    // The ten the device holds stay in front of the person, less the ones answered.
    const pinned = asked({ kind: "ageless.queue", today: TODAY, pinned: ["gcQ3", "gcNAMED"] });
    expect(pinned.batch.map((entry) => entry.teamId)).toEqual(["gcQ3"]);
  });

  it("finds a team on the whole list by name, and says what stands between it and the queue", () => {
    const answer = asked({ kind: "ageless.search", today: TODAY, query: "placeholder" });
    const found = agelessSearch(LIST, NAMED, DROPPED, now, "placeholder");
    expect(answer).toEqual({
      kind: "ageless.search",
      total: found.total,
      hits: found.hits.map(({ row, aside }) => ({ entry: row.entry, ...(aside ? { aside } : {}) })),
    });
    expect(answer.total).toBeGreaterThan(answer.hits.length);
    const named = asked({ kind: "ageless.search", today: TODAY, query: "placeholder named" });
    expect(named.hits).toEqual([
      { entry: LIST.find((one) => one.teamId === "gcNAMED"), aside: "named" },
    ]);
  });

  it("sends the file of every team waiting, and plans a pass over the rules ticked", () => {
    const rows = agelessWaiting(LIST, NAMED, DROPPED, now).map((row) => row.entry);
    expect(asked({ kind: "ageless.file", today: TODAY })).toEqual({
      kind: "ageless.file",
      csv: agelessCsvParts(rows).join(""),
    });
    const plan = asked({ kind: "ageless.clearPlan", today: TODAY, rules: ["void-name"] });
    expect(plan).toEqual({
      kind: "ageless.clearPlan",
      ...agelessClearPlan(agelessClearable(rows), new Set(["void-name"])),
    });
    expect(plan.teamIds).toEqual(["gcVOID"]);
    expect(asked({ kind: "ageless.clearPlan", today: TODAY, rules: ["tee-ball"] })).toMatchObject({
      teamIds: [],
      byRule: [],
    });
  });

  it("is asked exactly, and refused inexactly", () => {
    for (const query of [
      { kind: "ageless.queue", today: TODAY, pinned: ["gcQ1"] },
      { kind: "ageless.search", today: TODAY, query: "" },
      { kind: "ageless.file", today: TODAY },
      { kind: "ageless.clearPlan", today: TODAY, rules: ["void-name"] },
    ] as const) {
      expect(coerceQuery(JSON.parse(JSON.stringify(query)))).toEqual(query);
    }
    for (const raw of [
      { kind: "ageless.queue", today: TODAY },
      { kind: "ageless.queue", today: TODAY, pinned: [""] },
      { kind: "ageless.search", today: TODAY, query: 5 },
      { kind: "ageless.file", today: "today" },
      { kind: "ageless.clearPlan", today: TODAY, rules: "void-name" },
      { kind: "ageless.file", today: TODAY, all: true },
    ]) {
      expect([raw, coerceQuery(raw)]).toEqual([raw, null]);
    }
  });

  it("is read back as sent, and refused whole with any part spoiled", () => {
    const sent = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
    const queue = asked({ kind: "ageless.queue", today: TODAY, pinned: [] });
    expect(coerceQueryAnswer(sent(queue), "ageless.queue")).toEqual(queue);
    const search = asked({ kind: "ageless.search", today: TODAY, query: "placeholder" });
    expect(coerceQueryAnswer(sent(search), "ageless.search")).toEqual(search);
    const file = asked({ kind: "ageless.file", today: TODAY });
    expect(coerceQueryAnswer(sent(file), "ageless.file")).toEqual(file);
    const plan = asked({ kind: "ageless.clearPlan", today: TODAY, rules: ["void-name"] });
    expect(coerceQueryAnswer(sent(plan), "ageless.clearPlan")).toEqual(plan);
    const entry = queue.batch[0]!;
    for (const [raw, kind] of [
      [{ ...queue, batch: [{ ...entry, tries: "1" }] }, "ageless.queue"],
      [{ ...queue, batch: [{ ...entry, mood: 1 }] }, "ageless.queue"],
      [{ ...queue, waiting: -1 }, "ageless.queue"],
      [
        { ...queue, groups: [{ rule: { id: "void-name" }, count: 1, examples: [] }] },
        "ageless.queue",
      ],
      [{ ...search, hits: [{ entry, aside: "elsewhere" }] }, "ageless.search"],
      [{ ...search, total: 0 }, "ageless.search"],
      [{ ...file, csv: null }, "ageless.file"],
      [{ ...plan, teamIds: [""] }, "ageless.clearPlan"],
      [{ ...plan, byRule: [{ label: "x", count: -1 }] }, "ageless.clearPlan"],
      [queue, "ageless.search"],
    ] as const) {
      expect([raw, coerceQueryAnswer(raw, kind)]).toEqual([raw, null]);
    }
  });
});
