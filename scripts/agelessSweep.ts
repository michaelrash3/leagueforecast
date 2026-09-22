/**
 * Runs the ageless triage rules over a real pool and prints what they would do.
 *
 * A research tool rather than a feature, and a gate rather than a convenience: `agelessTriage.ts`
 * holds a dozen candidate rules for clearing the thirty-six thousand teams nobody could age, none
 * of them wired to anything, and none of them may ship before this has run against a real export
 * and somebody has read the names it prints. That is this repo's standing rule — a number in a
 * comment says what was measured — and it matters more here than usual, because the cost of a
 * wrong rule is not symmetric. A team left unrated costs its own ranking. A team rated at the
 * wrong age, or deleted, corrupts every club it played, and a wrongly refused club leaves nothing
 * behind to notice it by.
 *
 *   npm run ageless:sweep -- <file> [--pool=names.csv] [--rule=NAME] [--sample=20] [--seed=1] [--csv]
 *
 * **Two files will do.** Either is the whole waiting list; they differ in what comes with it.
 *
 *   - `gamechanger-waiting-on-an-age-<date>.csv`, the file the review card's download button
 *     writes. A few megabytes, and the only one of the two that can be moved off the machine that
 *     collected it: the whole-browser backup of a nationwide pool runs to hundreds of megabytes,
 *     which is not a file anybody uploads. It carries the rows and their evidence and nothing
 *     else, so the two sections below that measure against the *working* pool are skipped and say
 *     so rather than printing a zero that looks like a clean bill of health.
 *   - `League_Forecast_Backup_<date>.json`, the whole-browser backup, which carries the waiting
 *     list in its `answers` block *and* the hundred thousand teams that already work. That second
 *     population is what makes the tripwire possible, so where the file can be had, it is better.
 *
 * A Team Rankings *pool* CSV is still refused by name: `CSV_SECTIONS` covers the schedule, the age
 * groups, the teams and the games, and has nowhere to put a waiting list. "This file has no
 * waiting teams" and "this file cannot carry them" are very different answers and only one of them
 * is worth acting on, so the header decides which file this is before anything is counted.
 *
 * What it prints is arranged around the ways a sweep like this produces a confident, tidy, wrong
 * answer:
 *
 *   - two rules both credited with the same twelve thousand rows, so their totals add up to more
 *     than the backlog and each looks indispensable;
 *   - a rule measured only against the teams it was written for, never against the teams it would
 *     wreck, so its false positives are invisible by construction;
 *   - a threshold picked because it was the first one tried;
 *   - a sample that reshuffles every run, so nobody can work through it;
 *   - and the residue — what is *left* after every rule has run — quietly never reported, which is
 *     the number that says whether any of this was worth doing.
 */
import { readFileSync } from "node:fs";
import {
  looksLikeJsonBackup,
  parseTeamRankingsJson,
  type TeamRankingsBackup,
} from "../src/lib/teamRankingsBackup.ts";
import {
  AGELESS_RULES,
  agelessVerdicts,
  type AgelessVerdict,
} from "../src/lib/agelessTriage.ts";
import { ageLevelFromName } from "../src/lib/gameChangerApi.ts";
import { whyNoAge, type AgelessEvidence } from "../src/lib/agelessEvidence.ts";
import { MIN_OPPONENT_AGE_EVIDENCE } from "../src/lib/gameChangerImport.ts";
import { AGELESS_CSV_HEADERS, parseAgelessCsv } from "../src/lib/agelessCsv.ts";
import { POOL_NAMES_CSV_HEADERS } from "../src/lib/poolNamesCsv.ts";
import { normalizeHeader, parseCSVLine, stripBom } from "../src/lib/csv.ts";
import type { AgeUnknownList, AgeUnknownTeam } from "../src/lib/ageUnknown.ts";

/**
 * The Node globals this script needs, declared here for the reason `recencySweep.ts` gives:
 * installing `@types/node` would change global timer typings for the browser project too.
 */
