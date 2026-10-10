import { render, within } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../lib/teamRankings";
import { TeamDetailPanel } from "./TeamDetailPanel";

/*
 * The lines a club's panel draws under each counted game (`gameNotes`), which the live board
 * works out from the club's card and the board on screen: drawn on the counted W, L and T rows
 * alone, never on a game still to come, one set not to count, one against the club's own name or
 * one outside the half on screen, and the panel without them exactly as it was. Placeholder names
 * throughout.
 */

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2027-07-31T12:00:00"));
});
afterAll(() => vi.useRealTimers());

const PAGE = "ag_12u_2027";
const groups: AgeGroup[] = [
  { id: PAGE, name: "12U 2027", ageLevel: 12, year: 2027, seasonIds: [] },
  { id: "ag_11u_2027", name: "11U 2027", ageLevel: 11, year: 2027, seasonIds: [] },
  { id: "ag_12u_2026", name: "12U 2026", ageLevel: 12, year: 2026, seasonIds: [] },
];
const aces: ScoutTeam = { id: "S-A", name: "Aces", state: "KY" };
const names = new Map([
  ["S-A", "Aces"],
  ["S-B", "Bears"],
  ["S-C", "Cubs"],
]);
const game = (
  id: string,
  teamAId: string,
  teamBId: string,
  scores: [number, number] | null,
  date: string,
  more: Partial<ScoutGame> = {}
): ScoutGame => ({
  id,
  teamAId,
  teamBId,
  ageGroupId: PAGE,
  ...(scores ? { teamAScore: scores[0], teamBScore: scores[1] } : {}),
  date,
  ...more,
});
// A card's games, each by its place on the card, as a published card names them.
const games: ScoutGame[] = [
  game("0", "S-A", "S-B", [6, 2], "2026-09-12", { event: "Placeholder Classic" }),
  game("1", "S-C", "S-A", [5, 4], "2026-10-03"),
  game("2", "S-A", "S-B", [3, 3], "2026-10-10"),
  game("3", "S-A", "S-C", null, "2027-05-01"),
  game("4", "S-A", "S-C", [9, 1], "2026-09-20", { excluded: true }),
  game("5", "S-A", "S-A", [3, 2], "2026-09-27"),
  game("6", "S-A", "S-B", [1, 9], "2027-04-11"),
  game("7", "S-A", "S-C", [2, 0], "2025-10-04", { ageGroupId: "ag_12u_2026" }),
];
const COUNTED = ["0", "1", "2"];

const notes = {
  headline:
    "Fall 2026 rating +1.4: +1.2 from its games, +0.2 because its record is fuller than most.",
  key: "Played like: the rating that makes the score exactly what was expected. Moved: the rating with the game, less the rating without it.",
  // A line for every game on the card, so that the panel alone decides which rows draw one.
  byGame: new Map(
    games.map((each) => [each.id, [`Played like +${each.id}.1`, `moved its rating +0.${each.id}`]])
  ),
};

const panel = (more: { gameNotes?: typeof notes } = {}) =>
  render(
    <TeamDetailPanel
      team={aces}
      allGames={games}
      ageGroupId={PAGE}
      ageGroupName="12U 2027"
      ageGroups={groups}
      segment="fall"
      teamNameById={names}
      onRename={() => undefined}
      onSetState={() => true}
      onUnlinkGc={() => undefined}
      onMergeInto={() => undefined}
      mergeCandidates={[]}
      onClose={() => undefined}
      readOnly
      {...more}
    />
  );

/** The panel's markup with React's generated ids taken out, which depend on what rendered first. */
const markup = (container: HTMLElement) => container.innerHTML.replace(/_r_[0-9a-z]+_/g, "_id_");

/** FNV-1a over the markup: a short fingerprint to pin the panel as it was drawn before the lines. */
const fingerprint = (text: string) => {
  let hash = 0x811c9dc5;
  for (let at = 0; at < text.length; at += 1) {
    hash ^= text.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

/** Each row of the games list, by the game it is for, found by its day (the list is newest first). */
const rowsOf = (container: HTMLElement) =>
  within(container.querySelector("section")!)
    .getAllByRole("listitem")
    .map((item) => {
      const found = games.find((one) => item.textContent?.includes(one.date ?? "-"));
      if (!found) throw new Error(`no game for the row ${item.textContent}`);
      return { id: found.id, item };
    });

describe("what each game did, on a club's panel", () => {
  it("draws the panel exactly as before without the lines, or with none to draw", () => {
    const without = panel();
    const before = markup(without.container);
    // Taken from the panel before the lines were added to it.
    expect(fingerprint(before)).toBe("27dd2477");
    without.unmount();
    const none = panel({ gameNotes: { ...notes, byGame: new Map() } });
    expect(markup(none.container)).toBe(before);
  });

  it("draws a line under each counted game alone, and the headline and key once", () => {
    const { container } = panel({ gameNotes: notes });
    const section = container.querySelector("section")!;
    for (const { id, item } of rowsOf(container)) {
      const line = item.querySelector("p");
      if (!COUNTED.includes(id)) {
        expect(line, `game ${id}`).toBeNull();
        continue;
      }
      expect(line?.textContent).toBe(`Played like +${id}.1\u00a0· moved its rating +0.${id}`);
      // The whole width of the row, under the score, in the meta text the panel's notes use.
      expect(line?.className).toContain("basis-full");
      expect(line?.className).toContain("text-xs");
      expect(line?.className).toContain("tabular-nums");
      // Each clause kept whole on a line where it fits, wrapping inside only where it cannot, with
      // the dot after it in its own box behind a non-breaking space, so no line opens on a dot.
      const clauses = [...(line?.querySelectorAll("span") ?? [])];
      expect(clauses.map((clause) => clause.textContent)).toEqual([
        `Played like +${id}.1\u00a0·`,
        `moved its rating +0.${id}`,
      ]);
      for (const clause of clauses) expect(clause.className).toContain("inline-block");
    }
    expect(within(section).getAllByText(notes.headline, { exact: false })).toHaveLength(1);
    expect(within(section).getAllByText(notes.key, { exact: false })).toHaveLength(1);
    const lead = within(section).getByText(notes.headline, { exact: false });
    expect(lead.textContent).toBe(`${notes.headline} ${notes.key}`);
    // Under the list's heading, before its first game.
    expect(lead.previousElementSibling?.textContent).toBe("Games in 12U 2027");
  });
});
