import { describe, expect, it } from "vitest";
import { parseGcTeamList, type GcTeamSchedule } from "../gameChangerApi";
import {
  describeTidy,
  dropNotATeam,
  importGcSchedule,
  TIDY_STEPS,
  tidyPool,
  type GcImportState,
} from "../gameChangerImport";
import { collectGcImportProblems } from "../gameChangerReport";
import { filingProblems } from "../cloud/importReports";
import { updateAgeUnknown } from "../ageUnknown";
import { unpulledClubs } from "../unpulledClubs";
import type { AgeGroup, GcTeamLink, ScoutGame, ScoutTeam } from "../teamRankings";

/*
 * A page whose name says it is no team — a practice, a scrimmage, a test, an old page marked do not
 * use — refused at the door, kept out of a game on another club's schedule, and deleted from a
 * pool it reached before the rule. Every name is invented; none is a club in the export or the
 * pool.
 */

const empty: GcImportState = { ageGroups: [], teams: [], games: [] };

const schedule = (
  overrides: Partial<GcTeamSchedule["profile"]> = {},
  games: GcTeamSchedule["games"] = []
): GcTeamSchedule => ({
  profile: {
    id: "gcQUILL00001",
    name: "Quillfeather Quails 12U",
    ageLevel: 12,
    season: { season: "fall", year: 2026 },
    ...overrides,
  },
  games,
  fetchedAt: "2026-10-01T12:00:00.000Z",
});

const played = (id: string, opponentName: string, date = "2026-09-12") => ({
  id,
  date,
  opponentName,
  teamScore: 6,
  opponentScore: 2,
  status: "completed" as const,
});

describe("a page whose name says it is no team, at the door", () => {
  it("is refused, the pool handed back as it came, and the word it was refused on named", () => {
    const { state, outcome } = importGcSchedule(
      schedule({ id: "gcCOPPE00001", name: "Copperfield Scrimmage 12U" }, [played("c1", "Elm")]),
      empty,
      { today: "2026-10-11" }
    );
    expect(outcome.skip).toBe("not-a-team");
    expect(outcome.issue).toBe(
      "This page's name says it is not a real team (a practice, scrimmage, test or placeholder " +
        "page, or one marked do not use), so it was left out. Its name says “Scrimmage”."
    );
    expect(state).toBe(empty);
  });

  it("is refused whose age is perfectly good, GameChanger's field and the name agreeing", () => {
    // Which is the whole problem: filed under 12U, it looks like any other 12U club.
    const { outcome } = importGcSchedule(
      schedule({ id: "gcTHORN00001", name: "Thornbury Practice 12U", ageLabel: "12U" }, [
        played("t1", "Quillfeather Quails 12U"),
      ]),
      empty,
      { today: "2026-10-11" }
    );
    expect(outcome.skip).toBe("not-a-team");
  });

  it("is refused rather than asked about again when nobody could age it", () => {
    // A refusal other than "no age" takes a team off the waiting list (`updateAgeUnknown`).
    const { outcome } = importGcSchedule(
      schedule({ id: "gcWEXCO00001", name: "Wexcombe Tryouts", ageLevel: undefined }, [
        played("w1", "Nobody In Particular"),
      ]),
      empty,
      { today: "2026-10-11" }
    );
    expect(outcome.skip).toBe("not-a-team");
    const waiting = [
      {
        teamId: "gcWEXCO00001",
        name: "Wexcombe Tryouts",
        firstSeen: "2026-09-01T00:00:00.000Z",
        lastTried: "2026-09-10T00:00:00.000Z",
        tries: 1,
      },
    ];
    expect(updateAgeUnknown(waiting, [outcome], "2026-10-11T00:00:00.000Z")).toEqual([]);
  });

  it("is a wiffle or softball team first, where its name says both", () => {
    const { outcome } = importGcSchedule(
      schedule({ id: "gcGILDE00001", name: "Gildersleeve Softball Practice 12U" }),
      empty,
      { today: "2026-10-11" }
    );
    expect(outcome.skip).toBe("not-baseball");
    expect(outcome.issue).toBe(
      "This is a wiffle ball, blitzball or softball team, which is a different game, so it was left out."
    );
  });

  it("is filed where the word belongs to a squad the rule leaves alone", () => {
    const { outcome } = importGcSchedule(
      schedule({ id: "gcKESTR00001", name: "Test Red Kestrelmoor 12U" }, [played("k1", "Elm")]),
      empty,
      { today: "2026-10-11" }
    );
    expect(outcome.skip).toBeUndefined();
    expect(outcome.gamesAdded).toBe(1);
  });

  it("is named on the list of teams not imported, and in the members' report", () => {
    const { outcome } = importGcSchedule(
      schedule({ id: "gcHOLLO00001", name: "Hollowmere Hornets DNU" }),
      empty,
      { today: "2026-10-11" }
    );
    const [listed] = collectGcImportProblems([], [outcome]);
    expect(listed).toMatchObject({ kind: "not-filed", reason: "Not a team, by its name" });
    expect(listed?.detail).toContain("Its name says “DNU”.");
    expect(filingProblems([outcome])[0]).toMatchObject({ reason: "not a team" });
  });
});

