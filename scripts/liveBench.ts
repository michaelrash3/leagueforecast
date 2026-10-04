/**
 * How long an edit takes on the server (1.4), measured on a pool of real size without touching the
 * cloud: the copy is held in memory, and the edit function's own pieces run on it as the function
 * runs them, the pool brought up cold (`createEditPool`), a few commands of each
 * kind made and taken back (`runEdit`), and the boards published from the pool the edits left
 * (`runRebuild`). It prints times, counts and the heap only, never a name, so its output can be
 * pasted anywhere.
 *
 *   npm run live:bench -- backup.json                   a Team Rankings backup, as the app downloads one
 *   npm run live:bench -- --fixture 2000                the seeded pool (`poolFixture.ts`), clubs per page
 *   npm run live:bench -- backup.json --save copy.json  the cloud copy made from either, kept in a file
 *   npm run live:bench -- --copy copy.json              the bench run from a kept copy
 *
 * The questions a section asks before an edit (`runQuery`) are asked once, after the warm-up, each
 * answer's size printed and read back as a device reads it. The edits are made twice: first on
 * their own, as the edit function makes them, then each followed by a publish of every board, as
 * the rebuild after it builds them, where it changed a part the boards read (the trigger rebuilds
 * after no other edit). Only a run from a kept copy says
 * how much memory each step took at most (`peakRssMb`, the process's peak so far): a run that reads a
 * backup first holds what reading it took, which neither function ever does. A kept copy holds the
 * pool's own data, names included, so it belongs wherever the backup itself is kept.
 *
 * The copy in memory answers at once, where Firestore takes a round trip a read and a few for a
 * commit, so the commit times here are the encoding alone. One process holds the pool, the edits and
 * the build, where each function's worker holds a pool of its own: the rebuild's fetches the parts an
 * edit changed, which is timed apart, unpacked and checked, from the copy in memory.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { poolFixture, FIXTURE_TODAY } from "./poolFixture.ts";
import { memoryCloud, type MemoryCloud } from "../src/lib/cloud/__tests__/memoryCloud.ts";
import { commitChanges, fetchValues } from "../src/lib/cloud/cloudEngine.ts";
import type { CloudManifest } from "../src/lib/cloud/cloudManifest.ts";
import { memoryIo } from "../src/lib/cloud/cloudRunner.ts";
import { CLEARABLE_RULES } from "../src/lib/agelessTriage.ts";
import { isBoardInput } from "../src/lib/live/boardInputs.ts";
import type { PoolCommand } from "../src/lib/live/commands.ts";
import { runEdit, runQuery } from "../src/lib/live/editRun.ts";
import { coerceQueryAnswer, type PoolQuery } from "../src/lib/live/queries.ts";
import { createEditPool } from "../src/lib/live/poolCache.ts";
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
  resourceUsage: () => { maxRSS: number };
};

const heapMb = () => Math.round(process.memoryUsage().heapUsed / 2 ** 20);
/** The most the process has held so far, in MiB (`maxRSS` is in KiB). */
const peakRssMb = () => Math.round(process.resourceUsage().maxRSS / 1024);
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
      "game.score",
      {
        kind: "game.score",
        year,
        gameId: scored.id,
        teamAScore: (scored.teamAScore ?? 0) + 1,
        teamBScore: scored.teamBScore ?? 0,
      },
    ]);
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
  const [from, into, dropped] = onPage;
  if (from && into)
    commands.push([
      "teams.merge",
      { kind: "teams.merge", fromId: from.id, intoId: into.id, adopt: [] },
    ]);
  if (dropped) commands.push(["club.drop", { kind: "club.drop", teamId: dropped.id }]);
  return commands;
};

/** A copy as `--save` keeps it: the manifest, and each piece in base64. */
type KeptCopy = { today: string; manifest: CloudManifest; chunks: Record<string, string> };

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary);
};

const fromBase64 = (text: string): Uint8Array => {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at);
  return bytes;
};

