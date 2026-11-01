import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ScoutGame } from "../lib/teamRankings";
import { formatStartTime } from "../lib/date";
import { ageGroup } from "../test/teamRankingsHarness";
import { TeamDetailPanel } from "./TeamDetailPanel";

/*
 * When a club's games are, on its panel: each game's day in the words the rest of the page uses,
 * and its start where GameChanger gave one, in the reader's own time. The panel printed the day as
 * stored ("2026-10-31") and no start, while the card and Scouting said "Sat, Oct 31".
 */
const PAGE = "ag_10u_2027";
const MORNING = "2026-10-31T13:30:00.000Z";
const NOON = "2026-10-24T17:00:00.000Z";

const games: ScoutGame[] = [
  { id: "ahead", ageGroupId: PAGE, teamAId: "S-A", teamBId: "S-B", date: "2026-10-31" },
  {
    id: "ahead-timed",
    ageGroupId: PAGE,
    teamAId: "S-C",
    teamBId: "S-A",
    date: "2026-10-31",
    startTs: MORNING,
  },
  {
    id: "played",
    ageGroupId: PAGE,
    teamAId: "S-A",
    teamBId: "S-C",
    teamAScore: 5,
    teamBScore: 3,
    date: "2026-10-24",
    startTs: NOON,
  },
];

const panel = () =>
  render(
    <TeamDetailPanel
      team={{ id: "S-A", name: "Aces" }}
      allGames={games}
      ageGroupId={PAGE}
      ageGroupName="10U 2027"
      ageGroups={[ageGroup(10, 2027)]}
      teamNameById={
        new Map([
          ["S-B", "Bears"],
          ["S-C", "Comets"],
        ])
      }
      onRename={() => undefined}
      onSetState={() => true}
      onUnlinkGc={() => undefined}
      onMergeInto={() => undefined}
      mergeCandidates={[]}
      onClose={() => undefined}
      readOnly
    />
  );

/** The panel's line for the game against a club. */
const line = (opponent: string) =>
  screen
    .getAllByRole("listitem")
    .find((item) => within(item).queryByText(opponent) !== null) as HTMLElement;

describe("when a club's games are, on its panel", () => {
  it("says each game's day in words and its start where it has one", () => {
    panel();
    expect(line("Comets").textContent).toContain(`Sat, Oct 31 · ${formatStartTime(MORNING)}`);
    expect(line("Bears").textContent).toContain("Scheduled · Sat, Oct 31");
    expect(line("Bears").textContent).not.toMatch(/AM|PM/);
    expect(
      screen
        .getAllByRole("listitem")
        .some((item) => item.textContent?.includes(`5–3 · Sat, Oct 24 · ${formatStartTime(NOON)}`))
    ).toBe(true);
    expect(screen.getByRole("region", { name: "Aces" }).textContent).not.toMatch(
      /\d{4}-\d{2}-\d{2}/
    );
  });
});