describe("a club the owner vouched for, whose name reads as no team", () => {
  // A squad whose GameChanger name happens to read as a tryout, kept by the owner's word on it.
  const WEX = "gcWEXCO00001";
  const workouts = (games: GcTeamSchedule["games"]) =>
    schedule({ id: WEX, name: "Wexcombe Workouts 12U" }, games);
  /** The club in the pool, pulled once with the owner's word given, and one game of it filed. */
  const held = importGcSchedule(workouts([played("w1", "Brindlewood Badgers 12U")]), empty, {
    today: "2026-10-11",
    realClubs: new Set([WEX]),
  }).state;
  const again = workouts([
    played("w1", "Brindlewood Badgers 12U"),
    played("w2", "Copperfield Cubs 12U", "2026-09-13"),
  ]);
  const clubId = held.teams.find((team) => team.gcTeams?.length)!.id;

  it("is refused at the door with no word given for it", () => {
    const { outcome } = importGcSchedule(again, held, { today: "2026-10-11" });
    expect(outcome.skip).toBe("not-a-team");
  });

  it("is pulled again when it is on the real list, by GameChanger id or club id", () => {
    [WEX, clubId].forEach((id) => {
      const { outcome } = importGcSchedule(again, held, {
        today: "2026-10-11",
        realClubs: new Set([id]),
      });
      expect(outcome.skip).toBeUndefined();
      expect(outcome.gamesAdded).toBe(1);
    });
    // Or by another GameChanger id of the same club.
    const twoLinks: GcImportState = {
      ...held,
      teams: held.teams.map((team) =>
        team.id === clubId
          ? {
              ...team,
              gcTeams: [...team.gcTeams!, { ...team.gcTeams![0]!, teamId: "gcWEXCO00002" }],
            }
          : team
      ),
    };
    const byOther = importGcSchedule(again, twoLinks, {
      today: "2026-10-11",
      realClubs: new Set(["gcWEXCO00002"]),
    });
    expect(byOther.outcome.gamesAdded).toBe(1);
    // And a GameChanger id the pool holds no club of yet, a pool started again since it was said.
    const fresh = importGcSchedule(again, empty, {
      today: "2026-10-11",
      realClubs: new Set([WEX]),
    });
    expect(fresh.outcome.skip).toBeUndefined();
  });

  it("is refused for what else is wrong with it, not for its name", () => {
    // No age anywhere: the word is no reason the owner's word leaves, so the age is the reason.
    const { outcome } = importGcSchedule(
      schedule({ id: WEX, name: "Wexcombe Workouts", ageLevel: undefined }, [
        played("w3", "Nobody In Particular"),
      ]),
      held,
      { today: "2026-10-11", realClubs: new Set([WEX]) }
    );
    expect(outcome.skip).toBe("no-age");
  });

  it("is pulled again as the user's own club or a page's own team", () => {
    const mine = {
      ...held,
      teams: held.teams.map((t) => (t.id === clubId ? { ...t, isMine: true as const } : t)),
    };
    expect(importGcSchedule(again, mine, { today: "2026-10-11" }).outcome.gamesAdded).toBe(1);
    const page = { ...held, ageGroups: held.ageGroups.map((g) => ({ ...g, myTeamId: clubId })) };
    expect(importGcSchedule(again, page, { today: "2026-10-11" }).outcome.gamesAdded).toBe(1);
  });

  /** The game holding the Quails' own row `q1`, whether filed as its own or folded into a copy. */
  const holding = (state: GcImportState) =>
    state.games.find(
      (game) =>
        game.id === "gc_gcQUILL00001_q1" ||
        (game.alsoRows ?? []).some((row) => row.teamId === "gcQUILL00001" && row.gameId === "q1")
    );
  /** `name`'s club pulled with the owner's word on it, its game that day against the Quails. */
  const vouchedPool = (id: string, name: string) => {
    const state = importGcSchedule(
      schedule({ id, name }, [played("v1", "Quillfeather Quails 12U")]),
      empty,
      { today: "2026-10-11", realClubs: new Set([id]) }
    ).state;
    return { state, club: state.teams.find((team) => team.gcTeams?.length)!.id };
  };
  const quails = (opponent: string) => schedule({}, [played("q1", opponent)]);

  it("is the club another schedule's row of its name is filed against, not a game dropped", () => {
    const { state, club } = vouchedPool(WEX, "Wexcombe Workouts 12U");
    const vouched = importGcSchedule(quails("Wexcombe Workouts 12U"), state, {
      today: "2026-10-11",
      realClubs: new Set([WEX]),
    });
    expect(vouched.outcome.gamesIgnored).toBe(0);
    const game = holding(vouched.state);
    expect([game?.teamAId, game?.teamBId]).toContain(club);
    // With no word given, the row is a tryout's and goes.
    const unsaid = importGcSchedule(quails("Wexcombe Workouts 12U"), state, {
      today: "2026-10-11",
    });
    expect(unsaid.outcome).toMatchObject({ gamesAdded: 0, gamesIgnored: 1 });
    expect(holding(unsaid.state)).toBeUndefined();
  });

  it("lets a row through only where the club's own names carry the word the row hit", () => {
    const TAMB = "gcTAMBE00001";
    const opts = { today: "2026-10-11", realClubs: new Set([TAMB]) };
    // A plain club, playing somebody else that day, then not playing at all: the bracket is the
    // row's own word, a scrimmage, though the row keys as the club.
    const tigers = importGcSchedule(
      schedule({ id: TAMB, name: "Tamberlane Tigers 12U" }, [
        played("t1", "Brindlewood Badgers 12U"),
      ]),
      empty,
      opts
    ).state;
    ["2026-09-12", "2026-09-19"].forEach((day) => {
      const pulled = importGcSchedule(
        schedule({}, [played("q1", "Tamberlane Tigers 12U (Scrimmage)", day)]),
        tigers,
        opts
      );
      expect(pulled.outcome).toMatchObject({
        gamesAdded: 0,
        gamesIgnored: 1,
        opponentsCreated: 0,
      });
      expect(holding(pulled.state)).toBeUndefined();
    });
    // A club whose own GameChanger name has the bracket: the row names that very page.
    const page = vouchedPool(TAMB, "Tamberlane Tigers 12U (Practice)");
    const named = importGcSchedule(quails("Tamberlane Tigers 12U (Practice)"), page.state, opts);
    expect(named.outcome.gamesIgnored).toBe(0);
    const onPage = holding(named.state);
    expect([onPage?.teamAId, onPage?.teamBId]).toContain(page.club);
    // And a club whose links carry no name, by the name it is stored under.
    const { state, club } = vouchedPool(WEX, "Wexcombe Workouts 12U");
    const blank: GcImportState = {
      ...state,
      teams: state.teams.map((team) =>
        team.id === club
          ? { ...team, gcTeams: team.gcTeams!.map((link) => ({ ...link, name: "" })) }
          : team
      ),
    };
    const stored = importGcSchedule(quails("Wexcombe Workouts 12U"), blank, {
      today: "2026-10-11",
      realClubs: new Set([WEX]),
    });
    expect(stored.outcome.gamesIgnored).toBe(0);
    const onClub = holding(stored.state);
    expect([onClub?.teamAId, onClub?.teamBId]).toContain(club);
  });
});

