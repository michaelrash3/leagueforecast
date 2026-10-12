import { describe, expect, it } from "vitest";
import { pullSections } from "../pullSections";
import type { AgeGroup, ScoutTeam } from "../teamRankings";

/**
 * A pull of a nationwide pool cannot hold all of it. The fold keeps an index over every game it
 * could match against, and measured at forty thousand teams and two hundred thousand games that is
 * 253 MB on top of 79 MB of pool — which is what runs a tab out of memory. The roster is only
 * 25 MB of it and the games are the rest, so a section holding one page of six holds 99 MB rather
 * than 332 MB, with every team still present to be matched against.
 *
 * This is the split. It is a grouping rather than a judgement — a GameChanger id lives on exactly
 * one page, because that is what a link records — and what these are really about is the ids that
 * do not fit that sentence.
 */
const page = (id: string, ageLevel: number, year: number): AgeGroup => ({
  id,
  name: `${ageLevel}U ${year}`,
  ageLevel,
  year,
  seasonIds: [],
});

const PAGES = [
  page("p12_2027", 12, 2027),
  page("p10_2027", 10, 2027),
  page("p11_2027", 11, 2027),
  page("p10_2028", 10, 2028),
];

const club = (id: string, links: { teamId: string; ageGroupId: string }[]): ScoutTeam => ({
  id,
  name: id,
  gcTeams: links.map((link) => ({ ...link, name: id })),
});

const ROSTER = [
  club("Rays", [{ teamId: "gc1", ageGroupId: "p10_2027" }]),
  club("Jays", [{ teamId: "gc2", ageGroupId: "p10_2027" }]),
  club("Owls", [{ teamId: "gc3", ageGroupId: "p11_2027" }]),
  club("Bats", [{ teamId: "gc4", ageGroupId: "p12_2027" }]),
  club("Next", [{ teamId: "gc5", ageGroupId: "p10_2028" }]),
];

describe("splitting a pull into sections", () => {
  it("gives each page its own section, in the order a season reads", () => {
    const sections = pullSections(["gc4", "gc1", "gc5", "gc3", "gc2"], ROSTER, PAGES);

    // Year first, then age level — not the order the ids were handed over.
    expect(sections.map((section) => section.label)).toEqual([
      "10U 2027",
      "11U 2027",
      "12U 2027",
      "10U 2028",
    ]);
    expect(sections[0]?.teamIds).toEqual(["gc1", "gc2"]);
    expect(sections[0]?.ageGroupIds).toEqual(["p10_2027"]);
  });

  it("keeps the ids of a section in the order they were given", () => {
    const sections = pullSections(["gc2", "gc1"], ROSTER, PAGES);

    // The rota decides what to fetch first within a page; this only decides which page.
    expect(sections[0]?.teamIds).toEqual(["gc2", "gc1"]);
  });

  it("puts the ids nobody has pulled before in a section that owns no page", () => {
    const sections = pullSections(["gc1", "brand-new"], ROSTER, PAGES);

    const last = sections[sections.length - 1];
    expect(last?.teamIds).toEqual(["brand-new"]);
    /*
     * Empty, and that is the point. A team with no link is on no page, so this section can only
     * add: what it writes is laid over whatever year the games turn out to belong to, never
     * written as a replacement for a page it was not holding.
     */
    expect(last?.ageGroupIds).toEqual([]);
  });

  it("puts them last, after every page that is being refreshed", () => {
    const sections = pullSections(["brand-new", "gc1", "gc4"], ROSTER, PAGES);

    expect(sections.map((section) => section.label)).toEqual([
      "10U 2027",
      "12U 2027",
      "Teams not pulled before",
    ]);
  });

  it("treats a link to a page that is gone as no link at all", () => {
    const orphan = club("Ghost", [{ teamId: "gc9", ageGroupId: "deleted_page" }]);

    const sections = pullSections(["gc9"], [...ROSTER, orphan], PAGES);

    // Nothing owns those games, so nothing may replace them.
    expect(sections).toHaveLength(1);
    expect(sections[0]?.ageGroupIds).toEqual([]);
  });

  it("fetches an id once even when two clubs claim it", () => {
    const twin = club("Twin", [{ teamId: "gc1", ageGroupId: "p11_2027" }]);

    const sections = pullSections(["gc1"], [...ROSTER, twin], PAGES);

    expect(sections).toHaveLength(1);
    expect(sections[0]?.teamIds).toEqual(["gc1"]);
  });

  it("has nothing to do with an empty list", () => {
    expect(pullSections([], ROSTER, PAGES)).toEqual([]);
  });

  it("covers every id exactly once, whatever the split", () => {
    const ids = ["gc1", "gc2", "gc3", "gc4", "gc5", "unknown-a", "unknown-b"];

    const covered = pullSections(ids, ROSTER, PAGES).flatMap((section) => section.teamIds);

    // The whole contract: a sectioned run fetches the same work as one long one.
    expect(covered.slice().sort()).toEqual(ids.slice().sort());
  });
});
