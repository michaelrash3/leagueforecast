import { describe, expect, it } from "vitest";
import { fillMissingStates } from "../clubStates";
import { tidyPool, type GcImportState } from "../gameChangerImport";
import { gcRowId, type AgeGroup, type ScoutGame, type ScoutTeam } from "../teamRankings";

/*
 * A pulled club GameChanger gave no state, given the one its club's other teams are in: the 9U page
 * of a club that says nothing of where it is, beside the 14U page that does.
 */
const club = (
  id: string,
  name: string,
  state: string | undefined,
  options: { level?: number; staff?: string[]; city?: string } = {}
): ScoutTeam => ({
  id,
  name,
  ...(state ? { state } : {}),
  ...(options.city ? { city: options.city } : {}),
  gcTeams: [
    {
      teamId: `gc${id}`,
      name,
      ageGroupId: `ag${options.level ?? 9}`,
      ageLevel: options.level ?? 9,
      ...(options.staff ? { staff: options.staff } : {}),
    },
  ],
});
const stateOf = (teams: ScoutTeam[], id: string) => teams.find((team) => team.id === id)?.state;
const COACHES = ["Pat Quillfen", "Sam Brackwell"];

describe("a pulled club with no state", () => {
  it("takes the state of a club sharing two coaches with it", () => {
    const teams = [
      club("CUBS9", "Brackwell County Cubs", undefined, { staff: COACHES }),
      club("CUBS14", "Brackwell County Cubs 14U", "KY", { level: 14, staff: COACHES }),
    ];
    const filled = fillMissingStates(teams);
    expect(filled.filled).toBe(1);
    expect(stateOf(filled.teams, "CUBS9")).toBe("KY");
    expect(stateOf(filled.teams, "CUBS14")).toBe("KY");
  });

  it("but not from one coach in common", () => {
    const teams = [
      club("CUBS9", "Brackwell County Cubs", undefined, { staff: ["Pat Quillfen"] }),
      club("CUBS14", "Marrowby Cubs", "KY", { level: 14, staff: ["Pat Quillfen", "Lee Tarn"] }),
    ];
    expect(fillMissingStates(teams).filled).toBe(0);
  });

  it("nor where the clubs sharing its coaches are in two states", () => {
    const teams = [
      club("CUBS9", "Brackwell County Cubs", undefined, { staff: COACHES }),
      club("CUBS14", "Brackwell County Cubs 14U", "KY", { level: 14, staff: COACHES }),
      club("CUBS12", "Brackwell County Cubs 12U", "OH", { level: 12, staff: COACHES }),
    ];
    expect(fillMissingStates(teams).filled).toBe(0);
  });

  it("takes the state of a club of its name in its own town", () => {
    const teams = [
      club("CUBS9", "Brackwell County Cubs", undefined, { city: "Ashwick" }),
      club("CUBS14", "Brackwell County Cubs", "KY", { level: 14, city: "ashwick " }),
    ];
    const filled = fillMissingStates(teams);
    expect(filled.filled).toBe(1);
    expect(stateOf(filled.teams, "CUBS9")).toBe("KY");
  });

  it("takes the state three or more clubs of its name are all in", () => {
    const teams = [
      club("CUBS9", "Brackwell County Cubs", undefined),
      club("CUBS10", "Brackwell County Cubs", "KY", { level: 10 }),
      club("CUBS11", "Brackwell County Cubs", "KY", { level: 11 }),
      club("CUBS12", "Brackwell County Cubs", "KY", { level: 12 }),
    ];
    expect(stateOf(fillMissingStates(teams).teams, "CUBS9")).toBe("KY");
  });

  it("but not from two of its name elsewhere, nor three in two states", () => {
    const two = [
      club("CUBS9", "Brackwell County Cubs", undefined),
      club("CUBS10", "Brackwell County Cubs", "KY", { level: 10 }),
      club("CUBS11", "Brackwell County Cubs", "KY", { level: 11 }),
    ];
    expect(fillMissingStates(two).filled).toBe(0);
    const split = [...two, club("CUBS12", "Brackwell County Cubs", "TN", { level: 12 })];
    expect(fillMissingStates(split).filled).toBe(0);
  });

  it("nor where its coaches say two states, whatever its name says", () => {
    const teams = [
      club("CUBS9", "Brackwell County Cubs", undefined, { staff: COACHES }),
      club("MATE1", "Marrowby Cubs", "OH", { level: 14, staff: COACHES }),
      club("MATE2", "Tarnfield Cubs", "KY", { level: 12, staff: COACHES }),
      club("CUBS10", "Brackwell County Cubs", "KY", { level: 10 }),
      club("CUBS11", "Brackwell County Cubs", "KY", { level: 11 }),
      club("CUBS12", "Brackwell County Cubs", "KY", { level: 12 }),
    ];
    expect(fillMissingStates(teams).filled).toBe(0);
  });

  it("but takes its coaches' state where the clubs of its name are spread over several", () => {
    // A common name is in many states, which says nothing against what the coaches say.
    const teams = [
      club("CUBS9", "Brackwell County Cubs", undefined, { staff: COACHES }),
      club("MATE", "Marrowby Cubs", "KY", { level: 14, staff: COACHES }),
      club("CUBS10", "Brackwell County Cubs", "KY", { level: 10 }),
      club("CUBS11", "Brackwell County Cubs", "TN", { level: 11 }),
      club("CUBS12", "Brackwell County Cubs", "OH", { level: 12 }),
    ];
    expect(stateOf(fillMissingStates(teams).teams, "CUBS9")).toBe("KY");
  });

  it("nor where its coaches and its town say two states", () => {
    const teams = [
      club("CUBS9", "Brackwell County Cubs", undefined, { staff: COACHES, city: "Ashwick" }),
      club("MATE", "Marrowby Cubs", "OH", { level: 14, staff: COACHES }),
      club("CUBS14", "Brackwell County Cubs", "KY", { level: 14, city: "Ashwick" }),
    ];
    expect(fillMissingStates(teams).filled).toBe(0);
  });

  it("nor one whose state the owner cleared", () => {
    const teams = [
      {
        ...club("CUBS9", "Brackwell County Cubs", undefined, { staff: COACHES }),
        stateCleared: true as const,
      },
      club("CUBS14", "Brackwell County Cubs 14U", "KY", { level: 14, staff: COACHES }),
    ];
    expect(fillMissingStates(teams).filled).toBe(0);
  });

  it("and never a club that has a state, nor a stand-in", () => {
    const standIn: ScoutTeam = { id: "S-CUBS", name: "Brackwell County Cubs", nameOnly: true };
    const teams = [
      club("CUBS9", "Brackwell County Cubs", "TN", { staff: COACHES }),
      club("CUBS14", "Brackwell County Cubs 14U", "KY", { level: 14, staff: COACHES }),
      standIn,
    ];
    const filled = fillMissingStates(teams);
    expect(filled.filled).toBe(0);
    expect(filled.teams).toBe(teams);
  });
});

