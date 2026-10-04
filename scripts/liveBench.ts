/**
 * How long an edit takes on the server (1.4), measured on a pool of real size without touching the
 * cloud: the copy is held in memory, and the edit function's own pieces run on it as the function
 * runs them, the pool brought up cold (`createPoolCache` with `everyPart`), a few commands of each
 * kind made and taken back (`runEdit`), and the boards published from the pool the edits left
 * (`runRebuild`). It prints times, counts and the heap only, never a name, so its output can be
 * pasted anywhere.
 *
 *   npm run live:bench -- backup.json      a Team Rankings backup, as the app downloads one
 *   npm run live:bench -- --fixture 2000   the seeded pool (`poolFixture.ts`), clubs per page
 *
 * The copy in memory answers at once, where Firestore takes a round trip a read and a few for a
 * commit, so the commit times here are the encoding alone; and one process holds the pool, the
 * edits and the build, as the function's worker does.
 */
import { readFileSync } from "node:fs";
import { poolFixture, FIXTURE_TODAY } from "./poolFixture.ts";
import { memoryCloud } from "../src/lib/cloud/__tests__/memoryCloud.ts";
import { commitChanges } from "../src/lib/cloud/cloudEngine.ts";
import { memoryIo } from "../src/lib/cloud/cloudRunner.ts";
import type { PoolCommand } from "../src/lib/live/commands.ts";
import { runEdit } from "../src/lib/live/editRun.ts";
import { createPoolCache, everyPart } from "../src/lib/live/poolCache.ts";
import { runRebuild } from "../src/lib/live/rebuild.ts";
import { memoryLive } from "../src/lib/live/__tests__/memoryLive.ts";
import { ageGroupYear } from "../src/lib/teamRankings.ts";
import { parseTeamRankingsJson, writeTeamRankingsBackup } from "../src/lib/teamRankingsBackup.ts";
import {
  cloudPoolKeys,
  flushPoolWrites,
  initTeamRankingsStore,
  loadAgeGroups,
  loadScoutGamesForYear,
  loadScoutTeams,
  readCloudPoolValue,
  resetTeamRankingsStore,
  saveAgeGroups,
  saveScoutGames,
  saveScoutTeams,
  storedGamesByYear,
} from "../src/lib/teamRankingsStorage.ts";

declare const process: {
  argv: string[];
  exitCode?: number;
  memoryUsage: () => { heapUsed: number; rss: number };
};

const heapMb = () => Math.round(process.memoryUsage().heapUsed / 2 ** 20);
const ms = (from: number) => Math.round(performance.now() - from);
const print = (line: Record<string, string | number | boolean>) =>
  console.log(JSON.stringify(line));

/** The pool laid into this process's store, as a restore or the fixture's own saves would lay it. */
const layPool = async (args: string[]): Promise<{ today: string; source: string } | null> => {
  resetTeamRankingsStore();
  await initTeamRankingsStore(memoryIo());
  if (args[0] === "--fixture") {
    const clubsPerPage = Number(args[1] ?? 2000);
    const fixture = poolFixture({ seed: 7, clubsPerPage });
    saveAgeGroups(fixture.ageGroups);
    saveScoutTeams(fixture.teams);
    saveScoutGames(fixture.games);
    await flushPoolWrites();
    return { today: FIXTURE_TODAY, source: `fixture, ${clubsPerPage} clubs a page` };
  }
  const path = args[0];
  if (!path) return null;
  const text = readFileSync(path, "utf8");
  const backup = parseTeamRankingsJson(text);
  if (!backup) throw new Error("That file is not a Team Rankings backup.");
  if (!writeTeamRankingsBackup(backup)) throw new Error("The backup would not go into the store.");
  await flushPoolWrites();
  const savedAt = (JSON.parse(text) as { savedAt?: unknown }).savedAt;
  return {
    today: typeof savedAt === "string" ? savedAt.slice(0, 10) : FIXTURE_TODAY,
    source: "backup",
  };
};

/**
 * One of each kind of command on the pool as laid: picked by position, so the same pool gives the
 * same commands, and only from what is there.
 */