describe("a game against a page whose name says it is no team", () => {
  it("goes, where the name is a practice, a scrimmage or a squad playing itself", () => {
    const { state, outcome } = importGcSchedule(
      schedule({}, [
        played("q1", "Brindlewood Badgers 12U", "2026-09-05"),
        played("q2", "Thornbury Practice Squad 12U", "2026-09-06"),
        played("q3", "Copperfield Scrimmage", "2026-09-07"),
        played("q4", "Wexcombe Intrasquad", "2026-09-08"),
      ]),
      empty,
      { today: "2026-10-11" }
    );
    expect(outcome.gamesAdded).toBe(1);
    expect(outcome.gamesIgnored).toBe(3);
    expect(state.teams.map((team) => team.name).sort()).toEqual([
      "Brindlewood Badgers",
      "Quillfeather Quails",
    ]);
  });

  it("is kept against a slot of its own, where the name marks a real team's old page", () => {
    // The result is real and the club that played it keeps it, as a game against "TBD" is kept.
    const { state, outcome } = importGcSchedule(
      schedule({}, [
        played("q1", "Hollowmere Hornets DNU", "2026-09-05"),
        played("q2", "Hollowmere Hornets DNU", "2026-09-06"),
        played("q3", "Copy of Duskwood Drakes", "2026-09-07"),
      ]),
      empty,
      { today: "2026-10-11" }
    );
    expect(outcome.gamesAdded).toBe(3);
    expect(outcome.gamesIgnored).toBe(0);
    const slots = state.teams.filter((team) => team.placeholder);
    // A slot apiece, never one shared by two games.
    expect(slots).toHaveLength(3);
    expect(state.teams.filter((team) => team.nameOnly)).toEqual([]);
  });

  it("is kept against a stand-in where the word belongs to a squad the rule leaves alone", () => {
    const { state, outcome } = importGcSchedule(
      schedule({}, [played("q1", "Test Red Kestrelmoor 12U")]),
      empty,
      { today: "2026-10-11" }
    );
    expect(outcome.gamesAdded).toBe(1);
    expect(state.teams.find((team) => team.name === "Test Red Kestrelmoor")?.nameOnly).toBe(true);
  });
});

