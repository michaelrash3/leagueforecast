import { describe, expect, it } from "vitest";
import {
  coerceOrgMembership,
  mergeOrgMembership,
  NO_MEMBERSHIP,
  orgAgesByTeam,
  withOrgAges,
  type OrgMembership,
} from "../orgMembership";
import { ageUnknownDue, type AgeUnknownTeam } from "../ageUnknown";

const MORNING = "2026-09-22T09:00:00.000Z";
const EVENING = "2026-09-22T21:00:00.000Z";

const kept = (orgs: OrgMembership["orgs"], savedAt = MORNING): OrgMembership => ({ orgs, savedAt });

describe("keeping the Organizations file", () => {
  it("keeps organizations with a name and teams, and nothing else", () => {
    const next = mergeOrgMembership(
      NO_MEMBERSHIP,
      [
        { orgId: "orgENA000001", name: "ENA 8U Fall 2026", teamIds: ["teamPISTONS1"] },
        { orgId: "orgNOTEAMS01", name: "Empty League 9U" },
        { orgId: "orgNONAME001", teamIds: ["teamSOMEONE1"] },
      ],
      EVENING
    );
    expect(next).toEqual(
      kept(
        [{ orgId: "orgENA000001", name: "ENA 8U Fall 2026", teamIds: ["teamPISTONS1"] }],
        EVENING
      )
    );
  });

  it("adds a later file to an earlier one, replacing an organization it names again", () => {
    const morning = kept([
      { orgId: "orgENA000001", name: "ENA 8U Fall 2026", teamIds: ["teamPISTONS1"] },
      { orgId: "orgTPABL0012", name: "TPABL 12U", teamIds: ["teamLEOPARD1"] },
    ]);
    const next = mergeOrgMembership(
      morning,
      [
        {
          orgId: "orgENA000001",
          name: "ENA 8U Fall 2026",
          teamIds: ["teamPISTONS1", "teamTWINS001"],
        },
        { orgId: "orgHYBSL0008", name: "HYBSL 8U", teamIds: ["teamNOODLER1"] },
      ],
      EVENING
    );
    expect(next.savedAt).toBe(EVENING);
    expect(Object.fromEntries(next.orgs.map((org) => [org.orgId, org.teamIds]))).toEqual({
      orgENA000001: ["teamPISTONS1", "teamTWINS001"],
      orgTPABL0012: ["teamLEOPARD1"],
      orgHYBSL0008: ["teamNOODLER1"],
    });
  });

  it("changes nothing, not even the date, for a file it has already read", () => {
    const morning = kept([
      { orgId: "orgENA000001", name: "ENA 8U Fall 2026", teamIds: ["teamPISTONS1"] },
    ]);
    const again = mergeOrgMembership(
      morning,
      [{ orgId: "orgENA000001", name: "ENA 8U Fall 2026", teamIds: ["teamPISTONS1"] }],
      EVENING
    );
    expect(again).toBe(morning);
  });

  it("reads back only what is well formed", () => {
    expect(coerceOrgMembership(null)).toEqual(NO_MEMBERSHIP);
    expect(
      coerceOrgMembership({
        savedAt: MORNING,
        orgs: [
          { orgId: "orgENA000001", name: "ENA 8U Fall 2026", teamIds: ["teamPISTONS1", 7] },
          { orgId: "orgBROKEN001", name: "No teams", teamIds: [] },
          "not an organization",
        ],
      })
    ).toEqual(
      kept([{ orgId: "orgENA000001", name: "ENA 8U Fall 2026", teamIds: ["teamPISTONS1"] }])
    );
  });
});

describe("the age an organization's name gives its teams", () => {
  it("is the age the name states", () => {
    const ages = orgAgesByTeam(
      kept([{ orgId: "orgENA000001", name: "ENA 8U Fall 2026", teamIds: ["teamPISTONS1"] }])
    );
    expect(ages.get("teamPISTONS1")).toBe(8);
  });

  it("is nothing from a name that states none", () => {
    const ages = orgAgesByTeam(
      kept([{ orgId: "orgCLUB00001", name: "Cincy Legends Baseball", teamIds: ["teamLEGEND01"] }])
    );
    expect(ages.has("teamLEGEND01")).toBe(false);
  });

  it("is nothing from an event, whose age is a ceiling the team played up to", () => {
    const ages = orgAgesByTeam(
      kept([
        {
          orgId: "orgEVENT0001",
          name: "(09/25/2026) 17/18u Super Fall Invitational",
          teamIds: ["teamPLAYSUP1"],
        },
      ])
    );
    expect(ages.has("teamPLAYSUP1")).toBe(false);
  });

  it("agrees across two organizations, and is nothing where they disagree", () => {
    const ages = orgAgesByTeam(
      kept([
        { orgId: "orgTPABL0012", name: "TPABL 12U", teamIds: ["teamLEOPARD1", "teamBOTH0001"] },
        { orgId: "orgTPAFALL12", name: "TPA 12U Fall League", teamIds: ["teamLEOPARD1"] },
        { orgId: "orgTPABL0010", name: "TPABL 10U", teamIds: ["teamBOTH0001"] },
      ])
    );
    expect(ages.get("teamLEOPARD1")).toBe(12);
    expect(ages.has("teamBOTH0001")).toBe(false);
  });
});

describe("the waiting list, once a file can age a team on it", () => {
  const NOBODY = { has: () => false, get: () => undefined };
  const waiting = (teamId: string, lastTried: string, tries = 1): AgeUnknownTeam => ({
    teamId,
    firstSeen: "2026-07-01T00:00:00.000Z",
    lastTried,
    tries,
  });
  const now = new Date("2026-09-23T00:00:00.000Z");

  it("asks straight away about a team the file ages, though it was asked this week", () => {
    const list = [waiting("teamPISTONS1", MORNING), waiting("teamOTHER001", MORNING)];
    const ages = new Map([["teamPISTONS1", 8]]);
    expect(ageUnknownDue(list, 10, now, NOBODY)).toEqual([]);
    expect(ageUnknownDue(list, 10, now, withOrgAges(NOBODY, ages, EVENING))).toEqual([
      "teamPISTONS1",
    ]);
  });

  it("asks once: a team asked since the file was read waits the week like any other", () => {
    const list = [waiting("teamPISTONS1", EVENING)];
    const ages = new Map([["teamPISTONS1", 8]]);
    expect(ageUnknownDue(list, 10, now, withOrgAges(NOBODY, ages, MORNING))).toEqual([]);
  });

  it("asks again about a team the rota had given up on", () => {
    const list = [waiting("teamPISTONS1", "2026-09-01T00:00:00.000Z", 8)];
    const ages = new Map([["teamPISTONS1", 8]]);
    expect(ageUnknownDue(list, 10, now, NOBODY)).toEqual([]);
    expect(ageUnknownDue(list, 10, now, withOrgAges(NOBODY, ages, EVENING))).toEqual([
      "teamPISTONS1",
    ]);
  });

  it("keeps a name typed by hand first, on its own date", () => {
    const typed = {
      has: (id: string) => id === "teamPISTONS1",
      get: (id: string) =>
        id === "teamPISTONS1" ? { namedAt: "2026-01-01T00:00:00.000Z" } : undefined,
    };
    const asks = withOrgAges(typed, new Map([["teamPISTONS1", 8]]), EVENING);
    expect(asks.get("teamPISTONS1")).toEqual({ namedAt: "2026-01-01T00:00:00.000Z" });
  });
});
