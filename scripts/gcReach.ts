/**
 * Asks GameChanger for real public teams from wherever this runs, through the app's own proxy
 * handler (`api/gc-team.ts`), and says whether it answered, how fast, and how much it sent.
 *
 * Written to settle one question before a nightly pull is built on GitHub's servers: whether
 * GameChanger's firewall answers one of them as it answers the Firebase proxy. It prints counts,
 * sizes and timings only, never a team's name or staff, since a public repository's Actions logs
 * are public (`.github/workflows/gc-reach.yml`).
 *
 *   npm run gc:reach -- --rounds 10
 *
 * The first round asks for every team once, ten to a request as the app does. The rest ask again
 * with eight requests in flight, the app's own starting pace, so a firewall that lets one request
 * through and stops a steady run shows it; a round with any team refused or slowed is the last.
 */
import { gzipSync } from "node:zlib";
import handler, { clearProfileCache } from "../api/gc-team.ts";
import type { ApiRequest, ApiResponse } from "../src/lib/apiShared.ts";
import { gcGameListFrom } from "../src/lib/gameChangerApi.ts";

declare const process: { argv: string[]; exitCode?: number };

/**
 * Public team pages the test fixtures were recorded from (`src/lib/__tests__/fixtures`), and the
 * one `verify-gc-pull.ts` checks. A page taken down since answers "not found", which is still
 * GameChanger answering.
 */
const TEAM_IDS = [
  "J4FYJQqyIR0h",
  "kD6SNioBzfxL",
  "CE9brB7BgC5P",
  "LhwmTwO1wzbN",
  "dyW6e76moIia",
  "WBvcP481wprj",
  "GZLyRXUeD87Z",
  "kPZZKt2hjQwF",
  "2h4CKbDtIQzH",
  "aGLfkW4E22sm",
  "ghoY0z3UvrY9",
  "hH8l9MBjxg7U",
  "x3xi97TtS33L",
  "zjvVkYnqLrf0",
  "ynfOm3M5AZ0M",
  "gsUthn4XoIxS",
  "FtEExZwB4b8E",
  "bKpjvY5AVqOV",
];
const BATCH = 10;
const IN_FLIGHT = 8;

type TeamOutcome = { reason: string; bytes: number; games: number };
type Sent = { status: number; body: string };

const encoder = new TextEncoder();
const byteLength = (text: string): number => encoder.encode(text).length;

/** One request to the handler, as the Firebase function makes it (`functions/smoke.mjs`). */
const ask = (ids: readonly string[]): Promise<Sent> =>
  new Promise((resolve, reject) => {
    const sent: Sent = { status: 200, body: "" };
    const res: ApiResponse = {
      status(code) {
        sent.status = code;
        return res;
      },
      setHeader: () => undefined,
      json(body) {
        res.end(JSON.stringify(body));
      },
      end(body) {
        sent.body = body ?? "";
        resolve(sent);
      },
    };
    const req: ApiRequest = {
      method: "GET",
      url: `/?ids=${ids.join(",")}&raw=1`,
      headers: {},
      socket: { remoteAddress: "203.0.113.7" },
    };
    handler(req, res).catch(reject);
  });

/** What the handler said of each team: answered (`ok`) or its failure's reason. */
const outcomesOf = (sent: Sent): TeamOutcome[] => {
  const parsed: unknown = JSON.parse(sent.body);
  const teams =
    parsed && typeof parsed === "object" && "teams" in parsed && Array.isArray(parsed.teams)
      ? (parsed.teams as unknown[])
      : [];
  return teams.map((entry) => {
    const result =
      entry && typeof entry === "object" && "result" in entry
        ? (entry.result as Record<string, unknown>)
        : {};
    if (result.ok !== true) {
      return {
        reason: typeof result.reason === "string" ? result.reason : "other",
        bytes: 0,
        games: 0,
      };
    }
    const raw = (result.raw ?? {}) as { profile?: unknown; games?: unknown };
    const profile = typeof raw.profile === "string" ? raw.profile : "";
    const games = typeof raw.games === "string" ? raw.games : "";
    let count = 0;
    try {
      count = games ? (gcGameListFrom(JSON.parse(games))?.length ?? 0) : 0;
    } catch {
      count = 0;
    }
    return { reason: "ok", bytes: byteLength(profile) + byteLength(games), games: count };
  });
};

/** Every call GameChanger was sent, by answer, and how long each took. */
const upstream = { answers: new Map<string, number>(), ms: [] as number[] };
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const started = performance.now();
  try {
    const response = await realFetch(input, init);
    upstream.ms.push(performance.now() - started);
    const key = `HTTP ${response.status}`;
    upstream.answers.set(key, (upstream.answers.get(key) ?? 0) + 1);
    return response;
  } catch (error) {
    upstream.answers.set("no answer", (upstream.answers.get("no answer") ?? 0) + 1);
    throw error;
  }
};

