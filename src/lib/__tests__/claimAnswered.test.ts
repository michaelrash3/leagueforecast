import { describe, expect, it } from "vitest";
import type { GcTeamSchedule } from "../gameChangerApi";
import { importGcSchedule, tidyPool, type GcImportState } from "../gameChangerImport";
import { gcRowId, withFiledMark } from "../teamRankings";

/*
 * The pool of 26 September 2026 held one game four times over. Power Baseball 2028 Victus beat JR7
 * Baseball 3-2 on the 11th, and each club had a second GameChanger team — PBB, and JR7 — whose
 * schedule listed the same game against the first team of the other club. Power's own row and JR7
 * Baseball's own row named each other. JR7 Baseball's row sat claimed into PBB's copy, filed
 * against Power, and the claim step read Power's row as answered only by a copy of JR7 Baseball's
 * that stood: each pass claimed Power's row into JR7's copy and gave JR7 Baseball's back, then the
 * other way round, and every tidy of the pool ran to its limit.
 */
const empty: GcImportState = { ageGroups: [], teams: [], games: [] };
const club = (id: string, name: string, games: GcTeamSchedule["games"]): GcTeamSchedule => ({
  profile: {
    id,
    name,
    ageLevel: 17,
    season: { season: "fall", year: 2026 },
    state: "FL",
  },
  games,
  fetchedAt: "2026-09-26T03:00:00.000Z",
});
const row = (
  id: string,
  opponentName: string,
  startTs: string,
  score: [number, number]
): GcTeamSchedule["games"][number] => ({
  id,
  date: "2026-09-11",
  startTs,
  opponentName,
  status: "completed",
  teamScore: score[0],
  opponentScore: score[1],
});
const evening = "2026-09-11T23:00:00.000Z";
const anHourOn = "2026-09-12T00:00:00.000Z";
const storm = club("gcSTORM", "Storm Baseball 2028 Gold 17U", [
  row("s1", "Hawks Baseball 17U", evening, [3, 2]),
]);
const sbb = club("gcSBB", "SBB 17U", [row("b1", "Hawks Baseball 17U", anHourOn, [3, 2])]);
const hawksBaseball = club("gcHAWKSBASE", "Hawks Baseball 17U", [
  row("h1", "Storm Baseball 2028 Gold 17U", anHourOn, [2, 3]),
]);
const hawks = club("gcHAWKS", "Hawks 17U", [
  row("k1", "Storm Baseball 2028 Gold 17U", anHourOn, [2, 3]),
]);

/** Which game holds each row, standing or folded in, and whether it is held as a claim. */
const placement = (state: GcImportState) => {
  const at = new Map<string, string>();
  state.games.forEach((game) => {
    if (game.source) at.set(gcRowId(game.source.teamId, game.source.gameId), game.id);
    game.alsoRows?.forEach((record) =>
      at.set(
        gcRowId(record.teamId, record.gameId),
        `${game.id}${record.filedAgainst === undefined ? "" : " (claimed)"}`
      )
    );
  });
  return at;
};

/**
 * The day as the pool of 26 September held it: the four schedules pulled, the Hawks Baseball's row
 * in SBB's copy, and that row marked as claimed there against the Storm, the Storm's and the
 * Hawks' rows standing on their own.
 */
const asHeld = (): GcImportState => {
  const pulled = [storm, sbb, hawksBaseball, hawks].reduce(
    (state, schedule) => importGcSchedule(schedule, state).state,
    empty
  );
  const stormId = pulled.teams.find((team) => team.gcTeams?.[0]?.teamId === "gcSTORM")!.id;
  const hawksRow = gcRowId("gcHAWKSBASE", "h1");
  return {
    ...pulled,
    games: pulled.games.map((game) =>
      game.alsoRows?.some((record) => gcRowId(record.teamId, record.gameId) === hawksRow)
        ? withFiledMark(game, hawksRow, stormId, 17)
        : game
    ),
  };
};

describe("two clubs, each on GameChanger twice, whose first teams name each other", () => {
  it("starts from the claim the pool held", () => {
    const at = placement(asHeld());
    expect(at.get(gcRowId("gcHAWKSBASE", "h1"))).toBe(
      `${at.get(gcRowId("gcSBB", "b1"))} (claimed)`
    );
    expect(at.get(gcRowId("gcSTORM", "s1"))).not.toBe(at.get(gcRowId("gcHAWKS", "k1")));
  });

  it("settles, the two rows that name each other one game", () => {
    const first = tidyPool(asHeld());
    const again = tidyPool(first.state);
    expect(again.passes).toBe(1);
    expect(again.state.games).toBe(first.state.games);

    const at = placement(first.state);
    const game = at.get(gcRowId("gcSTORM", "s1"));
    expect(at.get(gcRowId("gcHAWKSBASE", "h1"))).toBe(game);
    // The second teams' copies stand as games of their own: nothing here says SBB is the Storm or
    // the Hawks are the Hawks Baseball, and each names a club whose day is already accounted for.
    expect(at.get(gcRowId("gcSBB", "b1"))).not.toBe(game);
    expect(at.get(gcRowId("gcHAWKS", "k1"))).not.toBe(game);
    expect(first.state.games).toHaveLength(3);
  });
});