const commandsFor = (at: string): Array<[string, PoolCommand]> => {
  const years = storedGamesByYear()
    .filter((entry) => entry.year !== undefined)
    .sort((a, b) => b.games - a.games);
  const year = years[0]?.year;
  if (year === undefined) return [];
  const games = loadScoutGamesForYear(year);
  const scored = games.find((game) => game.teamAScore !== undefined && game.excluded !== true);
  const teams = loadScoutTeams();
  const plain = teams.find((team) => !team.state && !team.placeholder);
  const pages = loadAgeGroups().filter((group) => ageGroupYear(group) === year);
  const page = pages.find((group) => games.some((game) => game.ageGroupId === group.id));
  const pulled = teams.find((team) =>
    team.gcTeams?.some((link) => pages.some((group) => group.id === link.ageGroupId))
  );
  const level = page?.ageLevel;
  const onPage = page
    ? [
        ...new Set(
          games
            .filter((game) => game.ageGroupId === page.id)
            .flatMap((game) => [game.teamAId, game.teamBId])
        ),
      ]
        .map((id) => teams.find((team) => team.id === id))
        .filter((team): team is NonNullable<typeof team> => team !== undefined && !team.placeholder)
    : [];
  const commands: Array<[string, PoolCommand]> = [];
  if (scored) {
    commands.push([
      "game.exclude",
      { kind: "game.exclude", year, gameId: scored.id, excluded: true },
    ]);
    commands.push(["games.drop", { kind: "games.drop", gameIds: [scored.id] }]);
  }
  if (plain) commands.push(["team.state", { kind: "team.state", teamId: plain.id, state: "KY" }]);
  const link = pulled?.gcTeams?.[0];
  if (link)
    commands.push([
      "answers",
      { kind: "answers", list: "realClubs", add: [link.teamId], remove: [] },
    ]);
  if (pulled && level !== undefined) {
    commands.push([
      "club.age",
      { kind: "club.age", year, teamId: pulled.id, level: level + 1, at, pageId: "ag_bench_page" },
    ]);
  }
  const [from, into] = onPage;
  if (from && into)
    commands.push([
      "teams.merge",
      { kind: "teams.merge", fromId: from.id, intoId: into.id, adopt: [] },
    ]);
  return commands;
};

const main = async () => {
  const laid = await layPool(process.argv.slice(2));
  if (!laid) {
    console.error("Usage: npm run live:bench -- <backup.json> | --fixture <clubs a page>");
    process.exitCode = 2;
    return;
  }
  const keys = cloudPoolKeys();
  const values = new Map<string, unknown>();
  for (const key of keys) values.set(key, await readCloudPoolValue(key));
  const at = `${laid.today}T12:00:00.000Z`;
  const commands = commandsFor(at);
  const counts = {
    games: storedGamesByYear().reduce((sum, entry) => sum + entry.games, 0),
    teams: loadScoutTeams().length,
    pages: loadAgeGroups().length,
  };
  resetTeamRankingsStore();

  const cloud = memoryCloud();
  const first = await commitChanges({
    store: cloud.store,
    base: null,
    changes: [...values].map(([key, value]) => ({ key, value, at: 1 })),
    device: "bench",
    now: at,
  });
  if (!first.ok) throw new Error("The copy was not made.");
  values.clear();
  print({ source: laid.source, ...counts, parts: keys.length, heapMb: heapMb() });

  const pool = createPoolCache({ loads: everyPart });
  let started = performance.now();
  const ensured = await pool.ensure(cloud.store);
  if (!ensured.ok) throw new Error(`The pool would not come up: ${ensured.reason}`);
  print({
    step: "warm-up",
    cold: ensured.cold,
    fetched: ensured.fetched.length,
    ms: ms(started),
    heapMb: heapMb(),
  });

  const live = memoryLive();
  const publish = async (step: string) => {
    started = performance.now();
    const published = await runRebuild({
      copyStore: cloud.store,
      liveStore: live.store,
      pool,
      today: () => laid.today,
      now: () => at,
      locale: "en-US",
    });
    print({
      step,
      end: published.end,
      boards: published.boards ?? 0,
      buildMs: published.buildMs ?? 0,
      publishMs: published.publishMs ?? 0,
      ms: ms(started),
      heapMb: heapMb(),
    });
  };
  await publish("first publish");

  for (const [kind, command] of commands) {
    for (const [step, sent] of [["edit", command]] as Array<[string, PoolCommand]>) {
      started = performance.now();
      const done = await runEdit({ pool, store: cloud.store, command: sent, now: () => at });
      const total = ms(started);
      if (!done.ok) {
        print({ step, kind, refused: done.why, ms: total });
        continue;
      }
      print({
        step,
        kind,
        changed: done.changed.length,
        cold: done.cold,
        fetched: done.fetched,
        loadMs: done.loadMs,
        applyMs: done.applyMs,
        commitMs: done.commitMs,
        ms: total,
        heapMb: heapMb(),
      });
      await publish(`publish after ${kind}`);
      started = performance.now();
      const undone = await runEdit({
        pool,
        store: cloud.store,
        command: done.inverse,
        now: () => at,
      });
      print({
        step: "undo",
        kind,
        ok: undone.ok,
        ...(undone.ok
          ? { changed: undone.changed.length, applyMs: undone.applyMs, commitMs: undone.commitMs }
          : {}),
        ms: ms(started),
        heapMb: heapMb(),
      });
    }
  }
  await pool.drop();
};

void main();
