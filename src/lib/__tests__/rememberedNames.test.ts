import { describe, expect, it } from "vitest";
import { fingerprint, poolFixture } from "../../../scripts/poolFixture";
import { NO_REMOVALS } from "../autoRemoved";
import { tidyPool } from "../gameChangerImport";
import { deriveAllKnown } from "../live/allKnown";
import {
  ageGroupYear,
  finalScoresKey,
  leagueFixturesOf,
  leagueScoutBridge,
  type ScoutGame,
} from "../teamRankings";

/**
 * What remembering cleaned names may not change: the answers. A team's name is cleaned to its key
 * (`teamNameKey`) wherever two names are compared, and the League pass, the bridge to League
 * Standings and the tidy compare the same names over and over, so the keys are remembered by name,
 * and the link between the two halves of the app keeps a roster's clubs by id and a game list's
 * rows by page for as long as it holds that roster and that list. Each of the three is pinned here,
 * whole, on the seeded fixture (`scripts/poolFixture.ts`, about 3,000 clubs over eleven pages, with
 * League Standings seasons that link, mint and are claimed by two pages): the digits were taken
 * before anything was remembered, and hold after.
 */

const fixture = poolFixture({ seed: 7, clubsPerPage: 300 });
const yearOfPage = new Map(fixture.ageGroups.map((group) => [group.id, ageGroupYear(group)]));
const years = [...new Set(fixture.ageGroups.map((group) => ageGroupYear(group)))];
const gamesOfYear = (year: number | undefined): ScoutGame[] =>
  fixture.games.filter((game) => yearOfPage.get(game.ageGroupId) === year);
const readSeason = (seasonId: string) =>
  fixture.seasons[seasonId] ?? { teams: [], matchups: [], logs: {} };

/** Maps and sets as their entries, so the digest reads what they hold. */
const plain = (value: unknown): string =>
  JSON.stringify(value, (_key, held: unknown) =>
    held instanceof Map ? [...held] : held instanceof Set ? [...held] : held
  );

/** Every League Standings season a page of `year` claims, with something stored, once. */
const seasonsOfYear = (year: number | undefined): string[] => [
  ...new Set(
    fixture.ageGroups
      .filter((group) => ageGroupYear(group) === year)
      .flatMap((group) => group.seasonIds)
      .filter((seasonId) => fixture.seasons[seasonId] !== undefined)
  ),
];

describe("the answers remembered names give", () => {
  it("are the League pass's, year by year", () => {
    const digests = years.map((year) =>
      fingerprint(
        plain(
          deriveAllKnown({
            ageGroups: fixture.ageGroups,
            teams: fixture.teams,
            yearGames: gamesOfYear(year),
            readSeason,
            autoRemoved: NO_REMOVALS,
          })
        )
      )
    );
    expect(digests).toEqual(["fbfb52b1", "35ce7194", "8e9f5142"]);
  });

  it("are the bridge's, season by season, asked once and asked again", () => {
    const yearGames = new Map(years.map((year) => [year, gamesOfYear(year)]));
    // Every season of a year against the one roster and the one list of the year's games, as a
    // device asks it, and then all of them again: the second time, from what the first left.
    const digests = () =>
      years.flatMap((year) =>
        seasonsOfYear(year).map((seasonId) => {
          const { teams, matchups, logs } = readSeason(seasonId);
          const bridge = leagueScoutBridge(
            seasonId,
            fixture.ageGroups,
            fixture.teams,
            yearGames.get(year) ?? [],
            teams,
            leagueFixturesOf(teams, matchups, finalScoresKey(matchups, logs))
          );
          return `${seasonId} ${fingerprint(plain(bridge))}`;
        })
      );
    const pins = ["fx-9u-2026 1e19b842", "fx-10u-fall f01d8b59", "fx-shared 7dc5cc2c"];
    expect(digests()).toEqual(pins);
    expect(digests()).toEqual(pins);
  });

  it("are the tidy's", () => {
    const tidied = tidyPool({
      ageGroups: fixture.ageGroups,
      teams: fixture.teams,
      games: fixture.games,
    });
    expect(fingerprint(plain(tidied))).toBe("3dd4e0de");
  });
});