declare const process: { argv: string[]; exitCode?: number };
declare const console: { log: (...args: unknown[]) => void; error: (...args: unknown[]) => void };

// ---------- arguments ----------

type Options = {
  file: string;
  /** The working pool's names, for the tripwire the backlog cannot supply. */
  pool?: string;
  rule?: string;
  sample: number;
  seed: number;
  csv: boolean;
};

const readOptions = (argv: string[]): Options | null => {
  const rest = argv.slice(2);
  const file = rest.find((arg) => !arg.startsWith("--"));
  if (!file) return null;
  const flag = (name: string): string | undefined =>
    rest.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];
  return {
    file,
    ...(flag("pool") ? { pool: flag("pool") } : {}),
    ...(flag("rule") ? { rule: flag("rule") } : {}),
    sample: Number(flag("sample") ?? 12),
    seed: Number(flag("seed") ?? 1),
    csv: rest.includes("--csv"),
  };
};

/**
 * A sample that does not move between runs.
 *
 * The point of printing names is that somebody reads them, decides the rule is wrong about four
 * of them, and re-runs to see whether a change fixed those four. A sample drawn afresh each time
 * makes that impossible, so the order is a hash of the team id and nothing else — stable across
 * runs, across machines, and across changes to the rules.
 */
const shuffleKey = (teamId: string, seed: number): number => {
  let hash = seed >>> 0;
  for (let at = 0; at < teamId.length; at += 1) {
    hash = (Math.imul(hash ^ teamId.charCodeAt(at), 0x01000193) >>> 0) % 0xffffffff;
  }
  return hash;
};

const sampleOf = (rows: AgeUnknownTeam[], count: number, seed: number): AgeUnknownTeam[] =>
  [...rows]
    .sort((a, b) => shuffleKey(a.teamId, seed) - shuffleKey(b.teamId, seed))
    .slice(0, Math.max(0, count));

// ---------- printing ----------

const rule = "=".repeat(96);
const pct = (part: number, whole: number): string =>
  whole === 0 ? "—" : `${((part / whole) * 100).toFixed(1)}%`;
const n = (value: number): string => value.toLocaleString();

const describeVerdict = (verdict: AgelessVerdict): string => {
  switch (verdict.kind) {
    case "age":
      return `${verdict.level}U`;
    case "rec":
      return verdict.level === undefined ? "rec" : `rec, ${verdict.level}U`;
    default:
      return verdict.kind;
  }
};

const describeRow = (row: AgeUnknownTeam): string => {
  const evidence = row.evidence;
  const bits = [
    JSON.stringify(row.name ?? ""),
    evidence?.state ?? evidence?.city ?? "",
    evidence ? `${evidence.games}g/${evidence.opponents}opp` : "no evidence",
    evidence?.ngb?.length ? evidence.ngb.join("+") : "",
    evidence?.sampleOpponents?.length ? `played ${evidence.sampleOpponents.join("; ")}` : "",
  ].filter(Boolean);
  return bits.join("  ·  ");
};

// ---------- the file ----------

/** A pool team, reduced to what the rules read off one: nothing here fetches or rates anything. */
type PoolTeam = { id: string; name: string };

type Source = {
  waiting: AgeUnknownList;
  /**
   * The teams that already work, where the file carries them.
   *
   * `null` rather than `[]`, and the difference is the whole point: an empty array would run the
   * tripwire over nothing and print a column of zeroes, which reads exactly like a rule that never
   * fires on a working club. "Not measured" has to look different from "measured, found nothing".
   */
  pool: PoolTeam[] | null;
  games: number | null;
};

/** Whether the first non-blank line is the header the review card's download writes. */
const looksLikeAgelessCsv = (raw: string): boolean => {
  const header = stripBom(raw)
    .split(/\r?\n/)
    .find((line) => line.trim().length > 0);
  if (!header) return false;
  const headers = new Set(parseCSVLine(header).map(normalizeHeader));
  // Three columns, because one of them alone is a header half the CSVs in this repo could have.
  return ["Team ID", "Answer", "Why"].every((name) => headers.has(normalizeHeader(name)));
};