describe("the tidy, once the club has a state", () => {
  const ageGroups: AgeGroup[] = [
    { id: "ag9", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: [] },
    { id: "ag14", name: "14U 2027", ageLevel: 14, year: 2027, seasonIds: [] },
  ];
  const DAY = "2026-10-04";
  const own = (clubId: string, gameId: string, against: string, clock: string): ScoutGame => ({
    id: gcRowId(`gc${clubId}`, gameId),
    teamAId: clubId,
    teamBId: against,
    teamAScore: 7,
    teamBScore: 3,
    ageGroupId: "ag9",
    date: DAY,
    startTs: `${DAY}T${clock}:00.000Z`,
    source: { kind: "gamechanger", teamId: `gc${clubId}`, gameId },
  });

  it("files a stand-in it named onto the one club of that name in its state", () => {
    // The Cubs' 9U page names "Quillfen Otters", the one pulled club of that name in Kentucky,
    // which played that day; with no state the Cubs were nowhere, and the row stayed a stand-in.
    const state: GcImportState = {
      ageGroups,
      teams: [
        club("CUBS9", "Brackwell County Cubs", undefined, { staff: COACHES }),
        club("CUBS14", "Brackwell County Cubs 14U", "KY", { level: 14, staff: COACHES }),
        club("OTTER", "Quillfen Otters", "KY"),
        { id: "S-OTTER", name: "Quillfen Otters", nameOnly: true },
        { id: "S-ELSE", name: "Marrowby Hawks", nameOnly: true },
      ],
      games: [own("CUBS9", "c1", "S-OTTER", "18:00"), own("OTTER", "o1", "S-ELSE", "15:00")],
    };
    const tidied = tidyPool(state);
    expect(tidied.stateFilled).toBe(1);
    expect(tidied.refiled).toBe(1);
    const row = tidied.state.games.find((game) => game.id === gcRowId("gcCUBS9", "c1"))!;
    expect([row.teamAId, row.teamBId]).toEqual(["CUBS9", "OTTER"]);
    expect(tidyPool(tidied.state).passes).toBe(1);
  });
});