const optionOf = (args: string[], name: string): string | undefined => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};

/** The cloud copy of the pool laid by `args`, made as a device's first save makes it. */
const copyOfLaid = async (
  args: string[]
): Promise<{ cloud: MemoryCloud; today: string; source: string } | null> => {
  const laid = await layPool(args);
  if (!laid) return null;
  const keys = cloudPoolKeys();
  const values = new Map<string, unknown>();
  for (const key of keys) values.set(key, await readCloudPoolValue(key));
  resetTeamRankingsStore();
  const cloud = memoryCloud();
  const first = await commitChanges({
    store: cloud.store,
    base: null,
    changes: [...values].map(([key, value]) => ({ key, value, at: 1 })),
    device: "bench",
    now: `${laid.today}T12:00:00.000Z`,
  });
  if (!first.ok) throw new Error("The copy was not made.");
  return { cloud, today: laid.today, source: laid.source };
};

/** A copy `--save` kept, back in memory. */
const keptCopy = (path: string): { cloud: MemoryCloud; today: string; source: string } => {
  const kept = JSON.parse(readFileSync(path, "utf8")) as KeptCopy;
  const cloud = memoryCloud();
  cloud.setManifest(kept.manifest);
  for (const [id, data] of Object.entries(kept.chunks)) cloud.chunks.set(id, fromBase64(data));
  return { cloud, today: kept.today, source: "kept copy" };
};