/**
 * The working pool, out of the file the Pool health card writes.
 *
 * Only ever used for the tripwire, so only ever read for the three things the tripwire asks: the
 * id, the name, and the age the pool already has. A row that is a bracket slot or a name-only
 * opponent is dropped — neither is a club anybody ranks, and a rule firing on ten thousand "TBD"
 * rows would swamp the number that matters.
 */
const readPoolNames = (
  file: string,
  raw: string
): { team: PoolTeam; level?: number; evidence?: AgelessEvidence }[] | null => {
  const lines = stripBom(raw).split(/\r?\n/);
  const header = lines.find((line) => line.trim().length > 0);
  if (!header) return null;
  const headers = parseCSVLine(header).map(normalizeHeader);
  const at = (name: string) => headers.indexOf(normalizeHeader(name));
  const idAt = at("Team ID");
  const nameAt = at("Team Name");
  const levelAt = at("Age Level");
  const rankedAt = at("Ranked");
  if (idAt < 0 || nameAt < 0) {
    console.error(
      `! ${file} is not a pool-names file.\n` +
        `  Its header should begin ${POOL_NAMES_CSV_HEADERS.slice(0, 3).join(",")} — press\n` +
        '  "Download the pool names" on the Pool health card.'
    );
    return null;
  }
  // The evidence half, where the file carries it. Absent in a file written before it did, and the
  // sweep says "not measured" for the rules that need it rather than reporting their zero.
  const gamesAt = at("Games");
  const scoredAt = at("Scored");
  const aheadAt = at("Ahead Of Today");
  const blowoutsAt = at("Shutout Blowouts");
  const opponentsAt = at("Opponents");
  const namingAt = at("Opponents Naming An Age");
  const tallyAt = at("Opponent Ages");
  const playedAt = at("Played");
  const hasEvidence = gamesAt >= 0 && opponentsAt >= 0 && namingAt >= 0;

  const out: { team: PoolTeam; level?: number; evidence?: AgelessEvidence }[] = [];
  let first = true;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (first) {
      first = false;
      continue;
    }
    const cells = parseCSVLine(line);
    const id = (cells[idAt] ?? "").trim();
    const name = (cells[nameAt] ?? "").trim();
    if (!id || !name) continue;
    if (rankedAt >= 0 && (cells[rankedAt] ?? "").trim().toLowerCase() === "no") continue;
    const level = levelAt >= 0 ? Number((cells[levelAt] ?? "").trim()) : Number.NaN;
    const count = (col: number): number => {
      const value = Number((cells[col] ?? "").trim());
      return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
    };
    const played = (cells[playedAt] ?? "")
      .split(";")
      .map((one) => one.trim())
      .filter(Boolean);
    const tally = (cells[tallyAt] ?? "").split(/\s+/).flatMap((part) => {
      const m = /^(\d+)[x\u00d7](\d{1,2})U$/i.exec(part.trim());
      return m ? [[Number(m[2]), Number(m[1])] as [number, number]] : [];
    });
    out.push({
      team: { id, name },
      ...(Number.isFinite(level) && level > 0 ? { level } : {}),
      ...(hasEvidence
        ? {
            evidence: {
              games: count(gamesAt),
              scored: scoredAt >= 0 ? count(scoredAt) : 0,
              aheadOfToday: aheadAt >= 0 ? count(aheadAt) : 0,
              shutoutBlowouts: blowoutsAt >= 0 ? count(blowoutsAt) : 0,
              opponents: count(opponentsAt),
              namedAnAge: count(namingAt),
              tally,
              ...(played.length > 0 ? { sampleOpponents: played } : {}),
            },
          }
        : {}),
    });
  }
  return out;
};