describe("a page whose name says it is no team, already in the pool", () => {
  const page: AgeGroup = { id: "p12", name: "12U 2027", ageLevel: 12, year: 2027, seasonIds: [] };
  const link = (teamId: string, name: string): GcTeamLink => ({
    teamId,
    name,
    ageGroupId: page.id,
    ageLevel: 12,
    season: "fall",
    seasonYear: 2026,
  });
  const club = (id: string, name: string, ...links: GcTeamLink[]): ScoutTeam => ({
    id,
    name,
    gcTeams: links.length > 0 ? links : [link(`gc${id}`, name)],
  });
  const row = (
    id: string,
    a: string,
    b: string,
    runs: [number, number],
    gcId: string,
    more: Partial<ScoutGame> = {}
  ): ScoutGame => ({
    id,
    ageGroupId: page.id,
    teamAId: a,
    teamBId: b,
    teamAScore: runs[0],
    teamBScore: runs[1],
    date: "2026-09-12",
    source: { kind: "gamechanger", teamId: gcId, gameId: id },
    ...more,
  });
  const quill = club("quill", "Quillfeather Quails");
  const pool = (teams: ScoutTeam[], games: ScoutGame[] = []): GcImportState => ({
    ageGroups: [page],
    teams: [quill, ...teams],
    games,
  });

  it("is deleted, and its results with it, and the tidy says so", () => {
    const thorn = club("thorn", "Thornbury Practice");
    const tidy = tidyPool(
      pool(
        [thorn, { id: "rowan", name: "Rowanberry Rooks", nameOnly: true }],
        [
          row("g1", "quill", "thorn", [9, 3], "gcquill", { namedByAvatar: "thorn" }),
          row("g2", "thorn", "rowan", [4, 2], "gcthorn", { date: "2026-09-13" }),
        ]
      )
    );
    expect(tidy.notATeam).toBe(1);
    expect(tidy.state.teams.map((team) => team.id)).toEqual(["quill"]);
    expect(tidy.state.games).toEqual([]);
    // A stand-in only it played goes too, once nothing names it.
    expect(tidy.idle).toBe(1);
    expect(describeTidy(tidy)).toContain(
      "1 practice, test or old team page deleted, and their results with them."
    );
  });

  it("is read by GameChanger's own names on its links, the club's own name lost in a bracket", () => {
    const ashg = club(
      "ashg",
      "Ashgrove Aces",
      link("gcASHGR00001", "Ashgrove Aces 12U (Practice)")
    );
    expect(dropNotATeam(pool([ashg])).dropped).toBe(1);
  });

  it("is read by the club's own name only for a link that carries none", () => {
    const marrow = club("marrow", "Marrowdale Void", link("gcMARRO00001", ""));
    const named = club("named", "Nettlefield Void", link("gcNETTL00001", "Nettlefield Nines 12U"));
    expect(dropNotATeam(pool([marrow, named])).state.teams.map((team) => team.id)).toEqual([
      "quill",
      "named",
    ]);
  });

  it("is kept while one of its GameChanger teams is a squad", () => {
    const fern = club(
      "fern",
      "Fernhollow Falcons",
      link("gcFERNH00001", "Fernhollow Falcons 12U"),
      link("gcFERNH00002", "Fernhollow Falcons Practice")
    );
    expect(dropNotATeam(pool([fern])).dropped).toBe(0);
  });

  it("is kept as the user's own club, a page's own team, or a club said to be real", () => {
    const mine = { ...club("dusk", "Duskwood Demo"), isMine: true as const };
    const pageTeam = club("copper", "Copperfield Test");
    const realById = club("hollow", "Hollowmere Hornets DNU");
    const realByLink = club("thorn", "Thornbury Practice");
    const state: GcImportState = {
      ageGroups: [{ ...page, myTeamId: "copper" }],
      teams: [quill, mine, pageTeam, realById, realByLink],
      games: [],
    };
    expect(dropNotATeam(state, new Set(["hollow", "gcthorn"])).dropped).toBe(0);
    expect(dropNotATeam(state).state.teams.map((team) => team.id)).toEqual([
      "quill",
      "dusk",
      "copper",
    ]);
  });

  it("deletes a stand-in of a drop word with its games, as the import now refuses them", () => {
    // Filed before the rule, it would otherwise rate the club that played it for good.
    const tidy = tidyPool(
      pool(
        [{ id: "squad", name: "Rowanberry Practice Squad", nameOnly: true }],
        [row("g1", "quill", "squad", [7, 5], "gcquill")]
      )
    );
    expect(tidy.notATeam).toBe(1);
    expect(tidy.state.teams.map((team) => team.id)).toEqual(["quill"]);
    expect(tidy.state.games).toEqual([]);
    // Unless the owner has said it is real, as a pulled club is kept.
    const kept = pool(
      [{ id: "squad", name: "Rowanberry Practice Squad", nameOnly: true }],
      [row("g1", "quill", "squad", [7, 5], "gcquill")]
    );
    expect(dropNotATeam(kept, new Set(["squad"])).dropped).toBe(0);
  });

  it("keeps a stand-in of an old page's games on slots of their own, as the import files them", () => {
    const { state, dropped } = dropNotATeam(
      pool(
        [{ id: "dnu", name: "Hollowmere Hornets DNU", nameOnly: true }],
        [
          row("g1", "quill", "dnu", [8, 2], "gcquill"),
          row("g2", "quill", "dnu", [3, 1], "gcquill", { date: "2026-09-13" }),
        ]
      )
    );
    expect(dropped).toBe(1);
    const byId = new Map(state.teams.map((team) => [team.id, team]));
    expect(byId.has("dnu")).toBe(false);
    expect(state.games.map((game) => game.id)).toEqual(["g1", "g2"]);
    state.games.forEach((game) => {
      expect(game).toMatchObject({ teamAId: "quill" });
      expect(byId.get(game.teamBId)).toMatchObject({
        name: "Hollowmere Hornets DNU",
        placeholder: true,
      });
    });
    // A slot apiece, as the import makes one per game.
    expect(state.games[0]!.teamBId).not.toBe(state.games[1]!.teamBId);
  });

  it("never deletes a slot of the name, which names nobody and is out of every table", () => {
    const tidy = tidyPool(
      pool(
        [{ id: "slot", name: "Practice", placeholder: true }],
        [row("g2", "quill", "slot", [2, 0], "gcquill", { date: "2026-09-13" })]
      )
    );
    expect(tidy.notATeam).toBe(0);
    expect(tidy.state.games.map((game) => game.id)).toEqual(["g2"]);
    // Nor a stand-in since read as a slot (`markPlaceholders`), which carries both marks.
    const both = dropNotATeam(
      pool(
        [{ id: "slot2", name: "Scrimmage", placeholder: true, nameOnly: true }],
        [row("g3", "quill", "slot2", [4, 1], "gcquill")]
      )
    );
    expect(both.dropped).toBe(0);
    expect(both.state.games.map((game) => game.id)).toEqual(["g3"]);
  });

  it("never deletes a club added by hand, which is neither pulled nor a stand-in", () => {
    // No link and no stand-in's mark: somebody typed it in, and nothing here outranks that.
    const { state, dropped } = dropNotATeam(
      pool(
        [{ id: "hand", name: "Rowanberry Practice Squad" }],
        [row("g1", "quill", "hand", [7, 5], "gcquill")]
      )
    );
    expect(dropped).toBe(0);
    expect(state.games.map((game) => game.id)).toEqual(["g1"]);
  });

  it("keeps a stand-in that is the user's own club or a page's own team", () => {
    // Marked as theirs or picked as a page's team by its name alone, it is vouched for all the same.
    const squad: ScoutTeam = { id: "squad", name: "Rowanberry Practice Squad", nameOnly: true };
    const games = [row("g1", "quill", "squad", [7, 5], "gcquill")];
    expect(dropNotATeam(pool([{ ...squad, isMine: true }], games)).dropped).toBe(0);
    const picked = { ...pool([squad], games), ageGroups: [{ ...page, myTeamId: "squad" }] };
    expect(dropNotATeam(picked).dropped).toBe(0);
    expect(dropNotATeam(pool([squad], games)).dropped).toBe(1);
  });

  it("files a stand-in's drop-word game the same whenever the schedule was first pulled", () => {
    // Under the rule from the start, and before it then tidied and pulled again: one pool either way.
    const pulled = schedule({}, [
      played("q1", "Copperfield Cubs 12U", "2026-09-05"),
      played("q2", "Rowanberry Practice Squad", "2026-09-06"),
      played("q3", "Hollowmere Hornets DNU", "2026-09-07"),
    ]);
    const fresh = importGcSchedule(pulled, empty, { today: "2026-10-11" }).state;
    const before: GcImportState = {
      ...fresh,
      teams: [
        ...fresh.teams,
        { id: "S-ROWA", name: "Rowanberry Practice Squad", nameOnly: true },
        { id: "S-HOLL", name: "Hollowmere Hornets DNU", nameOnly: true },
      ],
      games: [
        ...fresh.games.filter((game) => game.id !== "gc_gcQUILL00001_q3"),
        ...["q2", "q3"].map((id, at) => ({
          id: `gc_gcQUILL00001_${id}`,
          ageGroupId: fresh.ageGroups[0]!.id,
          teamAId: fresh.teams.find((team) => team.gcTeams?.length)!.id,
          teamBId: at === 0 ? "S-ROWA" : "S-HOLL",
          teamAScore: 6,
          teamBScore: 2,
          date: `2026-09-0${6 + at}`,
          ageLevelA: 12,
          season: "Fall 2026",
          source: { kind: "gamechanger" as const, teamId: "gcQUILL00001", gameId: id },
        })),
      ],
    };
    const again = importGcSchedule(pulled, tidyPool(before).state, { today: "2026-10-11" }).state;
    const read = (state: GcImportState) => {
      const byId = new Map(state.teams.map((team) => [team.id, team]));
      return state.games
        .map((game) => {
          const them = byId.get(game.teamBId);
          return `${game.date} ${them?.name}${them?.placeholder ? " [slot]" : ""}`;
        })
        .sort();
    };
    expect(read(tidyPool(again).state)).toEqual(read(tidyPool(fresh).state));
    expect(read(tidyPool(fresh).state)).toEqual([
      "2026-09-05 Copperfield Cubs",
      "2026-09-07 Hollowmere Hornets DNU [slot]",
    ]);
  });

  it("keeps an old page's game another club's own schedule lists, against a slot", () => {
    const brind = club("brind", "Brindlewood Badgers");
    const hollow = club("hollow", "Hollowmere Hornets DNU");
    const { state, dropped } = dropNotATeam(
      pool(
        [brind, hollow],
        [
          // The kept club's own row, the old page's own row of it folded in.
          row("own", "quill", "hollow", [8, 2], "gcquill", {
            namedByAvatar: "hollow",
            alsoFrom: ["gchollow"],
            alsoRows: [
              { teamId: "gchollow", gameId: "h1", ownScore: 2, opponentScore: 8, onSideB: true },
            ],
            reportedByB: { teamAScore: 8, teamBScore: 2 },
          }),
          // The old page's own row, the kept club's own row of it folded in.
          row("theirs", "hollow", "brind", [5, 1], "gchollow", {
            date: "2026-09-13",
            alsoFrom: ["gcbrind"],
            alsoRows: [
              { teamId: "gcbrind", gameId: "b1", ownScore: 1, opponentScore: 5, onSideB: true },
            ],
            reportedByB: { teamAScore: 5, teamBScore: 1 },
          }),
          // The old page's own row against a team nobody pulled: nobody else says it happened.
          row("alone", "hollow", "quill-standin", [6, 0], "gchollow", { date: "2026-09-14" }),
        ]
      )
    );
    expect(dropped).toBe(1);
    const byId = new Map(state.teams.map((team) => [team.id, team]));
    const own = state.games.find((game) => game.id === "own");
    expect(own).toMatchObject({ teamAId: "quill", teamAScore: 8, teamBScore: 2 });
    expect(byId.get(own!.teamBId)).toMatchObject({
      name: "Hollowmere Hornets DNU",
      placeholder: true,
    });
    // What the old page's schedule said of it goes with the page.
    expect(own).not.toHaveProperty("alsoRows");
    expect(own).not.toHaveProperty("alsoFrom");
    expect(own).not.toHaveProperty("reportedByB");
    expect(own).not.toHaveProperty("namedByAvatar");
    // The kept club's row stands up as a game of its own, its own score from its own seat.
    const stood = state.games.find((game) => game.source?.teamId === "gcbrind");
    expect(stood).toMatchObject({
      id: "gc_gcbrind_b1",
      teamAId: "brind",
      teamAScore: 1,
      teamBScore: 5,
    });
    expect(byId.get(stood!.teamBId)?.placeholder).toBe(true);
    expect(state.games.some((game) => game.id === "alone" || game.id === "theirs")).toBe(false);
    // A slot apiece.
    expect(own!.teamBId).not.toBe(stood!.teamBId);
  });

  it("stands a row claimed into an old page's copy back up against a slot, where it named the page", () => {
    // The kept club's own row, filed by name against the old page, claimed into the page's copy.
    const hollow = club("hollow", "Hollowmere Hornets DNU");
    const { state } = dropNotATeam(
      pool(
        [hollow],
        [
          row("theirs", "hollow", "quill", [3, 4], "gchollow", {
            alsoFrom: ["gcquill"],
            alsoRows: [
              {
                teamId: "gcquill",
                gameId: "q1",
                ownScore: 4,
                opponentScore: 3,
                onSideB: true,
                filedAgainst: "hollow",
              },
            ],
          }),
        ]
      )
    );
    expect(state.games).toHaveLength(1);
    const [stood] = state.games;
    expect(stood).toMatchObject({ id: "gc_gcquill_q1", teamAId: "quill", teamAScore: 4 });
    expect(state.teams.find((team) => team.id === stood!.teamBId)?.placeholder).toBe(true);
  });

  it("deletes a drop word's game another club's own schedule lists, as a wiffle game goes", () => {
    const thorn = club("thorn", "Thornbury Practice");
    const { state } = dropNotATeam(
      pool([thorn], [row("own", "quill", "thorn", [8, 2], "gcquill", { namedByAvatar: "thorn" })])
    );
    expect(state.games).toEqual([]);
  });

  it("goes round again when the deletion is the only thing it did", () => {
    // The hand-written sum that decides whether another pass runs has to count it.
    const tidy = tidyPool(pool([club("thorn", "Thornbury Practice")]));
    expect(tidy.notATeam).toBe(1);
    expect(tidy.passes).toBe(2);
  });

  it("runs straight after the other two passes that delete a club that does not belong", () => {
    expect(TIDY_STEPS.slice(0, 4)).toEqual(["notBaseball", "highSchool", "notATeam", "releveled"]);
  });
});

