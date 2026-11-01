import { describe, expect, it, vi } from "vitest";
import { tellViews } from "../../../../scripts/viewsReport";
import type { CopyPublish } from "../publishCopy";
import type { FamilyCounts } from "../viewStore";

/*
 * The views' lines in a server's log (`scripts/viewsReport.ts`), said the same by the nightly, the
 * republish and the catch-up: counts and sizes only. The numbers are the nightly of 30 October 2026,
 * which built 109 views and said 86 uploaded and 0 unchanged, the 23 it reused counted nowhere.
 */

const counts = (sent: number, reused = 0): FamilyCounts => ({
  sent,
  reused,
  unchanged: 0,
  refused: 0,
});

const NIGHT: CopyPublish = {
  ok: true,
  boards: 33,
  clubs: 64,
  searches: 1,
  games: 11,
  leagues: 0,
  buildMs: 81_000,
  fits: { boards: 33, bytes: 1_200_000, largest: 61_000 },
  publish: {
    ok: true,
    wrote: true,
    uploaded: 86,
    pieces: 93,
    bytes: 45_800_000,
    unchanged: 0,
    reused: 23,
    refused: 0,
    families: {
      "board:": counts(30, 3),
      "club:": counts(45, 19),
      "search:": counts(1),
      "games:": counts(10, 1),
    },
    removed: 0,
    retired: 86,
    deleted: 0,
    undeleted: 0,
    metaBytes: 37_400,
    tries: 1,
  },
  sweep: { ok: true, deleted: 79, strays: 0 },
  readSeason: () => ({ teams: [], matchups: [], logs: {} }),
};

/** What `tellViews` prints, a line at a time. */
const said = (views: CopyPublish, dry = false): string[] => {
  const lines: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    lines.push(String(line));
  });
  try {
    tellViews(views, dry);
  } finally {
    log.mockRestore();
  }
  return lines;
};

describe("the views' lines in a server's log", () => {
  it("counts the views reused beside those uploaded, and says each family's", () => {
    const lines = said(NIGHT);
    expect(lines[0]).toContain(
      "86 uploaded (93 pieces, 45.8 MB gzipped), 23 reused, 0 unchanged, 0 refused as older"
    );
    expect(lines[1]).toBe(
      "  By family: boards 30 sent, 3 reused; buckets of club cards 45 sent, 19 reused; Find a team lists 1 sent; Games lists 10 sent, 1 reused."
    );
    // Every view built is in one count: 109 of them.
    const families = Object.values(NIGHT.ok ? NIGHT.publish.families : {});
    const views = families.reduce(
      (sum, one) => sum + one.sent + one.reused + one.unchanged + one.refused,
      0
    );
    expect(views).toBe(33 + 64 + 1 + 11);
  });

  it("says a same-version republish's views unchanged, a late one's refused, and any family", () => {
    if (!NIGHT.ok) throw new Error("the night published");
    const again: CopyPublish = {
      ...NIGHT,
      publish: {
        ...NIGHT.publish,
        families: {
          "games:": { sent: 0, reused: 0, unchanged: 11, refused: 0 },
          "board:": { sent: 0, reused: 0, unchanged: 30, refused: 3 },
          "notes:": counts(1),
        },
      },
    };
    expect(said(again, true)[1]).toBe(
      "  By family, had the run been live: boards 30 unchanged, 3 refused as older; Games lists 11 unchanged; notes: 1 sent."
    );
  });

  it("says how many seasons' League Standings answers were built, and what became of them", () => {
    if (!NIGHT.ok) throw new Error("the night published");
    const lines = said({
      ...NIGHT,
      leagues: 3,
      publish: {
        ...NIGHT.publish,
        families: { ...NIGHT.publish.families, "league:": counts(1, 2) },
      },
    });
    expect(lines[0]).toContain(
      "1 Find a team lists, 11 Games lists and 3 seasons' League Standings answers built in 81 s"
    );
    expect(lines[1]).toMatch(
      /; Games lists 10 sent, 1 reused; League Standings answers 1 sent, 2 reused\.$/
    );
  });
});