/**
 * The waiting list, out of whichever of the two files was handed over.
 *
 * Refusals are by file shape rather than by extension: a name says what somebody meant to export,
 * and the header says what they actually did. Each one names the file to go and get, because the
 * commonest way to run this is with the wrong export — the pool backup rather than the whole
 * browser's, or a CSV of the pool rather than of the backlog — and they are all `.json` and `.csv`
 * alike from the outside.
 */
const readSource = (file: string, raw: string): Source | null => {
  if (looksLikeAgelessCsv(raw)) {
    return { waiting: parseAgelessCsv(raw), pool: null, games: null };
  }
  if (!looksLikeJsonBackup(raw)) {
    console.error(
      `! ${file} is neither a JSON backup nor a waiting-on-an-age CSV.\n` +
        "  A pool CSV cannot carry a waiting list: its sections are the schedule, the age groups,\n" +
        "  the teams and the games, and there is nowhere in them to put one. Use the whole-browser\n" +
        `  backup — League_Forecast_Backup_<date>.json — or the file the "Download the list" button\n` +
        `  writes, whose header begins ${AGELESS_CSV_HEADERS.slice(0, 4).join(",")}.`
    );
    return null;
  }

  const parsed: unknown = JSON.parse(raw);
  const backup: TeamRankingsBackup | null =
    parseTeamRankingsJson(raw) ??
    (typeof parsed === "object" && parsed !== null && "teamRankings" in parsed
      ? parseTeamRankingsJson(JSON.stringify((parsed as { teamRankings: unknown }).teamRankings))
      : null);
  if (!backup) {
    console.error(`! ${file} is not a Team Rankings backup.`);
    return null;
  }
  return {
    waiting: backup.answers?.ageUnknown ?? [],
    pool: backup.teams.map((team) => ({ id: team.id, name: team.name })),
    games: backup.games.length,
  };
};

// ---------- the sweep ----------

