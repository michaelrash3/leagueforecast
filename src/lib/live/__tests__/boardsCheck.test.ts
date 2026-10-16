import { describe, expect, it } from "vitest";
import {
  againAt,
  asksBoards,
  BOARDS_CHECK_WINDOW_MS,
  BOARDS_SETTLE_MS,
  boardsCheckAgain,
  boardsCheckTask,
  coerceBoardsCheck,
  LEAGUE_DELETED_PATH,
  leagueDeletedAt,
  noteLeagueDeleted,
  rebuildQueued,
} from "../boardsCheck";

/*
 * The check a save queues for the boards (`boardsCheck.ts`): one a minute, run the settle after
 * the minute ends, and told apart from a rebuild's task on the same queue.
 */

describe("the boards' check after a save", () => {
  it("is one per minute of saves, run the settle after the minute ends", async () => {
    const first = await boardsCheckTask("2027-04-15T12:00:05.000Z");
    const same = await boardsCheckTask("2027-04-15T12:00:59.999Z");
    const next = await boardsCheckTask("2027-04-15T12:01:00.000Z");
    expect(same.id).toBe(first.id);
    expect(next.id).not.toBe(first.id);
    expect(first.scheduleTime.toISOString()).toBe(
      new Date(Date.parse("2027-04-15T12:01:00.000Z") + BOARDS_SETTLE_MS).toISOString()
    );
    // Never sooner than the settle after any save of its minute.
    expect(first.scheduleTime.getTime() - Date.parse("2027-04-15T12:00:59.999Z")).toBeGreaterThan(
      BOARDS_SETTLE_MS
    );
    expect(first.task).toEqual({ check: "boards", savedAt: "2027-04-15T12:00:05.000Z" });
    expect(BOARDS_CHECK_WINDOW_MS).toBe(60_000);
  });

  it("is asked again at the time given, under a name of its own", async () => {
    const task = { check: "boards" as const, savedAt: "2027-04-15T12:00:05.000Z" };
    const again = await boardsCheckAgain(task, 1_800_000_000_000);
    expect(again.scheduleTime.getTime()).toBe(1_800_000_000_000);
    expect(again.task).toEqual(task);
    expect(again.id).not.toBe((await boardsCheckTask(task.savedAt)).id);
  });

  it("is told apart from a rebuild's task and anything else on the queue", () => {
    expect(coerceBoardsCheck({ check: "boards", savedAt: "2027-04-15T12:00:05.000Z" })).toEqual({
      check: "boards",
      savedAt: "2027-04-15T12:00:05.000Z",
    });
    for (const other of [
      { copy: "c", kind: "live", window: 1, savedAt: "2027-04-15T12:00:05.000Z" },
      { check: "boards", savedAt: "not a time" },
      { check: "else", savedAt: "2027-04-15T12:00:05.000Z" },
      null,
      [],
      "boards",
    ])
      expect(coerceBoardsCheck(other)).toBeNull();
  });

  it("is a minute's own where its save's rebuild could not be queued, and says so", async () => {
    // A check the minute already has counts on the rebuild; this one must not be lost to it.
    const counting = await boardsCheckTask("2027-04-15T12:00:05.000Z");
    const alone = await boardsCheckTask("2027-04-15T12:00:30.000Z", true);
    expect(alone.id).not.toBe(counting.id);
    expect(alone.scheduleTime).toEqual(counting.scheduleTime);
    expect(alone.task).toEqual({
      check: "boards",
      savedAt: "2027-04-15T12:00:30.000Z",
      noRebuild: true,
    });
    expect((await boardsCheckTask("2027-04-15T12:00:59.000Z", true)).id).toBe(alone.id);
    // Carried through the queue and through a check asked again.
    expect(coerceBoardsCheck(alone.task)).toEqual(alone.task);
    // Anything but true there is a check that counts on the rebuild, as before.
    expect(coerceBoardsCheck({ ...alone.task, noRebuild: "yes" })).toEqual({
      check: "boards",
      savedAt: "2027-04-15T12:00:30.000Z",
    });
    expect((await boardsCheckAgain(alone.task, 1_800_000_000_000)).task).toEqual(alone.task);
  });

  it("refuses a save at no time", async () => {
    await expect(boardsCheckTask("whenever")).rejects.toThrow("no time");
  });
});

describe("which saves ask for a check, and when a check finding a publish asks again", () => {
  it("asks for the saves the boards read, the rebuilds on or off", () => {
    // A save of the copy that queued its rebuild, or failed to; a season's score.
    expect(asksBoards({ event: "save", queued: true })).toBe(true);
    expect(asksBoards({ event: "save", queued: false, error: "queue down" })).toBe(true);
    expect(asksBoards({ event: "season", season: "s1", queued: true })).toBe(true);
    // One the rebuilds would have taken, had they been on.
    expect(asksBoards({ event: "skip", why: "off" })).toBe(true);
    // One that moved nothing a board reads, or none the boards can read.
    for (const why of ["no-board-input", "deleted", "unreadable", "newer-copy", "no-document"])
      expect(asksBoards({ event: "skip", why })).toBe(false);
    expect(asksBoards({ event: "no-write" })).toBe(false);
  });

  it("counts on a rebuild only where the save's line says one was queued", () => {
    expect(rebuildQueued({ event: "save", queued: true })).toBe(true);
    expect(rebuildQueued({ event: "season", season: "s1", queued: true })).toBe(true);
    // Its queueing failed, or the rebuilds were off and asked for none.
    expect(rebuildQueued({ event: "save", queued: false, error: "queue down" })).toBe(false);
    expect(rebuildQueued({ event: "skip", why: "off" })).toBe(false);
  });

  it("asks again half a minute after the lease lapses, or after the settle at the latest", () => {
    const now = 1_000_000;
    expect(againAt(now + 60_000, now)).toBe(now + 90_000);
    expect(againAt(now + 30 * 60_000, now)).toBe(now + BOARDS_SETTLE_MS + 30_000);
  });
});

describe("a League Standings season deleted, as the settle counts it", () => {
  it("is noted at its time, and only ever moved forward", async () => {
    // Held in an object, so the reads below see what the closures wrote.
    const stored: { value: { fields: Record<string, unknown>; token: string } | null } = {
      value: null,
    };
    let revision = 0;
    const paths = new Set<string>();
    const docs = {
      readAt: async (path: string) => {
        paths.add(path);
        return stored.value ? structuredClone(stored.value) : null;
      },
      replace: async (path: string, fields: Record<string, unknown>, token: string | null) => {
        paths.add(path);
        if (token !== (stored.value?.token ?? null)) return false;
        stored.value = { fields, token: String(++revision) };
        return true;
      },
    };
    await noteLeagueDeleted(docs, "2027-04-15T12:00:05.000Z");
    expect(leagueDeletedAt(stored.value?.fields)).toBe("2027-04-15T12:00:05.000Z");
    // A trigger delivered late, for an earlier deletion, leaves the later one noted.
    await noteLeagueDeleted(docs, "2027-04-15T11:59:00.000Z");
    expect(leagueDeletedAt(stored.value?.fields)).toBe("2027-04-15T12:00:05.000Z");
    await noteLeagueDeleted(docs, "2027-04-15T12:03:00.000Z");
    expect(leagueDeletedAt(stored.value?.fields)).toBe("2027-04-15T12:03:00.000Z");
    expect(paths).toEqual(new Set([LEAGUE_DELETED_PATH]));
    expect(leagueDeletedAt(null)).toBeUndefined();
    expect(leagueDeletedAt({ at: "whenever" })).toBeUndefined();
  });
});