const batchesOf = (ids: readonly string[]): string[][] => {
  const batches: string[][] = [];
  for (let at = 0; at < ids.length; at += BATCH) batches.push(ids.slice(at, at + BATCH));
  return batches;
};

/** Runs `batches` with at most `inFlight` requests out at once; each asks GameChanger afresh. */
const run = async (batches: readonly string[][], inFlight: number) => {
  const outcomes: TeamOutcome[] = [];
  const sentBytes = { plain: 0, gzip: 0 };
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const batch = batches[next];
      next += 1;
      if (!batch) continue;
      clearProfileCache();
      const sent = await ask(batch);
      sentBytes.plain += byteLength(sent.body);
      sentBytes.gzip += gzipSync(sent.body).length;
      outcomes.push(...outcomesOf(sent));
    }
  };
  await Promise.all(Array.from({ length: Math.min(inFlight, batches.length) }, worker));
  return { outcomes, sentBytes };
};

const tally = (outcomes: readonly TeamOutcome[]): string => {
  const counts = new Map<string, number>();
  for (const { reason } of outcomes) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  return [...counts]
    .sort(([, a], [, b]) => b - a)
    .map(([reason, count]) => `${count} ${reason === "ok" ? "answered" : reason}`)
    .join(", ");
};

const refused = (outcomes: readonly TeamOutcome[]): number =>
  outcomes.filter(({ reason }) => reason === "blocked" || reason === "throttled").length;

/** Teams with no answer at all in time: a firewall can stall as well as refuse. */
const unanswered = (outcomes: readonly TeamOutcome[]): number =>
  outcomes.filter(({ reason }) => reason === "timeout" || reason === "network").length;

const percentile = (values: readonly number[], share: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? 0;
};

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  const roundsAt = argv.indexOf("--rounds");
  const rounds = Math.max(1, Math.min(20, Number(argv[roundsAt + 1]) || 1));

  console.log(`Asking GameChanger for ${TEAM_IDS.length} public teams from this machine.`);
  const first = await run(batchesOf(TEAM_IDS), 1);
  const answered = first.outcomes.filter(({ reason }) => reason === "ok");
  console.log(`Round 1: ${tally(first.outcomes)}.`);
  if (answered.length > 0) {
    const bytes = answered.reduce((sum, { bytes: size }) => sum + size, 0);
    const games = answered.reduce((sum, { games: count }) => sum + count, 0);
    console.log(
      `  ${games} games on the ${answered.length} answered schedules; a team's two pages came to ${kb(
        bytes / answered.length
      )} on average.`
    );
    console.log(
      `  The proxy's answers: ${kb(first.sentBytes.plain)} as JSON, ${kb(first.sentBytes.gzip)} gzipped, for ${TEAM_IDS.length} teams.`
    );
  }

  let steady = { teams: 0, refused: 0, unanswered: 0, seconds: 0, rounds: 0 };
  if (rounds > 1 && refused(first.outcomes) === 0) {
    const started = performance.now();
    for (let round = 2; round <= rounds; round += 1) {
      const batches = Array.from({ length: IN_FLIGHT }, () => batchesOf(TEAM_IDS)).flat();
      const { outcomes } = await run(batches, IN_FLIGHT);
      steady = {
        teams: steady.teams + outcomes.length,
        refused: steady.refused + refused(outcomes),
        unanswered: steady.unanswered + unanswered(outcomes),
        seconds: (performance.now() - started) / 1000,
        rounds: round - 1,
      };
      console.log(`Round ${round}: ${tally(outcomes)}.`);
      if (refused(outcomes) > 0) break;
    }
    console.log(
      `  ${steady.teams} teams in ${steady.seconds.toFixed(1)}s over ${steady.rounds} rounds, ${IN_FLIGHT} requests in flight: ${Math.round(
        (steady.teams / Math.max(steady.seconds, 0.001)) * 60
      )} teams a minute.`
    );
  }

  const calls = upstream.ms.length;
  console.log(
    `Calls to GameChanger: ${[...upstream.answers].map(([answer, count]) => `${count} ${answer}`).join(", ")}; ${calls} answered, the middle one in ${Math.round(
      percentile(upstream.ms, 0.5)
    )} ms, 95 in 100 within ${Math.round(percentile(upstream.ms, 0.95))} ms.`
  );

  const blocked = refused(first.outcomes) + steady.refused;
  if (answered.length === 0 || blocked > 0) {
    console.log(
      answered.length === 0
        ? "GameChanger answered none of the teams from this machine."
        : `GameChanger refused or slowed ${blocked} of the teams from this machine.`
    );
    process.exitCode = 1;
    return;
  }
  const stalled = unanswered(first.outcomes) + steady.unanswered;
  if (stalled > 0) {
    console.log(`${stalled} teams had no answer in time, which a steady run would have to retry.`);
  }
  console.log("GameChanger answers this machine as it answers the app's proxy.");
};

await main();