const main = (): void => {
  const options = readOptions(process.argv);
  if (!options) {
    console.error(
      "usage: npm run ageless:sweep -- <backup.json|waiting.csv> [--pool=names.csv] [--rule=NAME] [--sample=20] [--seed=1] [--csv]"
    );
    process.exitCode = 1;
    return;
  }

  const raw = readFileSync(options.file, "utf8");
  const source = readSource(options.file, raw);
  if (!source) {
    process.exitCode = 1;
    return;
  }
  /*
   * The tripwire population, from whichever file carries it. A backup brings its own; a backlog
   * CSV cannot, so `--pool` is how the other half of the measurement arrives when the only file
   * small enough to move is the backlog.
   */
  const named = options.pool
    ? readPoolNames(options.pool, readFileSync(options.pool, "utf8"))
    : null;
  if (options.pool && !named) {
    process.exitCode = 1;
    return;
  }
  const filed = new Map<string, number>();
  const evidenceOf = new Map<string, AgelessEvidence>();
  named?.forEach((row) => {
    if (row.level !== undefined) filed.set(row.team.id, row.level);
    if (row.evidence) evidenceOf.set(row.team.id, row.evidence);
  });
  const hasPoolEvidence = evidenceOf.size > 0;
  const pool = named ? named.map((row) => row.team) : source.pool;
  const { waiting } = source;

  console.log(rule);
  console.log(`Ageless sweep · ${options.file}`);
  console.log(rule);
  console.log(
    `${n(waiting.length)} teams waiting on an age · ` +
      (pool
        ? `${n(pool.length)} teams in the pool${source.games === null ? "" : ` · ${n(source.games)} games`}`
        : "no working pool in this file, so the two sections that need one are skipped")
  );

  if (waiting.length === 0) {
    console.error(
      "\n! This file carries no waiting list.\n" +
        "  The Team Rankings pool backup does not write the answers block; the whole-browser one\n" +
        "  does. Look for League_Forecast_Backup_<date>.json, or press \"Download the list\" on the\n" +
        "  teams-waiting-on-an-age card for the CSV."
    );
    process.exitCode = 1;
    return;
  }

  const rules = options.rule
    ? AGELESS_RULES.filter((entry) => entry.id.includes(options.rule ?? ""))
    : AGELESS_RULES;

  // One pass, every rule, so a row's verdicts are known together and the overlap below is real
  // rather than a second walk that might disagree with the first.
  const caught = new Map<string, AgeUnknownTeam[]>();
  const verdictOf = new Map<string, Map<string, AgelessVerdict>>();
  const anyRule = new Set<string>();
  waiting.forEach((row) => {
    agelessVerdicts(row).forEach(({ rule: hit, verdict }) => {
      if (!rules.includes(hit)) return;
      const rows = caught.get(hit.id) ?? [];
      rows.push(row);
      caught.set(hit.id, rows);
      const perRow = verdictOf.get(hit.id) ?? new Map();
      perRow.set(row.teamId, verdict);
      verdictOf.set(hit.id, perRow);
      anyRule.add(row.teamId);
    });
  });

  console.log("");
  console.log("WHAT EACH RULE CATCHES");
  console.log("-".repeat(96));
  console.log(
    `${"rule".padEnd(24)} ${"tier".padEnd(8)} ${"caught".padEnd(10)} ${"share".padEnd(8)} what it would do`
  );
  rules.forEach((entry) => {
    const rows = caught.get(entry.id) ?? [];
    const verdicts = verdictOf.get(entry.id);
    const kinds = new Map<string, number>();
    rows.forEach((row) => {
      const verdict = verdicts?.get(row.teamId);
      if (!verdict) return;
      const label = describeVerdict(verdict);
      kinds.set(label, (kinds.get(label) ?? 0) + 1);
    });
    const summary = [...kinds.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([label, count]) => `${n(count)} ${label}`)
      .join(", ");
    console.log(
      `${entry.id.padEnd(24)} ${entry.tier.padEnd(8)} ${n(rows.length).padEnd(10)} ` +
        `${pct(rows.length, waiting.length).padEnd(8)} ${summary}`
    );
  });

  /*
   * The overlap, because two rules crediting themselves with the same rows is the easiest way for
   * this report to claim more than it can deliver. What matters per rule is its *marginal* catch:
   * the rows nothing else would have reached.
   */
  console.log("");
  console.log("MARGINAL CATCH — rows no other rule reaches");
  console.log("-".repeat(96));
  rules.forEach((entry) => {
    const rows = caught.get(entry.id) ?? [];
    const others = new Set<string>();
    rules.forEach((other) => {
      if (other.id === entry.id) return;
      (caught.get(other.id) ?? []).forEach((row) => others.add(row.teamId));
    });
    const only = rows.filter((row) => !others.has(row.teamId));
    console.log(
      `${entry.id.padEnd(24)} ${n(only.length).padEnd(10)} of ${n(rows.length)} (${pct(only.length, rows.length)})`
    );
  });

  /*
   * The tripwire. Every team already in the pool has an age and is connected to the rest of it, so
   * a rule that fires on one of those names is either eating a working club or relabelling a team
   * the pool currently ranks. It is the closest thing to a false-positive rate available without
   * ground truth, and it costs nothing.
   *
   * The pool's names are cleaned — age labels stripped — so a name rule sees a shorter string here
   * than it will on a waiting row. That understates the rules that read an age and leaves the
   * division and marker rules, which is what this is for, honest.
   */
  console.log("");
  console.log("TRIPWIRE — the same rules against teams that already work");
  console.log("-".repeat(96));
  if (!pool) {
    console.log(
      'not measured: this file carries the backlog only. Press "Download the pool names" on the\n' +
        "Pool health card and pass it as --pool=<file> to get a false-positive rate."
    );
  } else {
    const pooled: AgeUnknownTeam[] = pool.map((team) => ({
      teamId: team.id,
      name: team.name,
      firstSeen: "",
      lastTried: "",
      /*
       * Two asks, which is what `no-games` needs before it will speak. A pool team has been
       * fetched and filed, so it has been asked about at least as often as a backlog row has.
       */
      tries: 2,
      ...(evidenceOf.get(team.id) ? { evidence: evidenceOf.get(team.id)! } : {}),
    }));
    /*
     * Which rules this file can actually speak to. A pool team has no GameChanger profile kept
     * beside it, so it has no age label, and the two rules that read one cannot fire here however
     * the file is written — their zero is "not measured", and saying so is the whole point of
     * this section.
     */
    const noLabel = new Set(["adult-label", "school-label"]);
    const measurable = (id: string) => !noLabel.has(id) && (hasPoolEvidence || !needsEvidence.has(id));
    const needsEvidence = new Set([
      "closed-cluster",
      "school-by-evidence",
      "near-miss-tally",
      "no-games",
      "scored-ahead",
      "pony-division",
    ]);
    /*
     * Where the pool file carried the age each team is already filed under, a hit splits in two,
     * and only one half is bad news. A rule reading 10U off a team the pool has at 10U is
     * agreeing with the pool, which is the best evidence there is that the rule works. A rule
     * reading 16U off that same team is the thing this whole section exists to catch, and it is
     * the "wrong" column that should be zero — not the "fires" one.
     */
    const knowsAges = filed.size > 0;
    console.log(
      knowsAges
        ? `${"rule".padEnd(24)} ${"fires".padEnd(10)} ${"share".padEnd(8)} ${"agrees".padEnd(8)} ${"WRONG".padEnd(8)} examples`
        : `${"rule".padEnd(24)} ${"fires".padEnd(10)} ${"share".padEnd(8)} examples`
    );
    rules.forEach((entry) => {
      const hits = pooled.filter((row) => entry.read(row) !== undefined);
      let agrees = 0;
      const wrong: AgeUnknownTeam[] = [];
      hits.forEach((row) => {
        const verdict = entry.read(row);
        const level =
          verdict && (verdict.kind === "age" || verdict.kind === "rec") ? verdict.level : undefined;
        const already = filed.get(row.teamId);
        if (level === undefined || already === undefined) return;
        if (level === already) agrees += 1;
        else wrong.push(row);
      });
      const shown = sampleOf(wrong.length > 0 ? wrong : hits, 3, options.seed)
        .map((row) => JSON.stringify(row.name ?? ""))
        .join("  ");
      const note = measurable(entry.id) ? shown : "not measured — this file cannot exercise it";
      console.log(
        knowsAges
          ? `${entry.id.padEnd(24)} ${n(hits.length).padEnd(10)} ${pct(hits.length, pooled.length).padEnd(8)} ${n(agrees).padEnd(8)} ${n(wrong.length).padEnd(8)} ${note}`
          : `${entry.id.padEnd(24)} ${n(hits.length).padEnd(10)} ${pct(hits.length, pooled.length).padEnd(8)} ${note}`
      );
    });
  }

  /*
   * And the question the grade words exist to answer: how often does a USSSA or Perfect Game grade
   * travel *with* an age? Where it does, the age veto covers it. Where it does not, the bare grade
   * is what reaches this backlog — which is exactly where reading it as an age does the damage.
   */
  const GRADES = /\b(?:a{1,3}|majors?|minors?)\b/i;
  const gradedWaiting = waiting.filter((row) => GRADES.test(row.name ?? ""));
  const gradedWaitingWithAge = gradedWaiting.filter(
    (row) => ageLevelFromName(row.name ?? "") !== undefined
  );
  console.log("");
  console.log("THE GRADE QUESTION — does A/AA/AAA/Major travel with an age?");
  console.log("-".repeat(96));
  if (!pool) {
    console.log("in the pool:   not measured — no working pool in this file");
  } else {
    const gradedPool = pool.filter((team) => GRADES.test(team.name));
    const gradedWithAge = gradedPool.filter((team) => ageLevelFromName(team.name) !== undefined);
    console.log(
      `in the pool:   ${n(gradedPool.length)} names carry a grade, ${n(gradedWithAge.length)} also carry an age (${pct(gradedWithAge.length, gradedPool.length)})`
    );
  }
  console.log(
    `still waiting: ${n(gradedWaiting.length)} names carry a grade, ${n(gradedWaitingWithAge.length)} also carry an age (${pct(gradedWaitingWithAge.length, gradedWaiting.length)})`
  );

  /*
   * Disconfirmation: a row whose opponents *do* write ages is not in a closed cluster, whatever
   * its name says. Any refusal rule firing on one of those is suspect, and a non-zero count here
   * means a veto is missing or mis-ordered rather than that the rule is merely imperfect.
   */
  console.log("");
  console.log("DISCONFIRMED — caught although its opponents do name ages");
  console.log("-".repeat(96));
  rules.forEach((entry) => {
    const rows = caught.get(entry.id) ?? [];
    const contradicted = rows.filter(
      (row) => (row.evidence?.namedAnAge ?? 0) >= MIN_OPPONENT_AGE_EVIDENCE
    );
    if (contradicted.length === 0) return;
    console.log(`${entry.id.padEnd(24)} ${n(contradicted.length)}`);
    sampleOf(contradicted, 2, options.seed).forEach((row) =>
      console.log(`    ${describeRow(row)}`)
    );
  });

  // Samples last, because they are what somebody actually reads.
  console.log("");
  console.log(`A SAMPLE OF WHAT EACH RULE CAUGHT (seed ${options.seed})`);
  console.log(rule);
  rules.forEach((entry) => {
    const rows = caught.get(entry.id) ?? [];
    if (rows.length === 0) return;
    console.log("");
    console.log(`${entry.id} — ${entry.label} (${n(rows.length)})`);
    console.log(`  ${entry.because}`);
    sampleOf(rows, options.sample, options.seed).forEach((row) => {
      const verdict = verdictOf.get(entry.id)?.get(row.teamId);
      console.log(
        `    ${(verdict ? describeVerdict(verdict) : "").padEnd(13)}${describeRow(row)}`
      );
    });
  });

  /*
   * The residue, which is the number that says whether any of this was worth doing: what is still
   * on the list after every rule has had its turn.
   */
  const left = waiting.filter((row) => !anyRule.has(row.teamId));
  console.log("");
  console.log(rule);
  console.log(
    `LEFT OVER — ${n(left.length)} of ${n(waiting.length)} (${pct(left.length, waiting.length)}) that no rule reaches`
  );
  console.log(rule);
  sampleOf(left, options.sample, options.seed).forEach((row) => {
    console.log(`    ${describeRow(row)}`);
    if (row.evidence) console.log(`      ${whyNoAge(row.evidence, MIN_OPPONENT_AGE_EVIDENCE)}`);
  });

  if (options.csv) {
    console.log("");
    console.log("Team ID,Team Name,Rules,Verdict,State,Games,Opponents,Naming An Age,NGB");
    waiting.forEach((row) => {
      const hits = agelessVerdicts(row).filter(({ rule: hit }) => rules.includes(hit));
      if (hits.length === 0) return;
      const cells = [
        row.teamId,
        JSON.stringify(row.name ?? ""),
        hits.map(({ rule: hit }) => hit.id).join(" "),
        describeVerdict(hits[0]!.verdict),
        row.evidence?.state ?? "",
        String(row.evidence?.games ?? 0),
        String(row.evidence?.opponents ?? 0),
        String(row.evidence?.namedAnAge ?? 0),
        (row.evidence?.ngb ?? []).join(" "),
      ];
      console.log(cells.join(","));
    });
  }

  console.log("");
  console.log(
    "Nothing here is applied. Read the samples, and especially the tripwire: a rule that fires on\n" +
      "teams the pool already ranks is a rule that would break working data. What survives that is\n" +
      "what is worth shipping."
  );
};

main();
