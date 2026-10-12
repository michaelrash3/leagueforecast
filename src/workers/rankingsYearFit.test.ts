import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createRankingsHandler, type WorkerResponse } from "./rankingsProtocol";
import {
  buildTeamRankings,
  type AgeGroup,
  type ScoutGame,
  type ScoutTeam,
  type SeasonSegment,
} from "../lib/teamRankings";
import { encodeScoutGames, encodeScoutTeams } from "../lib/teamRankingsCompact";

/*
 * The worker fits a squad year once and cuts every page from that fit.
 *
 * Every page of a year is fitted over the same games — the year's — so switching from 9U to 10U
 * refitted the whole year to cut a different page out of it: on the 18:40 pool about 3 s a switch.
 * The fit is now kept, keyed on everything it reads, and a page is a cut of it. What must hold is
 * that no page's rows move by a digit, and that the fit is redone exactly when something it reads
 * changes.
 */
const fits = vi.hoisted(() => ({ count: 0 }));
vi.mock("../lib/teamRankings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/teamRankings")>();
  return {
    ...actual,
    fitScoutYearFor: (...args: Parameters<typeof actual.fitScoutYearFor>) => {
      fits.count += 1;
      return actual.fitScoutYearFor(...args);
    },
  };
});

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2027-05-01T12:00:00"));
});
afterAll(() => vi.useRealTimers());
beforeEach(() => {
  fits.count = 0;
});

const page = (level: number, year = 2027): AgeGroup => ({
  id: `u${level}_${year}`,
  name: `${level}U ${year}`,
  ageLevel: level,
  year,
  seasonIds: [],
});
const groups: AgeGroup[] = [page(8), page(9), page(10), page(11), page(9, 2028)];

/** Six clubs at each of 8U to 11U, playing their own level and, now and then, one up or down. */
const levels = [8, 9, 10, 11];
const teams: ScoutTeam[] = levels.flatMap((level) =>
  ["A", "B", "C", "D", "E", "F"].map((club) => ({
    id: `S-${level}${club}`,
    name: `Club ${club} ${level}U`,
    state: "KY",
  }))
);
const games: ScoutGame[] = [];
let seed = 7;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const days = ["2026-09-05", "2026-09-19", "2026-10-10", "2027-03-14", "2027-04-11"];
levels.forEach((level) => {
  days.forEach((date, day) => {
    for (let game = 0; game < 4; game += 1) {
      const a = "ABCDEF"[Math.floor(random() * 6)]!;
      const b = "ABCDEF"[Math.floor(random() * 6)]!;
      // Every other game on a day against the level above, so the year's pages share a fit.
      const other = level < 11 && game % 2 === 1 ? level + 1 : level;
      if (a === b && other === level) continue;
      games.push({
        id: `g${level}-${day}-${game}`,
        teamAId: `S-${level}${a}`,
        teamBId: `S-${other}${b}`,
        ageGroupId: `u${level}_2027`,
        teamAScore: Math.floor(random() * 10),
        teamBScore: Math.floor(random() * 10),
        date,
      });
    }
  });
});

const shipment = (revision: number) => ({
  revision,
  teams: encodeScoutTeams(teams),
  games: encodeScoutGames(games),
});
const harness = () => {
  const posted: WorkerResponse[] = [];
  const handle = createRankingsHandler(
    (response) => posted.push(response),
    () => 0
  );
  let id = 0;
  const ask = (
    ageGroupId: string,
    options: { segment?: SeasonSegment; myTeamId?: string; ageGroups?: AgeGroup[] } = {},
    pool: { revision: number; teams?: unknown; games?: unknown } = { revision: 1 }
  ) => {
    id += 1;
    handle({
      kind: "rankings",
      id,
      ageGroupId,
      ageGroups: options.ageGroups ?? groups,
      ...(options.myTeamId ? { myTeamId: options.myTeamId } : {}),
      ...(options.segment ? { segment: options.segment } : {}),
      pool,
    });
    const answer = posted[posted.length - 1];
    if (answer?.kind !== "rankings") throw new Error(`no rows for ${ageGroupId}`);
    return answer.rows;
  };
  return { ask };
};

describe("a year fitted once", () => {
  it("gives every page, in each half and the whole year, the rows a fit of its own gave", () => {
    const { ask } = harness();
    ask("u9_2027", {}, shipment(1));
    const segments: Array<SeasonSegment | undefined> = [undefined, "fall", "spring"];
    segments.forEach((segment) => {
      groups.forEach((group) => {
        const expected = buildTeamRankings(group.id, teams, games, undefined, groups, segment);
        expect(ask(group.id, segment ? { segment } : {})).toEqual(expected);
      });
    });
    // The fixture is worth something: every ranked 2027 page has a table in both halves.
    expect(ask("u10_2027", { segment: "spring" }).length).toBeGreaterThan(0);
    expect(ask("u8_2027")).toEqual([]);
  });

  it("fits once for every page of the year", () => {
    const { ask } = harness();
    ask("u9_2027", {}, shipment(1));
    ask("u10_2027");
    ask("u11_2027");
    ask("u9_2027");
    expect(fits.count).toBe(1);
  });

  it("does not refit to star a club", () => {
    const { ask } = harness();
    ask("u9_2027", {}, shipment(1));
    const starred = ask("u9_2027", { myTeamId: "S-9C" });
    expect(fits.count).toBe(1);
    expect(starred.find((row) => row.teamId === "S-9C")?.isMine).toBe(true);
    expect(starred.filter((row) => row.isMine)).toHaveLength(1);
  });

  it("refits for another half, another pool, another year and another level", () => {
    const { ask } = harness();
    ask("u9_2027", {}, shipment(1));
    ask("u9_2027", { segment: "fall" });
    expect(fits.count).toBe(2);
    ask("u9_2027", { segment: "fall" }, shipment(2));
    expect(fits.count).toBe(3);
    ask("u9_2028", { segment: "fall" }, { revision: 2 });
    expect(fits.count).toBe(4);
    ask("u9_2027", { segment: "fall" }, { revision: 2 });
    expect(fits.count).toBe(5);
    // A page's level is read by every age gap in the fit.
    const relabelled = groups.map((group) =>
      group.id === "u11_2027" ? { ...group, ageLevel: 12 } : group
    );
    ask("u9_2027", { segment: "fall", ageGroups: relabelled }, { revision: 2 });
    expect(fits.count).toBe(6);
  });

  it("refits on a new day, since the day decides which games are behind us", () => {
    const { ask } = harness();
    ask("u9_2027", {}, shipment(1));
    vi.setSystemTime(new Date("2027-05-02T12:00:00"));
    ask("u10_2027");
    expect(fits.count).toBe(2);
    vi.setSystemTime(new Date("2027-05-01T12:00:00"));
  });

  it("has no table for a page too young to rank, fitted or not", () => {
    const { ask } = harness();
    expect(ask("u8_2027", {}, shipment(1))).toEqual([]);
    ask("u9_2027");
    expect(ask("u8_2027")).toEqual([]);
  });
});