const main = async () => {
  const args = process.argv.slice(2);
  const keptAt = optionOf(args, "--copy");
  const saveTo = optionOf(args, "--save");
  const made = keptAt === undefined ? await copyOfLaid(args) : keptCopy(keptAt);
  if (!made) {
    console.error(
      "Usage: npm run live:bench -- <backup.json> | --fixture <clubs a page> [--save <copy.json>]" +
        " | --copy <copy.json>"
    );
    process.exitCode = 2;
    return;
  }
  const { cloud, today, source } = made;
  const manifest = cloud.manifest();
  if (saveTo !== undefined && manifest) {
    const chunks: Record<string, string> = {};
    for (const [id, data] of cloud.chunks) chunks[id] = toBase64(data);
    writeFileSync(saveTo, JSON.stringify({ today, manifest, chunks } satisfies KeptCopy));
    print({ source, saved: true, parts: manifest.parts.length, pieces: cloud.chunks.size });
    return;
  }
  // Only a process that never read a backup has a peak worth reporting.
  const peak = (): Record<string, number> =>
    keptAt === undefined ? {} : { peakRssMb: peakRssMb() };
  const at = `${today}T12:00:00.000Z`;

  const pool = createEditPool();
  let started = performance.now();
  const ensured = await pool.ensure(cloud.store);
  if (!ensured.ok) throw new Error(`The pool would not come up: ${ensured.reason}`);
  const warmMs = ms(started);
  print({
    source,
    games: storedGamesByYear().reduce((sum, entry) => sum + entry.games, 0),
    teams: loadScoutTeams().length,
    pages: loadAgeGroups().length,
    parts: manifest?.parts.length ?? 0,
  });
  print({
    step: "warm-up",
    cold: ensured.cold,
    fetched: ensured.fetched.length,
    ms: warmMs,
    heapMb: heapMb(),
    ...peak(),
  });
  const commands = commandsFor(at);

  /** One command made on the copy, and said; the run, or null when it was refused. */
  const edit = async (pass: number, kind: string, command: PoolCommand) => {
    started = performance.now();
    const done = await runEdit({ pool, store: cloud.store, command, now: () => at });
    const total = ms(started);
    if (!done.ok) {
      print({ pass, step: "edit", kind, refused: done.why, ms: total });
      return null;
    }
    print({
      pass,
      step: "edit",
      kind,
      changed: done.changed.length,
      cold: done.cold,
      fetched: done.fetched,
      loadMs: done.loadMs,
      applyMs: done.applyMs,
      commitMs: done.commitMs,
      ms: total,
      heapMb: heapMb(),
      ...peak(),
    });
    return done;
  };
  const undo = async (pass: number, kind: string, inverse: PoolCommand) => {
    started = performance.now();
    const undone = await runEdit({ pool, store: cloud.store, command: inverse, now: () => at });
    print({
      pass,
      step: "undo",
      kind,
      ok: undone.ok,
      ...(undone.ok
        ? { changed: undone.changed.length, applyMs: undone.applyMs, commitMs: undone.commitMs }
        : {}),
      ms: ms(started),
      heapMb: heapMb(),
      ...peak(),
    });
  };

  // The questions a section asks before an edit, on the pool the warm-up left: each answer's size
  // as sent, and whether the device would read it back (`coerceQueryAnswer`), which is what says
  // the shapes it is read with fit a pool of real size.
  const fold = commands.find(([kind]) => kind === "teams.merge")?.[1];
  const into =
    fold?.kind === "teams.merge"
      ? loadScoutTeams().find((team) => team.id === fold.intoId)
      : undefined;
  const questions: PoolQuery[] = [
    ...(fold?.kind === "teams.merge"
      ? ([
          { kind: "merge.preview", fromId: fold.fromId, intoId: fold.intoId, adopt: [] },
          { kind: "rename.preview", teamId: fold.fromId, name: into?.name ?? "" },
        ] satisfies PoolQuery[])
      : []),
    { kind: "health.summary", today },
    { kind: "health.inspect", today },
    { kind: "health.toPull" },
    { kind: "ageless.queue", today, pinned: [] },
    // A word most club names hold, so the search reads far past what it shows.
    { kind: "ageless.search", today, query: "baseball" },
    { kind: "ageless.file", today },
    { kind: "ageless.clearPlan", today, rules: [...CLEARABLE_RULES] },
  ];
  for (const query of questions) {
    started = performance.now();
    const asked = await runQuery({ pool, store: cloud.store, query });
    const sent = asked.ok ? JSON.stringify(asked.answer) : "";
    print({
      step: "question",
      kind: query.kind,
      ...(asked.ok
        ? {
            answerMs: asked.answerMs,
            answerKb: Math.round(sent.length / 1024),
            readsBack: coerceQueryAnswer(JSON.parse(sent), query.kind) !== null,
          }
        : { refused: asked.why }),
      ms: ms(started),
      heapMb: heapMb(),
      ...peak(),
    });
  }

  // The edits alone, as the edit function makes them, with nothing built between.
  for (const [kind, command] of commands) {
    const done = await edit(1, kind, command);
    if (done) await undo(1, kind, done.inverse);
  }

  const live = memoryLive();
  const publish = async (step: string) => {
    started = performance.now();
    const published = await runRebuild({
      copyStore: cloud.store,
      liveStore: live.store,
      pool,
      today: () => today,
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
      ...peak(),
    });
  };
  await publish("first publish");

  // Each edit again, with every board built and published after it, as its rebuild would: only
  // after an edit that changed what the boards read, since the trigger rebuilds no other. The
  // rebuild's own pool is not this one, and fetches the parts the edit changed, which is timed
  // here apart, from the copy in memory, unpacked and checked as it would fetch them.
  for (const [kind, command] of commands) {
    const done = await edit(2, kind, command);
    if (!done) continue;
    const read = done.changed.filter(isBoardInput);
    if (read.length === 0) {
      print({ step: `publish after ${kind}`, skipped: "no board input changed" });
    } else {
      started = performance.now();
      const parts = (cloud.manifest()?.parts ?? []).filter(({ key }) => read.includes(key));
      const fetched = await fetchValues({ store: cloud.store, parts });
      print({
        step: `rebuild's fetch after ${kind}`,
        ok: fetched.ok,
        parts: parts.length,
        pieces: parts.reduce((sum, part) => sum + part.chunks, 0),
        ms: ms(started),
      });
      await publish(`publish after ${kind}`);
    }
    await undo(2, kind, done.inverse);
  }
  await pool.drop();
};

void main();