describe("a pasted list", () => {
  it("marks a page whose name says it is no team, with the word it hit", () => {
    const list = parseGcTeamList(
      [
        "Team Name,Team ID,Age Group",
        "Quillfeather Quails 12U,gcQUILL00001,12U",
        "Thornbury Practice 12U,gcTHORN00001,12U",
        "Hollowmere Hornets DNU,gcHOLLO00001,12U",
        "Test Red Kestrelmoor 12U,gcKESTR00001,12U",
      ].join("\n")
    );
    expect(list.entries.map((entry) => entry.notATeam ?? null)).toEqual([
      null,
      "practice",
      "void",
      null,
    ]);
  });
});

describe("the clubs worth pulling next", () => {
  it("never asks for a page whose name says it is no team", () => {
    const page: AgeGroup = { id: "p12", name: "12U 2027", ageLevel: 12, year: 2027, seasonIds: [] };
    const state: GcImportState = {
      ageGroups: [page],
      teams: [
        {
          id: "quill",
          name: "Quillfeather Quails",
          state: "KY",
          gcTeams: [{ teamId: "gcquill", name: "Quillfeather Quails", ageGroupId: "p12" }],
        },
        { id: "heard", name: "Brindlewood Badgers", nameOnly: true },
        { id: "squad", name: "Thornbury Practice Squad", nameOnly: true },
      ],
      games: ["heard", "squad"].map((id, at) => ({
        id: `g${at}`,
        ageGroupId: "p12",
        teamAId: "quill",
        teamBId: id,
        teamAScore: 3,
        teamBScore: 1,
        date: "2026-09-12",
      })),
    };
    expect(unpulledClubs(state).map((entry) => entry.name)).toEqual(["Brindlewood Badgers"]);
  });
});
