import { describe, expect, it } from "vitest";
import { proposeTwinSquads } from "../gameChangerImport";
import { apartKey } from "../keptApart";
import type { ScoutGame, ScoutTeam } from "../teamRankings";

/*
 * One squad on GameChanger twice: a coach's own setup, "EB GRN", and a parent's, "Cubs Fall 2026".
 * Both post the same games against the same opponents at the same minutes, so every opponent is
 * credited with each game twice.
 */
const club = (id: string, name: string, record = { win: 4, loss: 2, tie: 0 }): ScoutTeam => ({
  id,
  name,
  state: "NJ",
  gcTeams: [
    {
      teamId: `gc${id}`,
      name: `${name} 9U`,
      ageGroupId: "ag9",
      ageLevel: 9,
      record,
      playerCount: 11,
    },
  ],
});
const standIn = (id: string, name: string): ScoutTeam => ({ id, name, nameOnly: true });
let serial = 0;
/** A row of `clubId`'s own schedule: its score first. */
const row = (
  clubId: string,
  against: string,
  clock: string,
  score?: [number, number],
  date = "2026-09-19"
): ScoutGame => {
  serial += 1;
  return {
    id: `gc_gc${clubId}_${serial}`,
    teamAId: clubId,
    teamBId: against,
    ...(score ? { teamAScore: score[0], teamBScore: score[1] } : {}),
    ageGroupId: "ag9",
    date,
    startTs: `${date}T${clock}:00.000Z`,
    source: { kind: "gamechanger", teamId: `gc${clubId}`, gameId: String(serial) },
  };
};
const green = club("GRN", "EB GRN");
const cubs = club("CUBS", "Cubs Fall 2026", { win: 4, loss: 3, tie: 0 });
const bulldogs = club("BULL", "Brick American Bulldogs");
const hawks = club("HAWK", "Hawks");
const teams = [green, cubs, bulldogs, hawks];
/** The two copies of each of two games, and a game of the Cubs' own besides. */
const twins = (): ScoutGame[] => [
  row("GRN", "BULL", "14:00", [4, 7]),
  row("CUBS", "BULL", "14:00", [4, 7]),
  row("GRN", "HAWK", "17:00", [9, 1]),
  row("CUBS", "HAWK", "17:00", [9, 1]),
  row("CUBS", "BULL", "14:00", [6, 2], "2026-09-26"),
];

describe("one squad on GameChanger twice", () => {
  it("is offered where the two hold two games at one minute, one result, one opponent", () => {
    const offers = proposeTwinSquads(teams, twins());
    expect(offers).toHaveLength(1);
    const offer = offers[0]!;
    // The one with fewer games of its own schedule is offered as the one folded away.
    expect([offer.fromTeamId, offer.toTeamId]).toEqual(["GRN", "CUBS"]);
    expect([offer.fromGcId, offer.toGcId]).toEqual(["gcGRN", "gcCUBS"]);
    expect(offer.fromRecord).toEqual({ win: 4, loss: 2, tie: 0 });
    expect(offer.toPlayers).toBe(11);
    expect(
      offer.shared.map((game) => [game.opponentName, game.ownScore, game.opponentScore])
    ).toEqual([
      ["Brick American Bulldogs", 4, 7],
      ["Hawks", 9, 1],
    ]);
  });

  it("is not offered on one game in common", () => {
    expect(proposeTwinSquads(teams, twins().slice(0, 2))).toEqual([]);
  });

  it("is not offered where the two have played each other", () => {
    expect(proposeTwinSquads(teams, [...twins(), row("GRN", "CUBS", "12:00", [3, 3])])).toEqual([]);
  });

  it("is not offered where the two played two games within the hour of each other", () => {
    const tigers = club("TIG", "Tigers");
    const busy = [
      ...twins(),
      row("GRN", "HAWK", "10:00", [5, 1], "2026-09-20"),
      row("CUBS", "TIG", "10:30", [2, 8], "2026-09-20"),
    ];
    expect(proposeTwinSquads([...teams, tigers], busy)).toEqual([]);
  });

  it("is offered where the other game within the hour is one game each named its own way", () => {
    // The same result at the same start: "Tigers" typed by one schedule, the pulled club by the
    // other. One squad in one game, not two.
    const tigers = club("TIG", "Tigers");
    const typed = standIn("S-TIGERS", "Tigres");
    const same = [
      ...twins(),
      row("GRN", "S-TIGERS", "10:00", [5, 1], "2026-09-20"),
      row("CUBS", "TIG", "10:00", [5, 1], "2026-09-20"),
    ];
    expect(proposeTwinSquads([...teams, tigers, typed], same)).toHaveLength(1);
  });

  it("is offered where the other game within the hour is one result against two pulled clubs", () => {
    // Two squads of one club, "Music City Saints - Thompson" and "- Walsh", 3-8 on both at one
    // start: one schedule named the wrong squad, and it is still one game.
    const thompson = club("MCST", "Music City Saints - Thompson");
    const walsh = club("MCSW", "Music City Saints - Walsh");
    const named = [
      ...twins(),
      row("GRN", "MCST", "23:00", [3, 8], "2026-09-05"),
      row("CUBS", "MCSW", "23:00", [3, 8], "2026-09-05"),
    ];
    expect(proposeTwinSquads([...teams, thompson, walsh], named)).toHaveLength(1);
  });

  it("reads two unplayed games within the hour as two only against two pulled clubs", () => {
    const tigers = club("TIG", "Tigers");
    const typed = standIn("S-LIONS", "Lions");
    const unplayed = (against: string) => [
      ...twins(),
      row("GRN", "HAWK", "10:00", undefined, "2026-10-03"),
      row("CUBS", against, "10:15", undefined, "2026-10-03"),
    ];
    expect(proposeTwinSquads([...teams, tigers], unplayed("TIG"))).toEqual([]);
    expect(proposeTwinSquads([...teams, typed], unplayed("S-LIONS"))).toHaveLength(1);
  });

  it("is not offered once the user has said the two are not the same", () => {
    const apart = new Set([apartKey("gcGRN", "gcCUBS")]);
    expect(proposeTwinSquads(teams, twins(), apart)).toEqual([]);
  });
});
