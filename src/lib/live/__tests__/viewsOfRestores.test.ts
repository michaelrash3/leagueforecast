import { describe, expect, it } from "vitest";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../../teamRankings";
import { coerceAgeGroups } from "../../teamRankingsStorage";
import { publishViews } from "../viewStore";
import { boardViews, buildBoardsAndFacts } from "../views/board";
import { coerceBoardView } from "../views/boardShape";
import { clubViews } from "../views/clubs";
import { gamesViews } from "../views/games";
import { coerceGames } from "../views/gamesShape";
import { searchViews } from "../views/search";
import { memoryLive } from "./memoryLive";

/*
 * The views of a copy a hand-edited restore left odd, which the page itself reads without fault:
 * a page id stored twice in one year, and a page whose own club is the empty id. Each publishes,
 * and each view it publishes is one a device reads.
 */

const teams: ScoutTeam[] = ["A", "B", "C", "D"].map((id) => ({ id, name: `Club ${id}` }));
const played = (id: string, ageGroupId: string, pair: string, date: string): ScoutGame => ({
  id,
  ageGroupId,
  teamAId: pair[0] ?? "",
  teamBId: pair[1] ?? "",
  teamAScore: 7,
  teamBScore: 4,
  date,
});
const page = (id: string, ageLevel: number, year: number, more: Partial<AgeGroup> = {}) => ({
  id,
  name: `${ageLevel}U ${year}`,
  ageLevel,
  year,
  seasonIds: [],
  ...more,
});
const readSeason = () => ({ teams: [], matchups: [], logs: {} });
const TODAY = "2027-04-15";

describe("a page id a restore stores twice in one year", () => {
  const groups: AgeGroup[] = [
    page("d9", 9, 2027),
    page("d10", 10, 2027),
    page("d9", 9, 2027, { myTeamId: "B" }),
  ];
  const games = [
    played("a", "d9", "AB", "2027-03-07"),
    played("b", "d9", "BC", "2027-03-07"),
    played("c", "d10", "CA", "2027-03-07"),
    played("d", "d10", "DA", "2027-03-14"),
  ];
  const gamesOfYear = (year: number | undefined) => (year === 2027 ? games : []);

  it("has one Games list, as it has one set of boards, and publishes", async () => {
    const built = buildBoardsAndFacts({
      ageGroups: groups,
      teams,
      gamesOfYear,
      readSeason,
      today: TODAY,
    });
    const lists = gamesViews({ ageGroups: groups, built, gamesOfYear });
    expect(lists.map((list) => list.key)).toEqual(["games:2027:d9", "games:2027:d10"]);
    const read = coerceGames(JSON.parse(JSON.stringify(lists[0]?.value)));
    expect(read?.games.map((game) => `${game.teamAId}${game.teamBId}`)).toEqual(["AB", "BC"]);
    const live = memoryLive();
    const published = await publishViews({
      store: live.store,
      views: [
        ...boardViews(groups, built),
        ...clubViews({ ageGroups: groups, built, namedAges: new Map() }),
        ...searchViews({
          ageGroups: groups,
          built,
          storedGames: games,
          held: { dropped: new Set(), ageless: [], tooYoung: new Set() },
        }),
        ...lists,
      ],
      owns: ["board:", "club:", "search:", "games:"],
      copy: { id: "c1", version: 1 },
      today: TODAY,
      now: `${TODAY}T12:00:00.000Z`,
    });
    expect(published.ok).toBe(true);
  });

  it("lists a page repeated in another year only under its first copy's year", () => {
    const across: AgeGroup[] = [page("d9", 9, 2027), page("d10", 10, 2028), page("d9", 9, 2028)];
    const built = buildBoardsAndFacts({
      ageGroups: across,
      teams,
      gamesOfYear,
      readSeason,
      today: TODAY,
    });
    expect(gamesViews({ ageGroups: across, built, gamesOfYear }).map((list) => list.key)).toEqual([
      "games:2027:d9",
      "games:2028:d10",
    ]);
  });
});

describe("a page whose own club is the empty id", () => {
  it("publishes boards with no rank line, which a device reads", () => {
    const groups = coerceAgeGroups([page("d10", 10, 2027, { myTeamId: "" })]);
    expect(groups[0]?.myTeamId).toBe("");
    const games = [played("a", "d10", "AB", "2027-03-07"), played("b", "d10", "BC", "2027-03-14")];
    const built = buildBoardsAndFacts({
      ageGroups: groups,
      teams,
      gamesOfYear: (year) => (year === 2027 ? games : []),
      readSeason,
      today: TODAY,
    });
    const year = boardViews(groups, built).find((view) => view.key === "board:2027:d10:year");
    expect(year?.value.rows.length).toBeGreaterThan(0);
    expect(year?.value.history).toBeUndefined();
    const read = coerceBoardView(JSON.parse(JSON.stringify(year?.value)));
    expect(read?.rows).toHaveLength(year?.value.rows.length ?? -1);
  });
});
